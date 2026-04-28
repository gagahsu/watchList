from fastapi import APIRouter, HTTPException
from database import get_db
from models import TradeIn, MarketIn

router = APIRouter()


def _row_to_trade(r) -> dict:
    return {
        "id": r["id"], "date": r["date"], "type": r["type"],
        "shares": r["shares"], "price": r["price"],
        "fee": r["fee"], "sigRef": r["sig_ref"],
    }


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
            "SELECT * FROM trades WHERE code=? ORDER BY date ASC", (code,)
        ).fetchall()
    return [_row_to_trade(r) for r in rows]


@router.post("/trades/{code}", status_code=201)
def create_trade(code: str, trade: TradeIn):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO trades(id, code, date, type, shares, price, fee, sig_ref)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (trade.id, code, trade.date, trade.type, trade.shares,
             trade.price, trade.fee, trade.sigRef),
        )
        row = conn.execute("SELECT * FROM trades WHERE id=?", (trade.id,)).fetchone()
    return _row_to_trade(row)


@router.delete("/trades/{trade_id}")
def delete_trade(trade_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone():
            raise HTTPException(404, "Trade not found")
        conn.execute("DELETE FROM trades WHERE id=?", (trade_id,))
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
            "INSERT INTO trade_markets(code, market) VALUES (?,?)"
            " ON CONFLICT(code) DO UPDATE SET market=excluded.market",
            (code, body.market),
        )
    return {"code": code, "market": body.market}
