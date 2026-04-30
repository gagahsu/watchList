from fastapi import APIRouter, HTTPException
from database import get_db
from models import BrokerIn, BrokerOut

router = APIRouter()


def _row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "discount": r["discount"],
            "minFee": r["min_fee"], "rounding": r["rounding"]}


@router.get("/brokers", response_model=list[BrokerOut])
def get_brokers():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM brokers ORDER BY name").fetchall()
    return [_row(r) for r in rows]


@router.post("/brokers", response_model=BrokerOut, status_code=201)
def create_broker(b: BrokerIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO brokers(id, name, discount, min_fee, rounding)"
            " VALUES (%s,%s,%s,%s,%s)",
            (b.id, b.name, b.discount, b.minFee, b.rounding),
        )
        row = conn.execute("SELECT * FROM brokers WHERE id=%s", (b.id,)).fetchone()
    return _row(row)


@router.put("/brokers/{broker_id}", response_model=BrokerOut)
def update_broker(broker_id: str, b: BrokerIn):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM brokers WHERE id=%s", (broker_id,)).fetchone():
            raise HTTPException(404, "Broker not found")
        conn.execute(
            "UPDATE brokers SET name=%s, discount=%s, min_fee=%s, rounding=%s WHERE id=%s",
            (b.name, b.discount, b.minFee, b.rounding, broker_id),
        )
        row = conn.execute("SELECT * FROM brokers WHERE id=%s", (broker_id,)).fetchone()
    return _row(row)


@router.delete("/brokers/{broker_id}")
def delete_broker(broker_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM brokers WHERE id=%s", (broker_id,))
    return {"ok": True}
