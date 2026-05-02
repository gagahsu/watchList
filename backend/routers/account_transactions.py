from fastapi import APIRouter, HTTPException
from database import get_db
from models import AccountTransactionIn, AccountTransactionOut

router = APIRouter()


def _row_to_txn(r) -> dict:
    return {
        "id": r["id"], "date": r["date"], "type": r["type"],
        "amount": r["amount"], "accountId": r["account_id"],
        "toAccountId": r["to_account_id"], "note": r["note"],
    }


@router.get("/account-transactions", response_model=list[AccountTransactionOut])
def list_transactions():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM account_transactions ORDER BY date DESC, id DESC"
        ).fetchall()
    return [_row_to_txn(r) for r in rows]


@router.post("/account-transactions", response_model=AccountTransactionOut)
def create_transaction(body: AccountTransactionIn):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM accounts WHERE id=%s", (body.accountId,)).fetchone():
            raise HTTPException(404, "Account not found")
        if body.type == "transfer":
            if not body.toAccountId:
                raise HTTPException(400, "toAccountId required for transfer")
            if not conn.execute("SELECT id FROM accounts WHERE id=%s", (body.toAccountId,)).fetchone():
                raise HTTPException(404, "Destination account not found")

        conn.execute(
            "INSERT INTO account_transactions(id,date,type,amount,account_id,to_account_id,note) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s)",
            (body.id, body.date, body.type, body.amount, body.accountId, body.toAccountId, body.note),
        )

        if body.type == "deposit":
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (body.amount, body.accountId))
        elif body.type == "withdrawal":
            conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (body.amount, body.accountId))
        elif body.type == "transfer":
            conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (body.amount, body.accountId))
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (body.amount, body.toAccountId))

        row = conn.execute("SELECT * FROM account_transactions WHERE id=%s", (body.id,)).fetchone()
    return _row_to_txn(row)


@router.delete("/account-transactions/{txn_id}")
def delete_transaction(txn_id: str):
    with get_db() as conn:
        txn = conn.execute("SELECT * FROM account_transactions WHERE id=%s", (txn_id,)).fetchone()
        if not txn:
            raise HTTPException(404, "Transaction not found")

        if txn["type"] == "deposit":
            conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (txn["amount"], txn["account_id"]))
        elif txn["type"] == "withdrawal":
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (txn["amount"], txn["account_id"]))
        elif txn["type"] == "transfer":
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (txn["amount"], txn["account_id"]))
            if txn["to_account_id"]:
                conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (txn["amount"], txn["to_account_id"]))

        conn.execute("DELETE FROM account_transactions WHERE id=%s", (txn_id,))
    return {"ok": True}
