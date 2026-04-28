from fastapi import APIRouter, HTTPException
from database import get_db
import finmind as fm

router = APIRouter()


@router.get("/stocks")
def get_stocks():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT code, name, close, updated_at FROM stocks ORDER BY code"
        ).fetchall()
    return [
        {
            "code": r["code"],
            "name": r["name"],
            "close": r["close"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


@router.post("/stocks/sync")
def sync_stocks():
    """
    1. Fetch all TW stock info (name/code) from FinMind TaiwanStockInfo.
    2. Attempt bulk price fetch for the latest trading day (one API call).
    3. If bulk returns nothing, fall back to per-stock fetch for watchlist codes.
    4. Upsert everything into the stocks table.
    """
    # ── Step 1: stock list ────────────────────────────────────────────────────
    try:
        stock_info = fm.fetch_stock_info()
    except Exception as e:
        raise HTTPException(502, f"FinMind stock info fetch failed: {e}")

    if not stock_info:
        raise HTTPException(502, "FinMind returned empty stock list")

    # ── Step 2: bulk price fetch ──────────────────────────────────────────────
    price_map, trading_date = fm.find_latest_prices()

    # ── Step 3: fallback — per-stock for watchlist ────────────────────────────
    if not price_map:
        with get_db() as conn:
            codes = [
                r["code"]
                for r in conn.execute("SELECT DISTINCT code FROM entries").fetchall()
                if r["code"]
            ]
        if codes:
            price_map = fm.fetch_prices_for_codes(codes)
            trading_date = __import__("datetime").date.today().isoformat()

    # ── Step 4: upsert ────────────────────────────────────────────────────────
    with get_db() as conn:
        for s in stock_info:
            code = s["stock_id"]
            name = s["stock_name"]
            close = price_map.get(code)
            upd = trading_date if close is not None else None
            conn.execute(
                "INSERT OR REPLACE INTO stocks(code, name, close, updated_at)"
                " VALUES (?,?,?,?)",
                (code, name, close, upd),
            )

    prices_synced = sum(1 for s in stock_info if s["stock_id"] in price_map)
    return {
        "stocks_synced": len(stock_info),
        "prices_synced": prices_synced,
        "trading_date": trading_date,
        "message": f"同步完成：{len(stock_info)} 支股票，{prices_synced} 筆收盤價（{trading_date}）",
    }
