from fastapi import APIRouter, HTTPException
from database import get_db
from models import FundIn, FundPatch, FundScheduleIn

router = APIRouter()


def _sched_row(r) -> dict:
    return {"id": r["id"], "dayOfMonth": r["day_of_month"], "amount": r["amount"], "note": r["note"]}


def _row_with_schedules(conn, fund_id: str) -> dict:
    r = conn.execute("SELECT * FROM funds WHERE id=%s", (fund_id,)).fetchone()
    scheds = conn.execute(
        "SELECT * FROM fund_schedules WHERE fund_id=%s ORDER BY day_of_month ASC", (fund_id,)
    ).fetchall()
    return {
        "id": r["id"], "name": r["name"],
        "cost": r["cost"], "marketValue": r["market_value"],
        "note": r["note"],
        "schedules": [_sched_row(s) for s in scheds],
    }


@router.get("/funds")
def get_funds():
    with get_db() as conn:
        funds = conn.execute("SELECT * FROM funds ORDER BY sort_order ASC, name ASC").fetchall()
        scheds = conn.execute("SELECT * FROM fund_schedules ORDER BY day_of_month ASC").fetchall()

    sched_map: dict[str, list] = {}
    for s in scheds:
        sched_map.setdefault(s["fund_id"], []).append(_sched_row(s))

    return [{
        "id": f["id"], "name": f["name"],
        "cost": f["cost"], "marketValue": f["market_value"],
        "note": f["note"],
        "schedules": sched_map.get(f["id"], []),
    } for f in funds]


@router.post("/funds", status_code=201)
def create_fund(fund: FundIn):
    with get_db() as conn:
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM funds").fetchone()[0]
        conn.execute(
            "INSERT INTO funds(id, name, cost, market_value, note, sort_order)"
            " VALUES (%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET"
            "  name=EXCLUDED.name, cost=EXCLUDED.cost,"
            "  market_value=EXCLUDED.market_value, note=EXCLUDED.note",
            (fund.id, fund.name, fund.cost, fund.marketValue, fund.note, max_order + 1),
        )
        return _row_with_schedules(conn, fund.id)


@router.patch("/funds/{fund_id}")
def patch_fund(fund_id: str, body: FundPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        updates = {k: v for k, v in {
            "name": body.name, "cost": body.cost,
            "market_value": body.marketValue, "note": body.note,
        }.items() if v is not None}
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
