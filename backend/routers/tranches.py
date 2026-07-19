from datetime import date

from fastapi import APIRouter, HTTPException
from database import get_db
from models import TranchePlanIn, TrancheItemPatch

router = APIRouter()


def _item_row(r) -> dict:
    return {
        "id": r["id"], "seq": r["seq"], "triggerPrice": r["trigger_price"],
        "amount": r["amount"], "status": r["status"],
        "filledDate": r["filled_date"], "alertedAt": r["alerted_at"],
    }


def _load_plans(conn) -> list[dict]:
    plans = conn.execute(
        "SELECT * FROM tranche_plans ORDER BY created_at DESC"
    ).fetchall()
    items = conn.execute(
        "SELECT * FROM tranche_items ORDER BY seq ASC"
    ).fetchall()
    by_plan: dict[str, list] = {}
    for it in items:
        by_plan.setdefault(it["plan_id"], []).append(_item_row(it))
    return [
        {"id": p["id"], "code": p["code"], "note": p["note"],
         "createdAt": p["created_at"], "items": by_plan.get(p["id"], [])}
        for p in plans
    ]


@router.get("/tranche-plans")
def get_tranche_plans():
    with get_db() as conn:
        return _load_plans(conn)


@router.post("/tranche-plans", status_code=201)
def create_tranche_plan(plan: TranchePlanIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tranche_plans(id, code, note, created_at) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code, note=EXCLUDED.note",
            (plan.id, plan.code, plan.note, plan.createdAt),
        )
        conn.execute("DELETE FROM tranche_items WHERE plan_id=%s", (plan.id,))
        for it in plan.items:
            conn.execute(
                "INSERT INTO tranche_items(id, plan_id, seq, trigger_price, amount, status)"
                " VALUES (%s,%s,%s,%s,%s,%s)",
                (it.id, plan.id, it.seq, it.triggerPrice, it.amount, it.status),
            )
        plans = _load_plans(conn)
    return next(p for p in plans if p["id"] == plan.id)


@router.delete("/tranche-plans/{plan_id}")
def delete_tranche_plan(plan_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM tranche_plans WHERE id=%s", (plan_id,)).fetchone():
            raise HTTPException(404, "Plan not found")
        conn.execute("DELETE FROM tranche_plans WHERE id=%s", (plan_id,))
    return {"ok": True}


@router.patch("/tranche-items/{item_id}")
def patch_tranche_item(item_id: str, body: TrancheItemPatch):
    if body.status not in ("pending", "filled"):
        raise HTTPException(400, "status must be 'pending' or 'filled'")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tranche_items WHERE id=%s", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Item not found")
        if body.status == "filled":
            conn.execute(
                "UPDATE tranche_items SET status='filled', filled_date=%s WHERE id=%s",
                (date.today().isoformat(), item_id),
            )
        else:
            # back to pending: re-arm the LINE alert as well
            conn.execute(
                "UPDATE tranche_items SET status='pending', filled_date=NULL, alerted_at=NULL WHERE id=%s",
                (item_id,),
            )
        row = conn.execute("SELECT * FROM tranche_items WHERE id=%s", (item_id,)).fetchone()
    return _item_row(row)
