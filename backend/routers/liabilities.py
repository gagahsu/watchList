import uuid
import logging
from fastapi import APIRouter, HTTPException
from database import get_db
from models import LiabilityIn, LiabilityPatch

router = APIRouter()
logger = logging.getLogger(__name__)

_LOAN_TYPES = {'房貸', '車貸', '信用貸款', '學貸'}


def _row_to_liability(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "type": r["type"],
        "amount": r["amount"],
        "reminderEnabled": r["reminder_enabled"],
        "reminderDay": r["reminder_day"],
        "note": r["note"],
        "totalAmount": r["total_amount"],
        "periods": r["periods"],
        "paidPeriods": r["paid_periods"],
        "interestRate": r["interest_rate"],
        "monthlyPayment": r["monthly_payment"],
        "accountId": r["account_id"],
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
            "INSERT INTO liabilities"
            " (id, name, type, amount, reminder_enabled, reminder_day, note,"
            "  total_amount, periods, paid_periods, interest_rate, monthly_payment, account_id)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, type=EXCLUDED.type, amount=EXCLUDED.amount,"
            "  reminder_enabled=EXCLUDED.reminder_enabled, reminder_day=EXCLUDED.reminder_day,"
            "  note=EXCLUDED.note,"
            "  total_amount=EXCLUDED.total_amount, periods=EXCLUDED.periods,"
            "  paid_periods=EXCLUDED.paid_periods, interest_rate=EXCLUDED.interest_rate,"
            "  monthly_payment=EXCLUDED.monthly_payment, account_id=EXCLUDED.account_id",
            (body.id, body.name, body.type, body.amount,
             body.reminderEnabled, body.reminderDay, body.note,
             body.totalAmount, body.periods, body.paidPeriods,
             body.interestRate, body.monthlyPayment, body.accountId),
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
        if body.reminderEnabled is False:    updates["reminder_day"]     = None
        if body.totalAmount is not None:     updates["total_amount"]     = body.totalAmount
        if body.periods is not None:         updates["periods"]          = body.periods
        if body.paidPeriods is not None:     updates["paid_periods"]     = body.paidPeriods
        if body.interestRate is not None:    updates["interest_rate"]    = body.interestRate
        if body.monthlyPayment is not None:  updates["monthly_payment"]  = body.monthlyPayment
        if body.accountId is not None:       updates["account_id"]       = body.accountId
        if body.accountId == "":             updates["account_id"]       = None
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


# ── Auto-deduction (called by scheduler) ──────────────────────────────────────

def process_due_payments():
    """Deduct loan/credit-card monthly payments from linked accounts on reminder day."""
    from datetime import date as _date
    today = _date.today()
    today_ym = today.strftime("%Y-%m")   # idempotency key: one deduction per month

    try:
        with get_db() as conn:
            due = conn.execute("""
                SELECT id, name, type, monthly_payment, account_id,
                       paid_periods, periods, amount
                FROM liabilities
                WHERE reminder_day = %s
                  AND account_id IS NOT NULL
                  AND monthly_payment IS NOT NULL AND monthly_payment > 0
                  AND (last_auto_date IS NULL OR last_auto_date != %s)
            """, (today.day, today_ym)).fetchall()
    except Exception as exc:
        logger.error("自動扣款查詢失敗: %s", exc)
        return

    for r in due:
        _deduct_one(r, today.isoformat(), today_ym)


def _deduct_one(r, today_iso: str, today_ym: str):
    payment   = r["monthly_payment"]
    acct_id   = r["account_id"]
    liab_id   = r["id"]
    is_loan   = r["type"] in _LOAN_TYPES

    try:
        with get_db() as conn:
            acct = conn.execute(
                "SELECT balance FROM accounts WHERE id=%s", (acct_id,)
            ).fetchone()
            if not acct:
                logger.warning("自動扣款：帳戶不存在 %s，跳過「%s」", acct_id, r["name"])
                return

            new_balance = acct["balance"] - payment
            # Reduce outstanding balance; for loans, also track paid periods
            new_amount  = max(0.0, (r["amount"] or 0.0) - payment)
            new_paid    = r["paid_periods"]
            if is_loan:
                new_paid = (new_paid or 0) + 1

            txn_id = uuid.uuid4().hex[:12]
            conn.execute(
                "INSERT INTO account_transactions"
                " (id, date, type, amount, account_id, to_account_id, note)"
                " VALUES (%s,%s,'withdrawal',%s,%s,NULL,%s)",
                (txn_id, today_iso, payment, acct_id, f"自動扣款：{r['name']}"),
            )
            conn.execute(
                "UPDATE accounts SET balance=%s WHERE id=%s",
                (new_balance, acct_id),
            )
            conn.execute(
                "UPDATE liabilities SET amount=%s, paid_periods=%s, last_auto_date=%s WHERE id=%s",
                (new_amount, new_paid, today_ym, liab_id),
            )

        logger.info(
            "自動扣款成功：%s NT$%.0f，帳戶餘額 %.0f → %.0f",
            r["name"], payment, acct["balance"], new_balance,
        )
    except Exception as exc:
        logger.error("自動扣款失敗「%s」: %s", r["name"], exc)
