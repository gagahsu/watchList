from fastapi import APIRouter, HTTPException
from database import get_db
from models import FundIn, FundPatch

router = APIRouter()


def _row(r) -> dict:
    return {
        "id": r["id"], "name": r["name"],
        "cost": r["cost"], "marketValue": r["market_value"],
        "note": r["note"],
    }


@router.get("/funds")
def get_funds():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM funds ORDER BY sort_order ASC, name ASC").fetchall()
    return [_row(r) for r in rows]


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
        row = conn.execute("SELECT * FROM funds WHERE id=%s", (fund.id,)).fetchone()
    return _row(row)


@router.patch("/funds/{fund_id}")
def patch_fund(fund_id: str, body: FundPatch):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        updates = {k: v for k, v in {
            "name": body.name,
            "cost": body.cost,
            "market_value": body.marketValue,
            "note": body.note,
        }.items() if v is not None}
        if updates:
            cols = ", ".join(f"{k}=%s" for k in updates)
            conn.execute(f"UPDATE funds SET {cols} WHERE id=%s", (*updates.values(), fund_id))
        row = conn.execute("SELECT * FROM funds WHERE id=%s", (fund_id,)).fetchone()
    return _row(row)


@router.delete("/funds/{fund_id}")
def delete_fund(fund_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM funds WHERE id=%s", (fund_id,)).fetchone():
            raise HTTPException(404, "Fund not found")
        conn.execute("DELETE FROM funds WHERE id=%s", (fund_id,))
    return {"ok": True}
