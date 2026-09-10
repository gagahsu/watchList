import contextlib

from grid.engine import BUY, SELL, Decision
from routers import linebot


def broker(discount=0.28, min_fee=1, rounding="floor"):
    return {"discount": discount, "min_fee": min_fee, "rounding": rounding}


@contextlib.contextmanager
def _fake_get_db(conn):
    yield conn


def test_calc_fee_tw_uses_broker_schedule():
    # 1,000 shares @ 580 = 580,000; *0.001425*0.28 = 231.42 -> floor 231
    assert linebot._calc_fee(1000, 580, broker(), market="tw") == 231


def test_calc_fee_floors_to_broker_minimum():
    assert linebot._calc_fee(1, 10, broker(min_fee=20), market="tw") == 20


def test_calc_fee_zero_for_us_market():
    assert linebot._calc_fee(1000, 580, broker(), market="us") == 0


def test_calc_tax_zero_on_buy():
    assert linebot._calc_tax(1000, 100, "buy", "equity", market="tw") == 0


def test_calc_tax_zero_for_us_market():
    assert linebot._calc_tax(1000, 100, "sell", "stock", market="us") == 0


def test_calc_tax_sell_bond_is_exempt():
    # Bond ETFs are tax-exempt on sell (grid/fees.py::BOND_ETF_TAX_RATE == 0)
    assert linebot._calc_tax(1000, 100, "sell", "bond", market="tw") == 0


def test_calc_tax_sell_stock_rate():
    # 1000 * 100 = 100,000 * 0.3% = 300
    assert linebot._calc_tax(1000, 100, "sell", "stock", market="tw") == 300


def test_calc_tax_sell_equity_etf_rate():
    # 1000 * 100 = 100,000 * 0.1% = 100
    assert linebot._calc_tax(1000, 100, "sell", "equity", market="tw") == 100


def test_bulk_markets_and_asset_classes_infers_us_market_from_code_shape(monkeypatch):
    class FakeConn:
        def execute(self, *_a, **_k):
            return self

        def fetchall(self):
            return []

    monkeypatch.setattr(linebot, "get_db", lambda: _fake_get_db(FakeConn()))
    markets, asset_classes = linebot._bulk_markets_and_asset_classes(["AAPL", "2330"])
    assert markets == {"AAPL": "us", "2330": "tw"}
    assert asset_classes == {"AAPL": "stock", "2330": "stock"}


def test_bulk_markets_and_asset_classes_prefers_recorded_values(monkeypatch):
    class FakeConn:
        def execute(self, sql, _params=None):
            self._sql = sql
            return self

        def fetchall(self):
            if "trade_markets" in self._sql:
                return [{"code": "0052", "market": "tw"}]
            if "grid_positions" in self._sql:
                return [{"code": "0052", "asset_class": "bond"}]
            return [{"code": "0052", "name": "元大寶灣"}]

    monkeypatch.setattr(linebot, "get_db", lambda: _fake_get_db(FakeConn()))
    markets, asset_classes = linebot._bulk_markets_and_asset_classes(["0052"])
    assert markets == {"0052": "tw"}
    assert asset_classes == {"0052": "bond"}


def test_bulk_markets_and_asset_classes_empty_codes_short_circuits():
    assert linebot._bulk_markets_and_asset_classes([]) == ({}, {})


def test_resolve_account_id_prefers_broker_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    b = {"account_id": "broker-account"}
    assert linebot._resolve_account_id(b) == "broker-account"


def test_resolve_account_id_falls_back_when_broker_has_no_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    b = {"account_id": None}
    assert linebot._resolve_account_id(b) == "fallback-account"


def test_resolve_account_id_falls_back_when_no_broker(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    assert linebot._resolve_account_id(None) == "fallback-account"


def test_resolve_account_id_none_when_nothing_configured(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: None)
    assert linebot._resolve_account_id(None) is None
    assert linebot._resolve_account_id({"account_id": None}) is None


# ── _record_grid_trade (網格買/網格賣) ───────────────────────────────────────

def make_decision(**overrides) -> Decision:
    defaults = dict(
        ticker="0052", name="測試 ETF", asset_class="equity", action=BUY, market="tw",
        shares=500, rungs=2, lot_shares=250, price=95.0, step=1.0,
        anchor_before=100.0, anchor_after=98.0, rung_before=0, rung_after=2,
        est_fee=10, est_tax=0, blocks=[],
    )
    defaults.update(overrides)
    return Decision(**defaults)


class _RecordConn:
    """Fake connection for _record_grid_trade's final trades-INSERT + accounts/
    brokers lookups — the only DB work left once evaluate_all()/commit_fill()
    are monkeypatched away."""

    def __init__(self, account_name: str | None = None, broker_id: str | None = None):
        self.account_name = account_name
        self.broker_id = broker_id
        self.inserted_params = None
        self._last_sql = ""

    def execute(self, sql, params=None):
        self._last_sql = sql
        if sql.strip().startswith("INSERT INTO trades"):
            self.inserted_params = params
        return self

    def fetchone(self):
        if "FROM brokers" in self._last_sql:
            return {"id": self.broker_id} if self.broker_id is not None else None
        if "FROM accounts" in self._last_sql:
            return {"name": self.account_name} if self.account_name is not None else None
        return None


def _patch_grid_trade_deps(monkeypatch, decisions, commit_result=None, account_name="國泰證券"):
    monkeypatch.setattr(linebot, "_market_map", lambda: {})
    monkeypatch.setattr(linebot, "evaluate_all", lambda *a, **k: decisions)
    commit_calls = []

    def fake_commit_fill(code, action, shares, price, rungs, step, trade_date=None):
        commit_calls.append(
            {"code": code, "action": action, "shares": shares, "price": price,
             "rungs": rungs, "step": step, "trade_date": trade_date}
        )
        return commit_result

    monkeypatch.setattr(linebot, "commit_fill", fake_commit_fill)
    monkeypatch.setattr(linebot, "get_setting", lambda key: "acct-1")
    monkeypatch.setattr(linebot, "get_db", lambda: _fake_get_db(_RecordConn(account_name)))
    return commit_calls


def test_record_grid_trade_refuses_when_ticker_not_enabled(monkeypatch):
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[])
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert "不是啟用中的網格標的" in reply
    assert calls == []


