"""API for the ATR grid advisory feature.

The decision engine lives in backend/grid/ (ported from a standalone tool,
see grid/adapter.py's module docstring for the migration notes). This router
is thin: it wires watchList's own quote sources (routers/ohlc.py,
routers/quotes.py — Yahoo with a FinMind fallback, see finmind.py) into
grid.adapter.evaluate_all()/commit_fill(), and translates the results to/from
JSON.

Fee/tax note on `record_grid_fill`: we store only the broker fee on the
`trades` row, not the ETF/bond transaction tax grid/fees.py correctly
computes (0.1% for equity ETFs, 0% for bond ETFs). That's because
`fifo.py::calc_fifo` recomputes its own tax from `asset_classes` (0% bond /
0.1% ETF / 0.3% stock, matching grid/fees.py — see fifo.py's docstring),
so folding grid's tax into `fee` would just get double-subtracted. grid's
own advice numbers (est_tax, est_realized_pnl) are unaffected either way —
they're computed independently via grid/fees.py and only ever touch
grid_positions, never fifo.py.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException

from database import get_db, get_setting
from fifo import calc_fifo
from grid.adapter import AdapterError, build_settings, commit_fill, evaluate_all, position_from_row
from grid.config import ConfigError, GridParams, VALID_CLASSES, infer_asset_class
from grid.engine import BUY, SELL, Decision, lot_size, next_grid_levels
from grid.indicators import Bar
from models import GridParamsIn, GridPositionIn, GridPositionPatch, GridPreviewIn, GridRecordIn, TradeIn
from routers.ohlc import get_ohlc
from routers.quotes import _price_tw, _price_us
from routers.trades import create_trade

router = APIRouter()


def _market_map() -> dict[str, str]:
    """Grid positions can be TW or US tickers — one query for the whole
    `trade_markets` table (same one trades/portfolio use), instead of a
    per-code lookup. Doing this per-code inside _bars_fn/_price_fn used to
    open a fresh DB connection for every holding *while evaluate_all() was
    already holding one open* — with several positions that stacks up
    enough concurrent connections to stall waiting on Postgres/Supabase's
    connection limit, which is what made the grid page spin forever."""
    with get_db() as conn:
        rows = conn.execute("SELECT code, market FROM trade_markets").fetchall()
    return {r["code"]: r["market"] for r in rows}


def _make_bars_fn(markets: dict[str, str]):
    def _bars_fn(code: str) -> list[Bar]:
        today = date.today().isoformat()
        raw = get_ohlc(code, days=150, market=markets.get(code, "tw"))
        bars = []
        for r in raw:
            if r["date"] >= today:  # never let today's (still-forming) bar leak into ATR
                continue
            bars.append(Bar(
                date=r["date"], open=r["open"], high=r["high"], low=r["low"],
                close=r["close"], volume=r.get("volume", 0),
            ))
        return bars
    return _bars_fn


def _make_price_fn(markets: dict[str, str]):
    def _price_fn(code: str) -> float | None:
        return _price_us(code) if markets.get(code, "tw") == "us" else _price_tw(code)
    return _price_fn


def sync_grid_position(code: str, enabled: bool, asset_class: str | None = None,
                       market: str | None = None, grid_overrides: dict | None = None) -> dict | None:
    """Mirror 投資組合 的 ATR 勾選 (tracked_stocks.atr_enabled) into grid_positions,
    which is what the ATR 網格 page lists.

    The two used to be independent — the checkbox only wrote `atr_enabled`, while
    grid rows came from the grid page's own add form — so the grid could show
    symbols that weren't ticked (and vice versa). Now `atr_enabled` is the single
    source of truth: ticking creates the grid row (anchored at the current live
    price, exactly like a manual add) — or, if the code was gridded before,
    revives the row it already had.

    Unticking is a soft delete: the row stays with enabled=FALSE, keeping its
    anchor/rung/ex-dividend history, so an accidental untick (or a deliberate
    pause) doesn't reset the grid. get_grid_positions() lists only ticked codes
    and adapter.build_context() only loads enabled ones, so a soft-deleted row
    is invisible to both the page and the daily advice until it's ticked again.

    Returns the new row's summary when one was created, else None.
    """
    if not enabled:
        with get_db() as conn:
            conn.execute("UPDATE grid_positions SET enabled=FALSE WHERE code=%s", (code,))
        return None

    with get_db() as conn:
        existing = conn.execute("SELECT code FROM grid_positions WHERE code=%s", (code,)).fetchone()
        if existing:
            conn.execute("UPDATE grid_positions SET enabled=TRUE WHERE code=%s", (code,))
            return None

        if market is None:
            row = conn.execute("SELECT market FROM trade_markets WHERE code=%s", (code,)).fetchone()
            market = row["market"] if row else "tw"
        if asset_class is None:
            row = conn.execute("SELECT name FROM stocks WHERE code=%s", (code,)).fetchone()
            asset_class = infer_asset_class(code, (row["name"] if row else "") or "", market)
        trade_rows = [
            dict(r) for r in conn.execute(
                "SELECT id, date, type, shares, price, fee FROM trades WHERE code=%s ORDER BY date ASC",
                (code,),
            ).fetchall()
        ]

    if asset_class not in VALID_CLASSES:
        raise HTTPException(400, f"assetClass 必須是 {sorted(VALID_CLASSES)} 之一")
    if market not in ("tw", "us"):
        raise HTTPException(400, "market 必須是 'tw' 或 'us'")

    # Quote fetch is a network round-trip — deliberately outside the connection
    # above (see _market_map()'s note on holding Supabase connections open).
    price = _price_us(code) if market == "us" else _price_tw(code)
    if price is None or price <= 0:
        raise HTTPException(400, f"取不到 {code} 的即時報價，請稍後再試")
    baseline_shares = int(calc_fifo(trade_rows, market, asset_class)["holdingShares"])

    with get_db() as conn:
        # Register (or confirm) this code's market for future advice/position
        # lookups (via trade_markets, same table trades/portfolio use).
        conn.execute(
            "INSERT INTO trade_markets(code, market) VALUES (%s,%s)"
            " ON CONFLICT(code) DO UPDATE SET market=EXCLUDED.market",
            (code, market),
        )
        conn.execute(
            """
            INSERT INTO grid_positions
                (code, enabled, anchor, rung, baseline_shares, last_drift_date,
                 applied_ex_dividends, grid_overrides, created_at, asset_class)
            VALUES (%s, TRUE, %s, 0, %s, NULL, '[]', %s, %s, %s)
            """,
            (code, price, baseline_shares, json.dumps(grid_overrides or {}),
             int(time.time() * 1000), asset_class),
        )
    return {
        "code": code, "assetClass": asset_class, "market": market,
        "anchor": round(price, 3), "baselineShares": baseline_shares,
    }


def mark_atr_enabled(code: str, enabled: bool) -> None:
    """Set the portfolio's ATR checkbox (tracked_stocks.atr_enabled) for `code`,
    creating the tracked row if the code isn't tracked yet. Lives here rather
    than in routers/tracked.py to keep the dependency one-way (tracked imports
    grid, never the reverse)."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tracked_stocks(code, atr_enabled, added_at) VALUES (%s,%s,%s)"
            " ON CONFLICT(code) DO UPDATE SET atr_enabled=EXCLUDED.atr_enabled",
            (code, enabled, int(time.time() * 1000)),
        )


