from fastapi import APIRouter, HTTPException
from database import get_db
from models import CreditCardIn, CreditCardOut, CreditCardPatch

router = APIRouter()


def _row(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "bank": r["bank"],
        "paymentDay": r["payment_day"],
        "note": r["note"],
    }


@router.get("/credit-cards", response_model=list[CreditCardOut])
def list_credit_cards():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM credit_cards ORDER BY payment_day, name"
        ).fetchall()
    return [_row(r) for r in rows]


@router.post("/credit-cards", response_model=CreditCardOut)
def create_credit_card(body: CreditCardIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO credit_cards(id,name,bank,payment_day,note) VALUES(%s,%s,%s,%s,%s)",
            (body.id, body.name, body.bank, body.paymentDay, body.note),
        )
        row = conn.execute("SELECT * FROM credit_cards WHERE id=%s", (body.id,)).fetchone()
    return _row(row)


@router.patch("/credit-cards/{card_id}", response_model=CreditCardOut)
def patch_credit_card(card_id: str, body: CreditCardPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM credit_cards WHERE id=%s", (card_id,)).fetchone():
            raise HTTPException(404, "Not found")
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        col_map = {"name": "name", "bank": "bank", "paymentDay": "payment_day", "note": "note"}
        for field, val in updates.items():
            col = col_map[field]
            conn.execute(f"UPDATE credit_cards SET {col}=%s WHERE id=%s", (val, card_id))
        row = conn.execute("SELECT * FROM credit_cards WHERE id=%s", (card_id,)).fetchone()
    return _row(row)


@router.delete("/credit-cards/{card_id}")
def delete_credit_card(card_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM credit_cards WHERE id=%s", (card_id,)).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM credit_cards WHERE id=%s", (card_id,))
    return {"ok": True}
