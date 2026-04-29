from fastapi import APIRouter, HTTPException
from database import get_db
from models import TrackedIn, TrackedPatch, TrackedOut

router = APIRouter()


def _row_out(r) -> dict:
    return {"code": r["code"], "status": r["status"], "thesis": r["thesis"],
            "memo": r["memo"], "addedAt": r["added_at"]}


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
            "INSERT OR IGNORE INTO tracked_stocks(code, status, thesis, memo, added_at) VALUES(?,?,?,?,?)",
            (body.code, body.status, body.thesis, body.memo, body.addedAt),
        )
        row = conn.execute(
            "SELECT code, status, thesis, memo, added_at FROM tracked_stocks WHERE code=?", (body.code,)
        ).fetchone()
    return _row_out(row)


@router.patch("/tracked/{code}", response_model=TrackedOut)
def patch_tracked(code: str, body: TrackedPatch):
    with get_db() as conn:
        if not conn.execute("SELECT code FROM tracked_stocks WHERE code=?", (code,)).fetchone():
            raise HTTPException(404, "Not tracked")
        if body.status is not None:
            conn.execute("UPDATE tracked_stocks SET status=? WHERE code=?", (body.status, code))
        if body.thesis is not None:
            conn.execute("UPDATE tracked_stocks SET thesis=? WHERE code=?", (body.thesis, code))
        if body.memo is not None:
            conn.execute("UPDATE tracked_stocks SET memo=? WHERE code=?", (body.memo, code))
        row = conn.execute(
            "SELECT code, status, thesis, memo, added_at FROM tracked_stocks WHERE code=?", (code,)
        ).fetchone()
    return _row_out(row)


@router.delete("/tracked/{code}")
def delete_tracked(code: str):
    with get_db() as conn:
        conn.execute("DELETE FROM tracked_stocks WHERE code=?", (code,))
    return {"ok": True}
