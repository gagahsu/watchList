from fastapi import APIRouter, HTTPException
from database import get_db
from models import LiabilityIn, LiabilityPatch

router = APIRouter()


def _row_to_liability(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "type": r["type"],
        "amount": r["amount"],
        "reminderEnabled": r["reminder_enabled"],
        "reminderDate": r["reminder_date"],
        "note": r["note"],
    }


@router.get("/liabilities")
def get_liabilities():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM liabilities ORDER BY name ASC").fetchall()
    return [_row_to_liability(r) for r in rows]


@router.post("/liabilities", status_code=201)
def create_liability(body: LiabilityIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO liabilities(id, name, type, amount, reminder_enabled, reminder_date, note)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, type=EXCLUDED.type, amount=EXCLUDED.amount,"
            "  reminder_enabled=EXCLUDED.reminder_enabled, reminder_date=EXCLUDED.reminder_date,"
            "  note=EXCLUDED.note",
            (body.id, body.name, body.type, body.amount,
             body.reminderEnabled, body.reminderDate, body.note),
        )
        row = conn.execute("SELECT * FROM liabilities WHERE id=%s", (body.id,)).fetchone()
    return _row_to_liability(row)


@router.patch("/liabilities/{liability_id}")
def patch_liability(liability_id: str, body: LiabilityPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM liabilities WHERE id=%s", (liability_id,)).fetchone():
            raise HTTPException(404, "Liability not found")
        field_map = {
            "name": body.name,
            "type": body.type,
            "amount": body.amount,
            "reminder_enabled": body.reminderEnabled,
            "reminder_date": body.reminderDate,
            "note": body.note,
        }
        updates = {k: v for k, v in field_map.items() if v is not None}
        # reminder_enabled can be False, so handle it specially
        if body.reminderEnabled is not None:
            updates["reminder_enabled"] = body.reminderEnabled
        if body.reminderDate is not None:
            updates["reminder_date"] = body.reminderDate
        if updates:
            cols = ", ".join(f"{k}=%s" for k in updates)
            conn.execute(f"UPDATE liabilities SET {cols} WHERE id=%s",
                         (*updates.values(), liability_id))
        row = conn.execute("SELECT * FROM liabilities WHERE id=%s", (liability_id,)).fetchone()
    return _row_to_liability(row)


@router.delete("/liabilities/{liability_id}")
def delete_liability(liability_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM liabilities WHERE id=%s", (liability_id,)).fetchone():
            raise HTTPException(404, "Liability not found")
        conn.execute("DELETE FROM liabilities WHERE id=%s", (liability_id,))
    return {"ok": True}
