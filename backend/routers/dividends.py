from fastapi import APIRouter, HTTPException
from database import get_db
from models import DividendRecordIn, DividendRecordOut

router = APIRouter()


def _row(r) -> dict:
    return {
        "id": r["id"], "code": r["code"], "exDate": r["ex_date"],
        "cashDiv": r["cash_div"], "stockDiv": r["stock_div"],
        "payDate": r["pay_date"], "note": r["note"],
    }


@router.get("/dividends", response_model=list[DividendRecordOut])
def list_dividends():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM dividend_records ORDER BY ex_date DESC, id DESC"
        ).fetchall()
    return [_row(r) for r in rows]


@router.post("/dividends", response_model=DividendRecordOut)
def create_dividend(body: DividendRecordIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO dividend_records(id,code,ex_date,cash_div,stock_div,pay_date,note) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s)",
            (body.id, body.code, body.exDate, body.cashDiv, body.stockDiv, body.payDate, body.note),
        )
        row = conn.execute("SELECT * FROM dividend_records WHERE id=%s", (body.id,)).fetchone()
    return _row(row)


@router.delete("/dividends/{div_id}")
def delete_dividend(div_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM dividend_records WHERE id=%s", (div_id,)).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM dividend_records WHERE id=%s", (div_id,))
    return {"ok": True}