def _decision_to_dict(d: Decision) -> dict:
    return {
        "ticker": d.ticker, "name": d.name, "assetClass": d.asset_class,
        "action": d.action, "shares": d.shares, "rungs": d.rungs, "lotShares": d.lot_shares,
        "price": round(d.price, 2),
        "anchorBefore": round(d.anchor_before, 4), "anchorAfter": round(d.anchor_after, 4),
        "step": round(d.step, 4), "stepPct": round(d.step_pct, 2),
        "priceBandLow": round(d.price_band_low, 2) if d.price_band_low is not None else None,
        "priceBandHigh": round(d.price_band_high, 2) if d.price_band_high is not None else None,
        "atr": round(d.atr, 4) if d.atr is not None else None,
        "atrPct": round(d.atr_pct, 2) if d.atr_pct is not None else None,
        "rungBefore": d.rung_before, "rungAfter": d.rung_after,
        "positionShares": d.position_shares,
        "estGross": round(d.est_gross, 0), "estFee": d.est_fee, "estTax": d.est_tax,
        "estCashFlow": round(d.est_cash_flow, 2),
        "estRealizedPnl": round(d.est_realized_pnl, 2) if d.est_realized_pnl is not None else None,
        "signalRungs": d.signal_rungs,
        "regime": d.regime, "baseShares": d.base_shares,
        "reasons": d.reasons, "blocks": d.blocks, "notes": d.notes,
    }