def test_record_grid_trade_refuses_on_skip_decision(monkeypatch):
    decision = make_decision(action="SKIP", blocks=["取不到即時報價"])
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision])
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert "取不到即時報價" in reply
    assert calls == []


def test_record_grid_trade_refuses_on_direction_mismatch(monkeypatch):
    # price 105 > anchor_before 100 implies SELL, but caller typed 網格買 (BUY)
    decision = make_decision(anchor_before=100.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision])
    reply = linebot._record_grid_trade("0052", "BUY", 500, 105.0, None)
    assert "方向" in reply and "不一致" in reply
    assert calls == []


def test_record_grid_trade_uses_decision_rungs_when_shares_match(monkeypatch):
    decision = make_decision(shares=500, rungs=2, lot_shares=250, anchor_before=100.0)
    result = make_decision(rungs=2, anchor_before=100.0, anchor_after=98.0, rung_before=0, rung_after=2, est_fee=10, est_tax=0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision], commit_result=result)
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert len(calls) == 1
    assert calls[0] == {"code": "0052", "action": "BUY", "shares": 500, "price": 95.0,
                         "rungs": 2, "step": 1.0, "trade_date": None}
    assert "✅" in reply
    assert "網格狀態" in reply
    assert "跟你打的" not in reply  # no mismatch warning


def test_record_grid_trade_warns_but_keeps_user_shares_on_mismatch(monkeypatch):
    decision = make_decision(shares=500, rungs=2, lot_shares=250, anchor_before=100.0)
    result = make_decision(rungs=2, anchor_before=100.0, anchor_after=98.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision], commit_result=result)
    reply = linebot._record_grid_trade("0052", "BUY", 1000, 95.0, None)
    assert calls[0]["shares"] == 1000  # user's shares, not the decision's 500
    assert calls[0]["rungs"] == 2      # but rungs still come from the decision
    assert "跟你打的 1,000 股不同" in reply


def test_record_grid_trade_falls_back_to_lot_shares_when_hold(monkeypatch):
    # rungs=0 (too close to anchor, no blocks) -> fall back to shares/lot_shares
    decision = make_decision(action="HOLD", rungs=0, shares=0, lot_shares=250,
                              anchor_before=100.0, blocks=[])
    result = make_decision(rungs=2, anchor_before=100.0, anchor_after=98.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision], commit_result=result)
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert calls[0]["rungs"] == 2  # 500 / 250
    assert "不到一格" in reply


def test_record_grid_trade_surfaces_risk_gate_block_reason(monkeypatch):
    decision = make_decision(action="REVIEW", rungs=0, shares=0, lot_shares=250,
                              anchor_before=100.0, blocks=["已加碼至上限（第 5 階 / 上限 5 階）"])
    result = make_decision(rungs=2, anchor_before=100.0, anchor_after=98.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision], commit_result=result)
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert calls  # still records
    assert "已加碼至上限" in reply
    assert "不到一格" not in reply


def test_record_grid_trade_refuses_when_lot_shares_unknown(monkeypatch):
    decision = make_decision(action="HOLD", rungs=0, shares=0, lot_shares=0, anchor_before=100.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision])
    reply = linebot._record_grid_trade("0052", "BUY", 500, 95.0, None)
    assert "無法試算單階股數" in reply
    assert calls == []


def test_record_grid_trade_sell_direction_ok_when_price_above_anchor(monkeypatch):
    decision = make_decision(action=SELL, shares=500, rungs=2, lot_shares=250, anchor_before=100.0)
    result = make_decision(action=SELL, rungs=2, anchor_before=100.0, anchor_after=102.0)
    calls = _patch_grid_trade_deps(monkeypatch, decisions=[decision], commit_result=result)
    reply = linebot._record_grid_trade("0052", "SELL", 500, 105.0, None)
    assert calls[0]["action"] == "SELL"
    assert "✅" in reply
