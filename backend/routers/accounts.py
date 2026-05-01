from fastapi import APIRouter, HTTPException
from database import get_db
from models import AccountIn, AccountPatch, AccountOut

router = APIRouter()


def _row_to_account(r) -> dict:
    return {
        "id": r["id"], "name": r["name"],
        "balance": r["balance"], "interestRate": r["interest_rate"],
        "note": r["note"],
    }


@router.get("/accounts")
def get_accounts():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM accounts ORDER BY name ASC").fetchall()
    return [_row_to_account(r) for r in rows]


@router.post("/accounts", status_code=201)
def create_account(account: AccountIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO accounts(id, name, balance, interest_rate, note)"
            " VALUES (%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, balance=EXCLUDED.balance,"
            "  interest_rate=EXCLUDED.interest_rate, note=EXCLUDED.note",
            (account.id, account.name, account.balance, account.interestRate, account.note),
        )
        row = conn.execute("SELECT * FROM accounts WHERE id=%s", (account.id,)).fetchone()
    return _row_to_account(row)


@router.patch("/accounts/{account_id}")
def patch_account(account_id: str, body: AccountPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM accounts WHERE id=%s", (account_id,)).fetchone():
            raise HTTPException(404, "Account not found")
        updates = {k: v for k, v in {
            "name": body.name,
            "balance": body.balance,
            "interest_rate": body.interestRate,
            "note": body.note,
        }.items() if v is not None}
        if updates:
            cols = ", ".join(f"{k}=%s" for k in updates)
            conn.execute(f"UPDATE accounts SET {cols} WHERE id=%s",
                         (*updates.values(), account_id))
        row = conn.execute("SELECT * FROM accounts WHERE id=%s", (account_id,)).fetchone()
    return _row_to_account(row)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM accounts WHERE id=%s", (account_id,)).fetchone():
            raise HTTPException(404, "Account not found")
        conn.execute("DELETE FROM accounts WHERE id=%s", (account_id,))
    return {"ok": True}
