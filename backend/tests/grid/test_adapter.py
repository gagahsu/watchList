"""Tests for the DB-free pure builders in grid/adapter.py.

`build_settings`/`build_context`/`evaluate_all`/`commit_fill` touch Postgres
and aren't covered here — they're thin glue verified by manual smoke-testing
against the real database once the grid_positions/grid_params tables exist.
"""
import pytest

from fifo import calc_fifo
from grid.adapter import AdapterError, asset_classes_for, holding_from_row, position_from_row


def make_grid_row(**overrides) -> dict:
    row = {
        "code": "0052",
        "enabled": True,
        "anchor": 60.9,
        "rung": 1,
        "baseline_shares": 769,
        "last_drift_date": None,
        "applied_ex_dividends": [],
        "grid_overrides": {},
        "created_at": 1755446400000,  # 2025-08-17T16:00:00Z -> tracked_since 2025-08-18
    }
    row.update(overrides)
    return row


def make_trades(*rows) -> list[dict]:
    return [
        {"id": str(i), "date": d, "type": t, "shares": s, "price": p, "fee": f}
        for i, (d, t, s, p, f) in enumerate(rows)
    ]


class TestPositionFromRow:
    def test_lots_come_from_fifo_open_lots_oldest_first(self):
        trades = make_trades(
            ("2026-01-01", "buy", 100, 50.0, 1),
            ("2026-02-01", "buy", 100, 90.0, 1),
        )
        fifo_result = calc_fifo(trades)
        position = position_from_row("0052", make_grid_row(), fifo_result)

        assert position.shares == 200
        assert [l.price for l in position.lots] == pytest.approx([50.01, 90.01])
        # LIFO consumption (from the end) should hit the newest lot first.
        pnl, _ = position.apply_sell("2026-03-01", price=100.0, shares=100, rungs=1)
        assert pnl == pytest.approx((100 - 90.01) * 100)

    def test_baseline_and_anchor_come_from_grid_row_not_fifo(self):
        trades = make_trades(("2026-01-01", "buy", 300, 50.0, 1))
        fifo_result = calc_fifo(trades)
        row = make_grid_row(anchor=55.5, rung=-2, baseline_shares=300)
        position = position_from_row("0052", row, fifo_result)

        assert position.anchor == 55.5
        assert position.rung == -2
        assert position.baseline_shares == 300

    def test_fully_sold_position_has_zero_shares_and_no_lots(self):
        trades = make_trades(
            ("2026-01-01", "buy", 100, 50.0, 1),
            ("2026-02-01", "sell", 100, 60.0, 1),
        )
        fifo_result = calc_fifo(trades)
        position = position_from_row("00735", make_grid_row(code="00735"), fifo_result)

        assert position.shares == 0
        assert position.lots == []


class TestHoldingFromRow:
    def test_builds_holding_from_asset_class_and_name(self):
        trades = make_trades(("2026-01-01", "buy", 769, 59.0234, 1))
        fifo_result = calc_fifo(trades)
        holding = holding_from_row(
            "0052", "富邦科技", "equity", make_grid_row(), fifo_result, []
        )

        assert holding.ticker == "0052"
        assert holding.name == "富邦科技"
        assert holding.asset_class == "equity"
        assert holding.shares == 769
        assert holding.avg_cost == pytest.approx(59.0247, abs=1e-3)

    def test_enabled_flag_maps_to_ticker_verified_gate(self):
        """The engine's actual blocking gate is `ticker_verified`
        (grid/engine.py checks `if not holding.ticker_verified`), so a
        disabled grid_positions row must map onto that field, not the
        unrelated `enabled` field on Holding (which stays True/unused here)."""
        fifo_result = calc_fifo([])
        holding = holding_from_row(
            "00735", "國泰臺韓科技", "equity", make_grid_row(enabled=False), fifo_result, []
        )
        assert holding.ticker_verified is False
        assert holding.enabled is True

    def test_rejects_invalid_asset_class(self):
        fifo_result = calc_fifo([])
        with pytest.raises(AdapterError):
            holding_from_row("XXXX", "?", "crypto", make_grid_row(), fifo_result, [])

    def test_ex_dividends_filtered_to_after_tracked_since(self):
        fifo_result = calc_fifo([])
        row = make_grid_row(created_at=1755446400000)  # tracked_since = 2025-08-18
        ex_div_rows = [
            {"ex_date": "2025-08-01", "cash_div": 0.30},  # before tracked_since -> dropped
            {"ex_date": "2025-11-17", "cash_div": 0.49},  # after -> kept
            {"ex_date": "2026-02-17", "cash_div": 0.0},   # zero amount -> dropped
        ]
        holding = holding_from_row("00725B", "國泰投資級公司債", "bond", row, fifo_result, ex_div_rows)

        assert holding.ex_dividends == [{"date": "2025-11-17", "amount": 0.49}]

    def test_no_tracked_since_keeps_all_ex_dividends(self):
        fifo_result = calc_fifo([])
        row = make_grid_row(created_at=0)
        ex_div_rows = [{"ex_date": "2020-01-01", "cash_div": 0.1}]
        holding = holding_from_row("00725B", "國泰投資級公司債", "bond", row, fifo_result, ex_div_rows)
        assert holding.ex_dividends == [{"date": "2020-01-01", "amount": 0.1}]


class _FakeConn:
    """Routes SELECT ... FROM <table> to a canned result set by table name,
    just enough to exercise asset_classes_for()'s two queries without a real
    database."""

    def __init__(self, grid_rows: list[dict], stock_rows: list[dict]):
        self._grid_rows = grid_rows
        self._stock_rows = stock_rows
        self._last_sql = ""

    def execute(self, sql: str, _params=None):
        self._last_sql = sql
        return self

    def fetchall(self):
        if "grid_positions" in self._last_sql:
            return self._grid_rows
        if "stocks" in self._last_sql:
            return self._stock_rows
        raise AssertionError(f"unexpected query: {self._last_sql}")


class TestAssetClassesFor:
    def test_empty_codes_short_circuits_without_querying(self):
        conn = _FakeConn(grid_rows=[], stock_rows=[])
        assert asset_classes_for(conn, [], {}) == {}

    def test_grid_tracked_code_wins_over_inference(self):
        # 0052 is grid-tracked as "equity" even though infer_asset_class()
        # would guess "bond" from a name containing "債" — grid_positions'
        # own classification always wins.
        conn = _FakeConn(
            grid_rows=[{"code": "0052", "asset_class": "equity"}],
            stock_rows=[{"code": "0052", "name": "某債券型ETF"}],
        )
        assert asset_classes_for(conn, ["0052"], {"0052": "tw"}) == {"0052": "equity"}

    def test_infers_for_codes_missing_from_grid_positions(self):
        conn = _FakeConn(
            grid_rows=[],
            stock_rows=[{"code": "00725B", "name": "國泰投資級公司債"}, {"code": "2330", "name": "台積電"}],
        )
        result = asset_classes_for(conn, ["00725B", "2330"], {"00725B": "tw", "2330": "tw"})
        assert result == {"00725B": "bond", "2330": "stock"}

    def test_mixes_grid_tracked_and_inferred_in_one_call(self):
        conn = _FakeConn(
            grid_rows=[{"code": "0052", "asset_class": "equity"}],
            stock_rows=[{"code": "2330", "name": "台積電"}],
        )
        result = asset_classes_for(conn, ["0052", "2330"], {"0052": "tw", "2330": "tw"})
        assert result == {"0052": "equity", "2330": "stock"}
