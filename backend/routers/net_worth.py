import logging
import uuid
import time
from fastapi import APIRouter, HTTPException
from database import get_db, get_setting
from models import NetWorthSnapshotIn

router = APIRouter()
logger = logging.getLogger(__name__)


def _row_to_snapshot(r) -> dict:
    return {
        "id": r["id"],
        "date": r["date"],
        "assets": r["assets"],
        "liabilities": r["liabilities"],
        "note": r["note"],
        "recordedAt": r["recorded_at"],
    }


def _calc_totals(conn) -> tuple[float, float]:
    """Return (total_assets, total_liabilities) from current DB state."""
    # Cash: sum of account balances
    cash = conn.execute("SELECT COALESCE(SUM(balance),0) AS s FROM accounts").fetchone()["s"]

    # USD/TWD rate for US stock conversion
    cached = get_setting("usdtwd_rate")
    fx = float(cached) if cached else 31.5

    # Stocks: net held shares × last close price
    trades = conn.execute(
        "SELECT code, type, shares FROM trades"
    ).fetchall()
    holdings: dict[str, float] = {}
    for t in trades:
        holdings[t["code"]] = holdings.get(t["code"], 0) + (
            t["shares"] if t["type"] == "buy" else -t["shares"]
        )
    markets = {
        r["code"]: r["market"]
        for r in conn.execute("SELECT code, market FROM trade_markets").fetchall()
    }
    stock_mv = 0.0
    for code, shares in holdings.items():
        if shares <= 0:
            continue
        row = conn.execute(
            "SELECT close FROM stocks WHERE code=%s AND close IS NOT NULL", (code,)
        ).fetchone()
        if row:
            to_ntd = fx if markets.get(code) == "us" else 1
            stock_mv += shares * row["close"] * to_ntd

    # Funds: sum of market_value
    funds = conn.execute("SELECT COALESCE(SUM(market_value),0) AS s FROM funds").fetchone()["s"]

    total_assets = cash + stock_mv + funds

    # Liabilities
    total_liab = conn.execute(
        "SELECT COALESCE(SUM(amount),0) AS s FROM liabilities"
    ).fetchone()["s"]

    return round(total_assets), round(total_liab)


def take_daily_snapshot():
    """Called by the scheduler each day at 23:58."""
    from datetime import date as _date
    today = _date.today().isoformat()   # "YYYY-MM-DD"
    snap_id = str(uuid.uuid4()).replace("-", "")[:12]
    try:
        with get_db() as conn:
            assets, liabilities = _calc_totals(conn)
            # Upsert by date: one snapshot per day
            conn.execute(
                "INSERT INTO net_worth_snapshots (id, date, assets, liabilities, note, recorded_at)"
                " VALUES (%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (date) DO UPDATE SET"
                "  assets=EXCLUDED.assets, liabilities=EXCLUDED.liabilities,"
                "  recorded_at=EXCLUDED.recorded_at",
                (snap_id, today, assets, liabilities, "auto", int(time.time() * 1000)),
            )
        logger.info("淨資產快照已記錄 %s: 資產=%s 負債=%s", today, assets, liabilities)
    except Exception as e:
        logger.error("淨資產快照失敗: %s", e)


@router.get("/net-worth-snapshots")
def get_snapshots():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM net_worth_snapshots ORDER BY date ASC"
        ).fetchall()
    return [_row_to_snapshot(r) for r in rows]


@router.delete("/net-worth-snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: str):
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM net_worth_snapshots WHERE id=%s", (snapshot_id,)
        ).fetchone():
            raise HTTPException(404, "Snapshot not found")
        conn.execute("DELETE FROM net_worth_snapshots WHERE id=%s", (snapshot_id,))
    return {"ok": True}