def build_grid_alert_message() -> str | None:
    """Today's actionable grid decisions as a LINE-ready message block, or
    None if there's nothing to report. Used by push_alerts.py to fold into
    the existing weekday-13:00 price-alert push (same decision time as the
    grid itself) instead of sending a second, separate notification."""
    try:
        markets = _market_map()
        decisions = evaluate_all(_make_bars_fn(markets), _make_price_fn(markets))
    except AdapterError:
        return None
    actionable = sorted(
        (d for d in decisions if d.shares > 0 and d.action in (BUY, SELL)),
        key=lambda d: d.ticker,
    )
    if not actionable:
        return None
    lines = []
    for d in actionable:
        verb = "買進" if d.action == BUY else "賣出"
        band = (
            f"（{d.price_band_low:.2f}~{d.price_band_high:.2f} 仍算此份數）"
            if d.price_band_low is not None and d.price_band_high is not None
            else ""
        )
        lines.append(
            f"  • {d.ticker} {d.name}　{verb} {d.rungs}×{d.lot_shares}={d.shares} 股　"
            f"@{d.price:.2f}{band}"
        )
    return "🕸️ ATR 網格今日建議\n\n" + "\n".join(lines) + "\n\n請至網站「ATR 網格」確認並回填成交。"


@router.get("/grid/advice")
def get_grid_advice():
    """Today's decision for every enabled grid position. Read-only except
    for the anchor/ex-dividend/drift persistence evaluate_all() always does
    (see grid/adapter.py docstring) — never places or records an order."""
    today = date.today().isoformat()
    try:
        markets = _market_map()
        decisions = evaluate_all(_make_bars_fn(markets), _make_price_fn(markets), today=today)
    except AdapterError as exc:
        raise HTTPException(400, str(exc))

    actionable = [d for d in decisions if d.shares > 0]
    return {
        "asOf": today,
        "decisions": [_decision_to_dict(d) for d in decisions],
        "summary": {
            "orders": sum(d.rungs for d in actionable),
            "tickers": len(actionable),
            "netCashFlow": round(sum(d.est_cash_flow for d in actionable), 2),
            "cost": sum(d.est_fee + d.est_tax for d in actionable),
        },
    }


@router.post("/grid/preview")
def preview_grid_fill(body: GridPreviewIn):
    """Recompute today's grid decision for one code at a manually-supplied
    price instead of the live quote.

    The live `/grid/advice` list only ever shows what the engine says *right
    now*, against the current spot price and the currently-persisted
    anchor/rung — a suggestion from a few days ago (e.g. Saturday) can be
    gone by the time the user actually gets the fill (e.g. Monday), because
    the price and/or anchor have since moved and the decision recomputes to
    HOLD. This lets the record UI ask "what would the engine have said at
    the price I actually traded at" so a late fill can still be recorded
    with correct rungs/step, instead of only ever being able to record
    whatever happens to be showing as actionable today."""
    if body.price <= 0:
        raise HTTPException(400, "price 必須大於 0")
    markets = _market_map()
    try:
        decisions = evaluate_all(_make_bars_fn(markets), lambda _c: body.price, codes=[body.code])
    except AdapterError as exc:
        raise HTTPException(400, str(exc))
    if not decisions:
        raise HTTPException(404, f"{body.code} 不是啟用中的網格標的")
    return _decision_to_dict(decisions[0])


@router.get("/grid/asset-classes")
def get_grid_asset_classes():
    """{code: assetClass} for every grid position, including soft-deleted ones
    (unticked codes keep their row — see sync_grid_position) — a lightweight
    lookup the frontend loads at startup so calcFIFO() can pick the right TW
    sell-tax rate for realized-P&L display. Deliberately not the same
    endpoint/shape as the shared /api/asset-classes (Chinese balance-sheet
    labels) — see grid_positions.asset_class's DDL comment."""
    with get_db() as conn:
        rows = conn.execute("SELECT code, asset_class FROM grid_positions WHERE asset_class IS NOT NULL").fetchall()
    return {r["code"]: r["asset_class"] for r in rows}


