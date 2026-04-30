from fastapi import APIRouter, HTTPException
from database import get_db
from models import TrackedIn, TrackedPatch, TrackedOut

router = APIRouter()


def _row_out(r) -> dict:
    return {"code": r["code"], "status": r["status"], "thesis": r["thesis"],
            "memo": r["memo"], "stopLoss": r["stop_loss"], "takeProfit": r["take_profit"],
            "addedAt": r["added_at"]}


@router.get("/tracked", response_model=list[TrackedOut])
def get_tracked():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT code, status, thesis, memo, added_at FROM tracked_stocks ORDER BY added_at DESC"
        ).fetchall()
    return [_row_out(r) for r in rows]


@router.post("/tracked", response_model=TrackedOut, status_code=201)
def add_tracked(body: TrackedIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tracked_stocks(code, status, thesis, memo, stop_loss, take_profit, added_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (body.code, body.status, body.thesis, body.memo,
             body.stopLoss, body.takeProfit, body.addedAt),
        )
        row = conn.execute(
            "SELECT code, status, thesis, memo, stop_loss, take_profit, added_at"
            " FROM tracked_stocks WHERE code=%s", (body.code,)
        ).fetchone()
    return _row_out(row)


@router.patch("/tracked/{code}", response_model=TrackedOut)
def patch_tracked(code: str, body: TrackedPatch):
    with get_db() as conn:
        if not conn.execute("SELECT code FROM tracked_stocks WHERE code=%s", (code,)).fetchone():
            raise HTTPException(404, "Not tracked")
        if body.status is not None:
            conn.execute("UPDATE tracked_stocks SET status=%s WHERE code=%s", (body.status, code))
        if body.thesis is not None:
            conn.execute("UPDATE tracked_stocks SET thesis=%s WHERE code=%s", (body.thesis, code))
        if body.memo is not None:
            conn.execute("UPDATE tracked_stocks SET memo=%s WHERE code=%s", (body.memo, code))
        if body.stopLoss is not None:
            conn.execute("UPDATE tracked_stocks SET stop_loss=%s WHERE code=%s", (body.stopLoss, code))
        if body.takeProfit is not None:
            conn.execute("UPDATE tracked_stocks SET take_profit=%s WHERE code=%s", (body.takeProfit, code))
        row = conn.execute(
            "SELECT code, status, thesis, memo, stop_loss, take_profit, added_at"
            " FROM tracked_stocks WHERE code=%s", (code,)
        ).fetchone()
    return _row_out(row)


@router.delete("/tracked/{code}")
def delete_tracked(code: str):
    with get_db() as conn:
        conn.execute("DELETE FROM tracked_stocks WHERE code=%s", (code,))
    return {"ok": True}
