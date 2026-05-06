import logging

from fastapi import APIRouter, HTTPException
from database import get_db
from models import TradeIn, MarketIn

router = APIRouter()
logger = logging.getLogger(__name__)


def _row_to_trade(r) -> dict:
    return {
        "id": r["id"], "date": r["date"], "type": r["type"],
        "shares": r["shares"], "price": r["price"],
        "fee": r["fee"], "sigRef": r["sig_ref"], "note": r["note"],
        "accountId": r["account_id"], "settled": r["settled"],
    }


def _settlement_date_str(date_str: str) -> str:
    from datetime import date, timedelta
    d = date.fromisoformat(date_str)
    added = 0
    while added < 2:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d.isoformat()


def fix_unsettled_trades():
    """One-time startup correction: the initial schema migration set settled=TRUE
    for all existing trades. Un-settle buy trades whose T+2 date is today or future
    so they appear correctly in account management and calendar."""
    from datetime import date as _date
    with get_db() as conn:
        already = conn.execute(
            "SELECT value FROM settings WHERE key='fix_unsettled_applied'"
        ).fetchone()
        if already:
            return
        today = _date.today().isoformat()
        rows = conn.execute(
            "SELECT id, date FROM trades WHERE type='buy' AND settled=TRUE"
        ).fetchall()
        fixed = 0
        for r in rows:
            if _settlement_date_str(r["date"]) >= today:
                conn.execute("UPDATE trades SET settled=FALSE WHERE id=%s", (r["id"],))
                fixed += 1
        conn.execute(
            "INSERT INTO settings(key,value) VALUES('fix_unsettled_applied','true')"
            " ON CONFLICT(key) DO UPDATE SET value='true'"
        )
    if fixed:
        logger.info("fix_unsettled_trades: corrected %d trade(s) to settled=FALSE", fixed)


def process_due_settlements():
    """Auto-deduct T+2 settlement payments from linked accounts on settlement day."""
    import uuid
    from datetime import date as _date
    today = _date.today().isoformat()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM trades WHERE type='buy' AND settled=FALSE AND account_id IS NOT NULL"
        ).fetchall()
        for r in rows:
            if _settlement_date_str(r["date"]) != today:
                continue
            amount = r["shares"] * r["price"] + r["fee"]
            txn_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO account_transactions(id, date, type, amount, account_id, note)"
                " VALUES (%s,%s,'withdrawal',%s,%s,%s)",
                (txn_id, today, amount, r["account_id"],
                 f"股票交割 {r['code']} {int(r['shares'])}股"),
            )
            conn.execute(
                "UPDATE accounts SET balance = balance - %s WHERE id=%s",
                (amount, r["account_id"]),
            )
            conn.execute("UPDATE trades SET settled=TRUE WHERE id=%s", (r["id"],))


@router.get("/trades")
def get_all_trades():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM trades ORDER BY date ASC").fetchall()
    result: dict[str, list] = {}
    for r in rows:
        result.setdefault(r["code"], []).append(_row_to_trade(r))
    return result


@router.get("/trades/{code}")
def get_trades(code: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM trades WHERE code=%s ORDER BY date ASC", (code,)
        ).fetchall()
    return [_row_to_trade(r) for r in rows]


@router.post("/trades/{code}", status_code=201)
def create_trade(code: str, trade: TradeIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO trades(id, code, date, type, shares, price, fee, sig_ref, note, account_id, settled)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  code=EXCLUDED.code, date=EXCLUDED.date, type=EXCLUDED.type,"
            "  shares=EXCLUDED.shares, price=EXCLUDED.price, fee=EXCLUDED.fee,"
            "  sig_ref=EXCLUDED.sig_ref, note=EXCLUDED.note, account_id=EXCLUDED.account_id,"
            "  settled=EXCLUDED.settled",
            (trade.id, code, trade.date, trade.type, trade.shares,
             trade.price, trade.fee, trade.sigRef, trade.note, trade.accountId, trade.settled),
        )
        row = conn.execute("SELECT * FROM trades WHERE id=%s", (trade.id,)).fetchone()
    return _row_to_trade(row)


@router.delete("/trades/{trade_id}")
def delete_trade(trade_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM trades WHERE id=%s", (trade_id,)).fetchone():
            raise HTTPException(404, "Trade not found")
        conn.execute("DELETE FROM trades WHERE id=%s", (trade_id,))
    return {"ok": True}


# ── Trade Markets ─────────────────────────────────────────────────────────────

@router.get("/trade-markets")
def get_trade_markets():
    with get_db() as conn:
        rows = conn.execute("SELECT code, market FROM trade_markets").fetchall()
    return {r["code"]: r["market"] for r in rows}


@router.put("/trade-markets/{code}")
def set_trade_market(code: str, body: MarketIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO trade_markets(code, market) VALUES (%s,%s)"
            " ON CONFLICT(code) DO UPDATE SET market=EXCLUDED.market",
            (code, body.market),
        )
    return {"code": code, "market": body.market}
