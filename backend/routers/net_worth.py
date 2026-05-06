from fastapi import APIRouter, HTTPException
from database import get_db
from models import NetWorthSnapshotIn

router = APIRouter()


def _row_to_snapshot(r) -> dict:
    return {
        "id": r["id"],
        "date": r["date"],
        "assets": r["assets"],
        "liabilities": r["liabilities"],
        "note": r["note"],
        "recordedAt": r["recorded_at"],
    }


@router.get("/net-worth-snapshots")
def get_snapshots():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM net_worth_snapshots ORDER BY date ASC, recorded_at ASC"
        ).fetchall()
    return [_row_to_snapshot(r) for r in rows]


@router.post("/net-worth-snapshots", status_code=201)
def create_snapshot(body: NetWorthSnapshotIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO net_worth_snapshots (id, date, assets, liabilities, note, recorded_at)"
            " VALUES (%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  date=EXCLUDED.date, assets=EXCLUDED.assets, liabilities=EXCLUDED.liabilities,"
            "  note=EXCLUDED.note, recorded_at=EXCLUDED.recorded_at",
            (body.id, body.date, body.assets, body.liabilities, body.note, body.recordedAt),
        )
        row = conn.execute(
            "SELECT * FROM net_worth_snapshots WHERE id=%s", (body.id,)
        ).fetchone()
    return _row_to_snapshot(row)


@router.delete("/net-worth-snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: str):
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM net_worth_snapshots WHERE id=%s", (snapshot_id,)
        ).fetchone():
            raise HTTPException(404, "Snapshot not found")
        conn.execute("DELETE FROM net_worth_snapshots WHERE id=%s", (snapshot_id,))
    return {"ok": True}
