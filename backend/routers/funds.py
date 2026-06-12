import calendar
import logging
import uuid
from datetime import date as _date

from fastapi import APIRouter, HTTPException
from database import get_db
from models import FundIn, FundPatch, FundScheduleIn

logger = logging.getLogger(__name__)

router = APIRouter()


def _sched_row(r) -> dict:
    # Handle possible column name variations (snake_case, lowercase, camelCase)
    dom = r.get("day_of_month")
    if dom is None:
        dom = r.get("dayofmonth")
    if dom is None:
        dom = r.get("dayOfMonth")
    return {"id": r["id"], "dayOfMonth": dom, "amount": r["amount"], "note": r["note"]}


def _fund_row(r, scheds) -> dict:
    return {
        "id": r["id"], "name": r["name"],
        "cost": r["cost"], "marketValue": r.get("market_value"),
        "note": r["note"], "accountId": r.get("account_id"),
        "schedules": [_sched_row(s) for s in scheds],
    }


def _row_with_schedules(conn, fund_id: str) -> dict:
    r = conn.execute("SELECT * FROM funds WHERE id=%s", (fund_id,)).fetchone()
    scheds = conn.execute(
        "SELECT * FROM fund_schedules WHERE fund_id=%s ORDER BY day_of_month ASC", (fund_id,)
    ).fetchall()
    return _fund_row(r, scheds)


@router.get("/funds")
def get_funds():
    with get_db() as conn:
        funds = conn.execute("SELECT * FROM funds ORDER BY sort_order ASC, name ASC").fetchall()
        scheds = conn.execute("SELECT * FROM fund_schedules ORDER BY day_of_month ASC").fetchall()

    sched_map: dict[str, list] = {}
    for s in scheds:
        sched_map.setdefault(s["fund_id"], []).append(_sched_row(s))

    return [_fund_row(f, sched_map.get(f["id"], [])) for f in funds]


@router.post("/funds", status_code=201)
def create_fund(fund: FundIn):
    with get_db() as conn:
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM funds").fetchone()[0]
        conn.execute(
            "INSERT INTO funds(id, name, cost, market_value, note, sort_order, account_id)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, cost=EXCLUDED.cost,"
            "  market_value=EXCLUDED.market_value, note=EXCLUDED.note,"
            "  account_id=EXCLUDED.account_id",
            (fund.id, fund.name, fund.cost, fund.marketValue, fund.note, max_order + 1, fund.accountId),
        )
        return _row_with_schedules(conn, fund.id)


@router.patch("/funds/{fund_id}")
def patch_fund(fund_id: str, body: FundPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        candidates = {
            "name": body.name, "cost": body.cost,
            "market_value": body.marketValue, "note": body.note,
        }
        # accountId can be set to None explicitly, so treat separately
        updates = {k: v for k, v in candidates.items() if v is not None}
        if body.accountId is not None or "accountId" in body.model_fields_set:
            updates["account_id"] = body.accountId
        if updates:
            cols = ", ".join(f"{k}=%s" for k in updates)
            conn.execute(f"UPDATE funds SET {cols} WHERE id=%s", (*updates.values(), fund_id))
        return _row_with_schedules(conn, fund_id)


@router.delete("/funds/{fund_id}")
def delete_fund(fund_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        conn.execute("DELETE FROM funds WHERE id=%s", (fund_id,))
    return {"ok": True}


# ── Fund schedules ────────────────────────────────────────────────────────────

@router.post("/funds/{fund_id}/schedules", status_code=201)
def create_schedule(fund_id: str, body: FundScheduleIn):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        conn.execute(
            "INSERT INTO fund_schedules(id, fund_id, day_of_month, amount, note)"
            " VALUES (%s,%s,%s,%s,%s)",
            (body.id, fund_id, body.dayOfMonth, body.amount, body.note),
        )
        row = conn.execute("SELECT * FROM fund_schedules WHERE id=%s", (body.id,)).fetchone()
    return _sched_row(row)


@router.delete("/funds/{fund_id}/schedules/{schedule_id}")
def delete_schedule(fund_id: str, schedule_id: str):
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM fund_schedules WHERE id=%s AND fund_id=%s", (schedule_id, fund_id)
        ).fetchone():
            raise HTTPException(404, "Schedule not found")
        conn.execute("DELETE FROM fund_schedules WHERE id=%s", (schedule_id,))
    return {"ok": True}


# ── Auto cost increase on deduction day (called by scheduler) ─────────────────

def process_fund_deductions():
    """On a fund's scheduled deduction day, add the deduction amount to its cost basis."""
    today = _date.today()
    today_ym = today.strftime("%Y-%m")   # idempotency key: one run per month
    last_day = calendar.monthrange(today.year, today.month)[1]

    try:
        with get_db() as conn:
            due = conn.execute("""
                SELECT fs.id AS schedule_id, fs.fund_id, fs.day_of_month, fs.amount,
                       f.name AS fund_name, f.cost, f.account_id
                FROM fund_schedules fs
                JOIN funds f ON f.id = fs.fund_id
                WHERE (fs.last_deduction_date IS NULL OR fs.last_deduction_date != %s)
            """, (today_ym,)).fetchall()
    except Exception as exc:
        logger.error("基金扣款查詢失敗: %s", exc)
        return

    for r in due:
        if min(r["day_of_month"], last_day) == today.day:
            _apply_one(r, today.isoformat(), today_ym)


def _apply_one(r, today_iso: str, today_ym: str):
    amount    = r["amount"]
    acct_id   = r["account_id"]
    fund_id   = r["fund_id"]
    sched_id  = r["schedule_id"]

    try:
        with get_db() as conn:
            new_cost = r["cost"] + amount
            conn.execute("UPDATE funds SET cost=%s WHERE id=%s", (new_cost, fund_id))

            if acct_id:
                acct = conn.execute("SELECT balance FROM accounts WHERE id=%s", (acct_id,)).fetchone()
                if acct:
                    new_balance = acct["balance"] - amount
                    txn_id = uuid.uuid4().hex[:12]
                    conn.execute(
                        "INSERT INTO account_transactions"
                        " (id, date, type, amount, account_id, to_account_id, note)"
                        " VALUES (%s,%s,'withdrawal',%s,%s,NULL,%s)",
                        (txn_id, today_iso, amount, acct_id, f"基金扣款：{r['fund_name']}"),
                    )
                    conn.execute("UPDATE accounts SET balance=%s WHERE id=%s", (new_balance, acct_id))
                else:
                    logger.warning("基金扣款：帳戶不存在 %s，跳過扣款帳戶異動「%s」", acct_id, r["fund_name"])

            conn.execute(
                "UPDATE fund_schedules SET last_deduction_date=%s WHERE id=%s",
                (today_ym, sched_id),
            )

        logger.info(
            "基金扣款成功：%s NT$%.0f，投入成本 %.0f → %.0f",
            r["fund_name"], amount, r["cost"], new_cost,
        )
    except Exception as exc:
        logger.error("基金扣款失敗「%s」: %s", r["fund_name"], exc)
