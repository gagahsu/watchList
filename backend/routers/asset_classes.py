from fastapi import APIRouter
from database import get_db
from models import AssetClassIn

router = APIRouter()


@router.get("/asset-classes")
def get_asset_classes():
    with get_db() as conn:
        rows = conn.execute("SELECT code, asset_class FROM asset_classes").fetchall()
    return {r["code"]: r["asset_class"] for r in rows}


@router.put("/asset-classes/{code}")
def set_asset_class(code: str, body: AssetClassIn):
    with get_db() as conn:
        if not body.assetClass:
            conn.execute("DELETE FROM asset_classes WHERE code=%s", (code,))
        else:
            conn.execute(
                "INSERT INTO asset_classes(code, asset_class) VALUES (%s,%s)"
                " ON CONFLICT(code) DO UPDATE SET asset_class=EXCLUDED.asset_class",
                (code, body.assetClass),
            )
    return {"code": code, "assetClass": body.assetClass}
