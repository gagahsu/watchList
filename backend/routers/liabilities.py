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
        "reminderDay": r["reminder_day"],
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
            "INSERT INTO liabilities(id, name, type, amount, reminder_enabled, reminder_day, note)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, type=EXCLUDED.type, amount=EXCLUDED.amount,"
            "  reminder_enabled=EXCLUDED.reminder_enabled, reminder_day=EXCLUDED.reminder_day,"
            "  note=EXCLUDED.note",
            (body.id, body.name, body.type, body.amount,
             body.reminderEnabled, body.reminderDay, body.note),
        )
        row = conn.execute("SELECT * FROM liabilities WHERE id=%s", (body.id,)).fetchone()
    return _row_to_liability(row)


@router.patch("/liabilities/{liability_id}")
def patch_liability(liability_id: str, body: LiabilityPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM liabilities WHERE id=%s", (liability_id,)).fetchone():
            raise HTTPException(404, "Liability not found")
        updates: dict = {}
        if body.name is not None:            updates["name"]             = body.name
        if body.type is not None:            updates["type"]             = body.type
        if body.amount is not None:          updates["amount"]           = body.amount
        if body.note is not None:            updates["note"]             = body.note
        if body.reminderEnabled is not None: updates["reminder_enabled"] = body.reminderEnabled
        if body.reminderDay is not None:     updates["reminder_day"]     = body.reminderDay
        # allow clearing reminderDay to NULL explicitly
        if body.reminderEnabled is False:    updates["reminder_day"]     = None
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
