"""Python port of the frontend calcFIFO (frontend/src/app/utils.ts) — keep in sync.

Used by scheduled LINE reports to compute realized PnL and current holdings
server-side without duplicating logic in every job.
"""
import math
from collections import defaultdict

from database import get_db


def calc_fifo(trades: list[dict], market: str = "tw") -> dict:
    """trades: [{id, date, type, shares, price, fee}] in any order."""
    sorted_trades = sorted(trades, key=lambda t: (t["date"], 0 if t["type"] == "buy" else 1))
    buy_queue: list[dict] = []
    realized_total = 0.0
    sells: list[dict] = []

    for t in sorted_trades:
        fee = t.get("fee") or 0
        shares = t.get("shares") or 0
        price = t.get("price") or 0

        if t["type"] == "buy":
            unit = (shares * price + fee) / shares if shares else 0
            buy_queue.append({"shares": shares, "unit": unit})
        else:
            amount = shares * price
            tax = math.floor(amount * 0.003) if market == "tw" else 0
            proceeds = amount - fee - tax
            remaining = shares
            cost = 0.0
            while remaining > 0 and buy_queue:
                lot = buy_queue[0]
                used = min(remaining, lot["shares"])
                cost += used * lot["unit"]
                lot["shares"] -= used
                remaining -= used
                if lot["shares"] <= 0:
                    buy_queue.pop(0)
            r = proceeds - cost
            realized_total += r
            sells.append({"id": t["id"], "date": t["date"], "realized": r})

    holding = sum(l["shares"] for l in buy_queue)
    cost_total = sum(l["shares"] * l["unit"] for l in buy_queue)
    return {
        "realizedPnL": realized_total,
        "holdingShares": holding,
        "avgCost": cost_total / holding if holding > 0 else 0,
        "sells": sells,
    }


def load_trades_by_code() -> tuple[dict[str, list[dict]], dict[str, str]]:
    """Returns ({code: trades}, {code: market})."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM trades ORDER BY date ASC").fetchall()
        markets = {r["code"]: r["market"] for r in
                   conn.execute("SELECT code, market FROM trade_markets").fetchall()}
    by_code: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_code[r["code"]].append(dict(r))
    return by_code, markets


def current_holdings() -> list[dict]:
    """[{code, shares, avgCost, market}] for codes with holdingShares > 0."""
    by_code, markets = load_trades_by_code()
    out = []
    for code, ts in by_code.items():
        mkt = markets.get(code, "tw")
        f = calc_fifo(ts, mkt)
        if f["holdingShares"] > 0:
            out.append({"code": code, "shares": f["holdingShares"],
                        "avgCost": f["avgCost"], "market": mkt})
    return out