@router.get("/grid/positions")
def get_grid_positions():
    """Status of every grid position — anchor, rung, lot size, and the next few
    buy/sell trigger prices.

    Scoped to codes ticked ATR in 投資組合: unticking soft-deletes the row (see
    sync_grid_position), and a soft-deleted row should be off the page entirely,
    not just greyed out. Rows that *are* ticked show whether or not they're
    enabled — that's the page's own 停用 button, which pauses the advice while
    keeping the symbol on the list."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM grid_positions"
            " WHERE code IN (SELECT code FROM tracked_stocks WHERE atr_enabled)"
            " ORDER BY code"
        ).fetchall()
        codes = [r["code"] for r in rows]
        names = {}
        by_code: dict[str, list] = {c: [] for c in codes}
        markets: dict[str, str] = {}
        if codes:
            names = {
                r["code"]: r["name"]
                for r in conn.execute("SELECT code, name FROM stocks WHERE code = ANY(%s)", (codes,)).fetchall()
            }
            for r in conn.execute("SELECT * FROM trades WHERE code = ANY(%s) ORDER BY date ASC", (codes,)).fetchall():
                by_code[r["code"]].append(dict(r))
            markets = {
                r["code"]: r["market"]
                for r in conn.execute("SELECT code, market FROM trade_markets WHERE code = ANY(%s)", (codes,)).fetchall()
            }
        try:
            settings = build_settings(conn)
        except AdapterError:
            settings = None

    result = []
    for row in rows:
        code = row["code"]
        asset_class = row["asset_class"]
        fifo_result = calc_fifo(by_code.get(code, []), markets.get(code, "tw"), asset_class)
        entry = {
            "code": code,
            "name": names.get(code, code),
            "assetClass": asset_class,
            "market": markets.get(code, "tw"),
            "enabled": row["enabled"],
            "shares": int(fifo_result["holdingShares"]),
            "avgCost": round(fifo_result["avgCost"], 4),
            "anchor": round(row["anchor"], 3),
            "rung": row["rung"],
            "baselineShares": row["baseline_shares"],
        }
        if settings is not None and asset_class in settings.defaults and row["anchor"] > 0:
            params = settings.params_for(asset_class).merged(row["grid_overrides"] or {})
            position = position_from_row(code, dict(row), fifo_result)
            step_guess = row["anchor"] * params.min_step_pct / 100
            buys, sells = next_grid_levels(position, step_guess, 3)
            entry.update({
                "lotShares": lot_size(row["anchor"], settings, markets.get(code, "tw")),
                "maxBuyRungs": params.max_buy_rungs,
                "maxSellRungs": params.max_sell_rungs,
                "nextBuy": [round(p, 2) for p in buys],
                "nextSell": [round(p, 2) for p in sells],
            })
        result.append(entry)
    return result


@router.post("/grid/positions", status_code=201)
def add_grid_position(body: GridPositionIn):
    """Add a symbol to the grid directly (the UI adds them by ticking ATR in
    投資組合 instead — this stays for codes you don't hold yet, which never show
    up in the portfolio table). Anchor is set to the current live price
    (fetched server-side, same as atrgrid's own `init`/`add-holding` behavior:
    the grid starts from "right now", it doesn't retroactively grid past price
    history) and baseline_shares from the symbol's current real holding (via
    FIFO over `trades` — 0 if watchList has no trades for it yet, which is
    fine, the grid will just start from a flat position).

    Marks the code atr_enabled too: that flag is the grid's membership list
    (see sync_grid_position), and /grid/positions lists only flagged codes, so
    skipping it would add a row nobody can see."""
    code = body.code.strip()
    if not code:
        raise HTTPException(400, "code 不可為空")

    with get_db() as conn:
        existing = conn.execute(
            "SELECT code FROM grid_positions WHERE code=%s AND enabled", (code,)
        ).fetchone()
    if existing:
        raise HTTPException(409, f"{code} 已經是網格標的")

    created = sync_grid_position(code, True, body.assetClass, body.market, body.gridOverrides)
    mark_atr_enabled(code, True)
    return created


@router.post("/grid/positions/{code}/reset-anchor")
def reset_grid_anchor(code: str):
    """Re-anchor a grid position to its current live price and zero the rung —
    the same starting state add_grid_position() gives a brand-new symbol.

    For when a position's anchor sat untouched for a long time (soft-deleted
    while unticked, or just never traded) and reviving it against the old
    anchor would immediately fire a pile of catch-up rungs. This intentionally
    forgets "how many steps up/down from anchor" — that's the point — but
    baseline_shares (the real share count grid math compares against) and the
    trade history are untouched."""
    with get_db() as conn:
        row = conn.execute("SELECT market FROM trade_markets WHERE code=%s", (code,)).fetchone()
        if not conn.execute("SELECT 1 FROM grid_positions WHERE code=%s", (code,)).fetchone():
            raise HTTPException(404, f"{code} 不是網格標的")
    market = row["market"] if row else "tw"

    price = _price_us(code) if market == "us" else _price_tw(code)
    if price is None or price <= 0:
        raise HTTPException(400, f"取不到 {code} 的即時報價，請稍後再試")

    with get_db() as conn:
        conn.execute("UPDATE grid_positions SET anchor=%s, rung=0 WHERE code=%s", (price, code))
    return {"code": code, "anchor": round(price, 3), "rung": 0}


@router.put("/grid/positions/{code}")
def patch_grid_position(code: str, body: GridPositionPatch):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM grid_positions WHERE code=%s", (code,)).fetchone()
        if not row:
            raise HTTPException(404, f"{code} 不是網格標的")
        if body.assetClass is not None and body.assetClass not in VALID_CLASSES:
            raise HTTPException(400, f"assetClass 必須是 {sorted(VALID_CLASSES)} 之一")
        enabled = row["enabled"] if body.enabled is None else body.enabled
        anchor = row["anchor"] if body.anchor is None else body.anchor
        overrides = row["grid_overrides"] if body.gridOverrides is None else body.gridOverrides
        asset_class = row["asset_class"] if body.assetClass is None else body.assetClass
        conn.execute(
            "UPDATE grid_positions SET enabled=%s, anchor=%s, grid_overrides=%s, asset_class=%s WHERE code=%s",
            (enabled, anchor, json.dumps(overrides), asset_class, code),
        )
    return {"ok": True}


@router.post("/grid/record")
def record_grid_fill(body: GridRecordIn):
    """Apply an actual fill: mutate the grid's own anchor/rung (via
    grid.adapter.commit_fill) and insert the trade into watchList's own
    `trades` table so it flows through the existing FIFO/settlement/report
    pipeline like any other trade."""
    action = body.action.upper()
    try:
        decision = commit_fill(body.code, action, body.shares, body.price, body.rungs, body.step, trade_date=body.date)
    except AdapterError as exc:
        raise HTTPException(400, str(exc))

    trade_date = body.date or date.today().isoformat()
    default_setting = "grid_us_cash_account_id" if decision.market == "us" else "grid_cash_account_id"
    account_id = body.accountId or get_setting(default_setting)
    trade = TradeIn(
        id=str(uuid.uuid4()),
        date=trade_date,
        type="buy" if action == "BUY" else "sell",
        shares=body.shares,
        price=body.price,
        fee=decision.est_fee,
        sigRef="grid",
        note=f"ATR 網格 {decision.rungs} 份",
        accountId=account_id,
        settled=False,
    )
    create_trade(body.code, trade)

    return {
        "ok": True,
        "code": body.code,
        "anchor": round(decision.anchor_after, 3),
        "rung": decision.rung_after,
        "fee": decision.est_fee,
        "tax": decision.est_tax,
        "realizedPnl": decision.est_realized_pnl,
    }


@router.get("/grid/params")
def get_grid_params():
    with get_db() as conn:
        rows = conn.execute("SELECT asset_class, params FROM grid_params ORDER BY asset_class").fetchall()
    return {r["asset_class"]: r["params"] for r in rows}


@router.put("/grid/params/{asset_class}")
def put_grid_params(asset_class: str, body: GridParamsIn):
    if asset_class not in VALID_CLASSES:
        raise HTTPException(400, f"asset_class 必須是 {sorted(VALID_CLASSES)} 之一")
    try:
        GridParams(**body.params).validate(asset_class)
    except (TypeError, ConfigError) as exc:
        raise HTTPException(400, str(exc))
    with get_db() as conn:
        conn.execute(
            "INSERT INTO grid_params(asset_class, params) VALUES (%s,%s)"
            " ON CONFLICT(asset_class) DO UPDATE SET params=EXCLUDED.params",
            (asset_class, json.dumps(body.params)),
        )
    return {"ok": True}
