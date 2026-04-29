from fastapi import APIRouter, HTTPException
from database import get_db
from models import SignalIn, SignalPatch, SignalOut

router = APIRouter()


def _row_to_signal(r) -> dict:
    return {
        "id": r["id"], "date": r["date"], "direction": r["direction"],
        "source": r["source"], "condition": r["condition_text"],
        "price": r["price"], "status": r["status"],
        "invalidReason": r["invalid_reason"],
    }


@router.get("/signals")
def get_all_signals():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM signals ORDER BY date DESC"
        ).fetchall()
    result: dict[str, list] = {}
    for r in rows:
        result.setdefault(r["code"], []).append(_row_to_signal(r))
    return result


@router.get("/signals/{code}")
def get_signals(code: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM signals WHERE code=%s ORDER BY date DESC", (code,)
        ).fetchall()
    return [_row_to_signal(r) for r in rows]


@router.post("/signals/{code}", status_code=201)
def create_signal(code: str, sig: SignalIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO signals"
            "(id, code, date, direction, source, condition_text, price, status, invalid_reason)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  code=EXCLUDED.code, date=EXCLUDED.date, direction=EXCLUDED.direction,"
            "  source=EXCLUDED.source, condition_text=EXCLUDED.condition_text,"
            "  price=EXCLUDED.price, status=EXCLUDED.status, invalid_reason=EXCLUDED.invalid_reason",
            (sig.id, code, sig.date, sig.direction, sig.source,
             sig.condition, sig.price, sig.status, sig.invalidReason),
        )
        row = conn.execute("SELECT * FROM signals WHERE id=%s", (sig.id,)).fetchone()
    return _row_to_signal(row)


@router.patch("/signals/{signal_id}")
def patch_signal(signal_id: str, body: SignalPatch):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM signals WHERE id=%s", (signal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Signal not found")
        status = body.status if body.status is not None else row["status"]
        reason = body.invalidReason if body.invalidReason is not None else row["invalid_reason"]
        conn.execute(
            "UPDATE signals SET status=%s, invalid_reason=%s WHERE id=%s",
            (status, reason, signal_id),
        )
        updated = conn.execute("SELECT * FROM signals WHERE id=%s", (signal_id,)).fetchone()
    return _row_to_signal(updated)


@router.delete("/signals/{signal_id}")
def delete_signal(signal_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM signals WHERE id=%s", (signal_id,)).fetchone():
            raise HTTPException(404, "Signal not found")
        conn.execute("DELETE FROM signals WHERE id=%s", (signal_id,))
    return {"ok": True}
