"""Bridges watchList's Postgres data into the ported atrgrid decision engine.

The engine (``grid.engine``) is pure — it only knows about the ``Holding`` /
``Position`` / ``Settings`` / ``State`` dataclasses in ``grid.config`` /
``grid.state``. This module is the only place that talks to the database: it
assembles those dataclasses from watchList's existing tables (``trades``,
``dividend_records``, ``accounts``, ``stocks``) plus two grid-only tables
(``grid_positions`` — which also owns the grid's equity/bond/leveraged/stock
classification in its own ``asset_class`` column, deliberately kept separate
from the shared ``asset_classes`` table used by the balance-sheet view's
Chinese portfolio-allocation labels — and ``grid_params``), runs the engine,
and persists the mutations the engine makes back to ``grid_positions``.

Cost basis note — LIFO vs FIFO
-------------------------------
watchList's own bookkeeping (``fifo.py``, used by reports/frontend) is FIFO.
The grid's "no-loss-sell" gate wants LIFO instead: it's asking "would selling
the lot I most recently bought realize a loss right now?", which is what the
grid's anchor/rung math is actually tracking — not the account's FIFO cost.
So ``Position.lots`` here is built from ``fifo.calc_fifo()``'s leftover
``openLots`` (which, after FIFO consumption, is naturally left oldest-first)
and consumed from the *end* — ``Position.apply_sell``/``peek_sell_basis``
already do that (see ``grid/state.py``). This never reorders or mutates
watchList's own FIFO trade ledger; it's a read-only reinterpretation of the
same trades for the grid's own question.

Persistence note — why every evaluate() call writes back
----------------------------------------------------------
``engine.evaluate()`` mutates ``position.anchor`` in place for two reasons
that have nothing to do with placing an order: ex-dividend correction and
anchor drift (see ``grid/engine.py``). Both are idempotent per day (guarded
by ``applied_ex_dividends`` / ``last_drift_date``), so it's safe to persist
them after *every* evaluate() call, whether or not a trade resulted. The
original atrgrid tool got this wrong in its web console — its preview
endpoint discarded these mutations, and only a CLI ``--persist-anchors`` flag
(used by its cron job, not the web UI) saved them, with the code comment
admitting "these should be persisted even without a trade, or they get
recomputed every day". We persist unconditionally instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Sequence

from database import get_db
from fifo import calc_fifo

from .config import GridParams, Holding, Settings, VALID_CLASSES
from .engine import BUY, SELL, Decision, evaluate as engine_evaluate, commit as engine_commit
from .fees import split_buy_cost, split_sell_cost
from .indicators import Bar
from .state import Lot, Position, State

_SETTING_PREFIX = "grid_"


class AdapterError(Exception):
    """Raised for grid-specific data problems (missing asset class, missing
    grid_params, disabled/unknown ticker) — distinct from plain bugs."""


# --------------------------------------------------------------- settings

def _grid_setting(conn, key: str, default: str) -> str:
    row = conn.execute(
        "SELECT value FROM settings WHERE key=%s", (_SETTING_PREFIX + key,)
    ).fetchone()
    return row["value"] if row else default


def set_grid_setting(key: str, value: str) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(%s,%s)"
            " ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
            (_SETTING_PREFIX + key, str(value)),
        )


def build_settings(conn) -> Settings:
    rows = conn.execute("SELECT asset_class, params FROM grid_params").fetchall()
    if not rows:
        raise AdapterError("grid_params 是空的，請先執行一次性匯入（見 grid/seed.py）")
    defaults = {r["asset_class"]: GridParams(**r["params"]) for r in rows}
    missing = VALID_CLASSES - set(defaults)
    if missing:
        raise AdapterError(f"grid_params 缺少資產類別：{sorted(missing)}")

    def _account_balance(setting_key: str) -> float:
        account_id = _grid_setting(conn, setting_key, "")
        if not account_id:
            return 0.0
        row = conn.execute(
            "SELECT balance FROM accounts WHERE id=%s", (account_id,)
        ).fetchone()
        if row is None:
            raise AdapterError(f"grid_{setting_key}={account_id} 找不到對應帳戶")
        return float(row["balance"])

    cash = _account_balance("cash_account_id")
    us_cash = _account_balance("us_cash_account_id")

    return Settings(
        fee_discount=Decimal(_grid_setting(conn, "fee_discount", "0.28")),
        fee_minimum=int(_grid_setting(conn, "fee_minimum", "1")),
        cash=cash,
        cash_floor=float(_grid_setting(conn, "cash_floor", "0")),
        us_cash=us_cash,
        us_cash_floor=float(_grid_setting(conn, "us_cash_floor", "0")),
        decision_time=_grid_setting(conn, "decision_time", "13:00"),
        timezone=_grid_setting(conn, "timezone", "Asia/Taipei"),
        max_data_staleness_days=int(_grid_setting(conn, "max_data_staleness_days", "5")),
        min_step_cost_multiple=float(_grid_setting(conn, "min_step_cost_multiple", "3.0")),
        defaults=defaults,
    )


# ------------------------------------------------------- pure row builders
#
# These take already-fetched data (dicts/rows) and build the engine's
# dataclasses. Kept free of DB calls so they're unit-testable without a live
# database — the thin `build_*` wrappers below just fetch rows and delegate.

def holding_from_row(
    code: str,
    name: str,
    asset_class: str,
    grid_row: dict[str, Any],
    fifo_result: dict[str, Any],
    ex_dividend_rows: Sequence[dict[str, Any]],
    market: str = "tw",
) -> Holding:
    if asset_class not in VALID_CLASSES:
        raise AdapterError(
            f"{code}: 資產類別 '{asset_class}' 不合法，"
            f"必須是 {sorted(VALID_CLASSES)} 之一"
        )

    tracked_since: str | None = None
    created_at = grid_row.get("created_at")
    if created_at:
        tracked_since = datetime.utcfromtimestamp(created_at / 1000).date().isoformat()

    ex_dividends = [
        {"date": r["ex_date"], "amount": float(r["cash_div"])}
        for r in ex_dividend_rows
        if r.get("cash_div") and (tracked_since is None or r["ex_date"] > tracked_since)
    ]

    return Holding(
        ticker=code,
        name=name,
        asset_class=asset_class,
        shares=int(fifo_result["holdingShares"]),
        avg_cost=float(fifo_result["avgCost"]),
        market=market,
        ticker_verified=bool(grid_row["enabled"]),
        enabled=True,
        overrides=dict(grid_row.get("grid_overrides") or {}),
        ex_dividends=ex_dividends,
        tracked_since=tracked_since,
    )


def position_from_row(code: str, grid_row: dict[str, Any], fifo_result: dict[str, Any]) -> Position:
    lots = [
        Lot(date=l["date"], price=l["unit"], shares=int(l["shares"]), source="fifo")
        for l in fifo_result["openLots"]
    ]
    return Position(
        ticker=code,
        shares=int(fifo_result["holdingShares"]),
        anchor=float(grid_row["anchor"]),
        rung=int(grid_row["rung"]),
        baseline_shares=float(grid_row["baseline_shares"]),
        lots=lots,
        realized_pnl=0.0,
        last_trade_date=None,
        applied_ex_dividends=list(grid_row.get("applied_ex_dividends") or []),
        last_drift_date=grid_row.get("last_drift_date"),
    )


# --------------------------------------------------------------- DB glue

def _trades_by_code(conn, codes: list[str]) -> tuple[dict[str, list[dict]], dict[str, str]]:
    if not codes:
        return {}, {}
    rows = conn.execute(
        "SELECT * FROM trades WHERE code = ANY(%s) ORDER BY date ASC", (codes,)
    ).fetchall()
    markets = {
        r["code"]: r["market"]
        for r in conn.execute(
            "SELECT code, market FROM trade_markets WHERE code = ANY(%s)", (codes,)
        ).fetchall()
    }
    by_code: dict[str, list[dict]] = {c: [] for c in codes}
    for r in rows:
        by_code[r["code"]].append(dict(r))
    return by_code, markets


def _build_one(conn, grid_row: dict[str, Any], trades: list[dict], market: str) -> tuple[Holding, Position]:
    code = grid_row["code"]
    asset_class = grid_row.get("asset_class")
    if asset_class is None:
        raise AdapterError(f"{code}: grid_positions.asset_class 未設定")
    fifo_result = calc_fifo(trades, market, asset_class)
    name_row = conn.execute("SELECT name FROM stocks WHERE code=%s", (code,)).fetchone()
    name = name_row["name"] if name_row and name_row["name"] else code
    ex_div_rows = conn.execute(
        "SELECT ex_date, cash_div FROM dividend_records WHERE code=%s ORDER BY ex_date", (code,)
    ).fetchall()

    holding = holding_from_row(code, name, asset_class, grid_row, fifo_result, ex_div_rows, market)
    position = position_from_row(code, grid_row, fifo_result)
    return holding, position


@dataclass
class GridContext:
    settings: Settings
    state: State
    holdings: dict[str, Holding]


def build_context(conn, codes: list[str] | None = None) -> GridContext:
    """Load every enabled grid position (or just `codes`, if given) into a
    ready-to-evaluate GridContext."""
    sql = "SELECT * FROM grid_positions WHERE enabled=TRUE"
    params: tuple = ()
    if codes is not None:
        sql += " AND code = ANY(%s)"
        params = (codes,)
    grid_rows = conn.execute(sql, params).fetchall()

    settings = build_settings(conn)
    trades_by_code, markets = _trades_by_code(conn, [r["code"] for r in grid_rows])

    holdings: dict[str, Holding] = {}
    positions: dict[str, Position] = {}
    for row in grid_rows:
        code = row["code"]
        market = markets.get(code, "tw")
        holding, position = _build_one(conn, row, trades_by_code[code], market)
        holdings[code] = holding
        positions[code] = position

    state = State(cash=settings.cash, us_cash=settings.us_cash, positions=positions)
    return GridContext(settings=settings, state=state, holdings=holdings)


def _persist_position(conn, code: str, position: Position) -> None:
    """Write back anchor/rung/ex-dividend/drift. Safe to call after every
    evaluate() — see module docstring for why this must not be conditional
    on a trade having happened."""
    conn.execute(
        """UPDATE grid_positions
           SET anchor=%s, rung=%s, last_drift_date=%s, applied_ex_dividends=%s
           WHERE code=%s""",
        (
            position.anchor,
            position.rung,
            position.last_drift_date,
            json.dumps(position.applied_ex_dividends),
            code,
        ),
    )


# ------------------------------------------------------------- public API

def evaluate_all(
    bars_fn: Callable[[str], Sequence[Bar]],
    price_fn: Callable[[str], float | None],
    today: str | None = None,
    codes: list[str] | None = None,
) -> list[Decision]:
    """Run today's grid decision for every enabled position.

    `bars_fn`/`price_fn` are injected rather than hardcoded to a network
    call, both so this is testable offline and so the router can plug in
    watchList's existing ohlc.py/quotes.py (Yahoo, with FinMind as the
    documented fallback — see the architecture review, no TWSE tier).
    """
    today = today or date.today().isoformat()
    decisions: list[Decision] = []
    with get_db() as conn:
        ctx = build_context(conn, codes)
        for code, holding in ctx.holdings.items():
            position = ctx.state.positions[code]

            def _skip(reason: str) -> Decision:
                return Decision(
                    ticker=code,
                    name=holding.name,
                    asset_class=holding.asset_class,
                    action="SKIP",
                    market=holding.market,
                    anchor_before=position.anchor,
                    anchor_after=position.anchor,
                    rung_before=position.rung,
                    rung_after=position.rung,
                    position_shares=position.shares,
                    blocks=[reason],
                )

            try:
                bars = bars_fn(code)
                price = price_fn(code)
            except Exception as exc:  # noqa: BLE001 - surfaced as a blocked decision, not a crash
                decisions.append(_skip(f"資料取得失敗：{exc}"))
                continue
            if not bars:
                decisions.append(_skip("沒有日 K 資料"))
                continue
            if price is None or price <= 0:
                decisions.append(_skip("取不到即時報價"))
                continue

            decision = engine_evaluate(holding, position, bars, price, ctx.settings, ctx.state, today=today)
            # Persist ex-dividend/drift adjustments unconditionally (see module docstring).
            _persist_position(conn, code, position)
            decisions.append(decision)
    return decisions


def commit_fill(
    code: str,
    action: str,
    shares: int,
    price: float,
    rungs: int,
    step: float,
    trade_date: str | None = None,
) -> Decision:
    """Apply an actual fill to the grid's own state (anchor/rung/lots).

    `rungs`/`step` must come from the Decision the caller already showed the
    user (from `evaluate_all`) — recomputing them here from fresh bars would
    let the anchor move by a different amount than what the user saw and
    acted on. This mirrors how the original atrgrid web console's record()
    endpoint worked.

    This does NOT touch watchList's `trades` table or account balances —
    the caller (the future `/api/grid/record` route) must insert the trade
    row itself (with `sig_ref='grid'`) so settlement and cash flow go
    through the existing T+2 pipeline (`trades.py::process_due_settlements`)
    instead of a second, parallel bookkeeping path.
    """
    if action not in (BUY, SELL):
        raise AdapterError("action must be BUY or SELL")
    if shares <= 0 or price <= 0 or rungs <= 0:
        raise AdapterError("shares/price/rungs must be positive")
    trade_date = trade_date or date.today().isoformat()

    with get_db() as conn:
        ctx = build_context(conn, [code])
        holding = ctx.holdings.get(code)
        if holding is None:
            raise AdapterError(f"{code} 不是啟用中的網格標的")
        position = ctx.state.positions[code]

        decision = Decision(
            ticker=code,
            name=holding.name,
            asset_class=holding.asset_class,
            action=action,
            market=holding.market,
            shares=shares,
            rungs=rungs,
            price=price,
            step=step,
            anchor_before=position.anchor,
            rung_before=position.rung,
            position_shares=position.shares,
        )
        per_order_shares = shares // rungs
        if action == BUY:
            cost = split_buy_cost(
                rungs, per_order_shares, price, ctx.settings.fee_discount,
                ctx.settings.fee_minimum, holding.market,
            )
            decision.est_fee = cost.fee
            decision.est_cash_flow = -float(cost.net)
            decision.anchor_after = position.anchor - step * rungs
        else:
            if shares > position.shares:
                raise AdapterError(f"賣出 {shares} 股超過持股 {position.shares} 股")
            cost = split_sell_cost(
                rungs, per_order_shares, price, holding.asset_class,
                ctx.settings.fee_discount, ctx.settings.fee_minimum, holding.market,
            )
            decision.est_fee = cost.fee
            decision.est_tax = cost.tax
            decision.est_cash_flow = float(cost.proceeds)
            decision.est_realized_pnl = float(cost.proceeds) - position.peek_sell_basis(shares)
            decision.anchor_after = position.anchor + step * rungs

        engine_commit(ctx.state, decision, trade_date)
        _persist_position(conn, code, position)

    return decision
