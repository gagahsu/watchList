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
        {"code": r["code"], "name": r["name"],
         "close": r["close"], "updatedAt": r["updated_at"]}
        for r in rows
    ]


@router.post("/stocks/sync")
def sync_stocks():
    log: list[str] = []

    # ── 1. Stock list (code + name) ───────────────────────────────────────────
    try:
        stock_info = fm.fetch_stock_info()
        log.append(f"股票清單: {len(stock_info)} 支")
    except fm.FinMindError as e:
        raise HTTPException(502, f"FinMind 無法取得股票清單: {e}")

    if not stock_info:
        raise HTTPException(502, "FinMind 回傳空白股票清單")

    # ── 2. Bulk price fetch ───────────────────────────────────────────────────
    price_map: dict[str, float] = {}
    date_map:  dict[str, str]   = {}   # code -> actual trading date from API

    bulk_map, bulk_date, bulk_err = fm.find_latest_prices_bulk()

    if bulk_map:
        price_map = bulk_map
        date_map  = {code: bulk_date for code in bulk_map}
        log.append(f"批量價格: {len(price_map)} 筆 ({bulk_date})")
    else:
        if bulk_err:
            log.append(f"批量價格失敗: {bulk_err}")
        else:
            log.append("批量價格: 無資料（非交易日或資料尚未更新）")

        # ── 3. Per-stock fallback for watchlist entries ────────────────────────
        with get_db() as conn:
            codes = [r["code"] for r in
                     conn.execute("SELECT DISTINCT code FROM entries").fetchall()
                     if r["code"]]

        if codes:
            log.append(f"改為逐檔查詢 {len(codes)} 支個股…")
            price_map, date_map, errors = fm.fetch_prices_for_codes(codes)
            log.append(f"逐檔結果: {len(price_map)} 筆成功")
            if errors:
                log.append("部分失敗: " + "; ".join(errors[:5]))
        else:
            log.append("Watchlist 無個股，跳過逐檔查詢")

    # ── 4. Upsert: preserve existing price when no new data ───────────────────
    with get_db() as conn:
        for s in stock_info:
            code  = s["stock_id"]
            name  = s["stock_name"]
            close = price_map.get(code)       # None when no fresh data
            upd   = date_map.get(code)        # actual trading date from API
            conn.execute(
                """
                INSERT INTO stocks(code, name, close, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    name       = excluded.name,
                    close      = COALESCE(excluded.close,      close),
                    updated_at = COALESCE(excluded.updated_at, updated_at)
                """,
                (code, name, close, upd),
            )

    prices_synced = len(price_map)

    with get_db() as conn:
        total_with_price = conn.execute(
            "SELECT COUNT(*) FROM stocks WHERE close IS NOT NULL"
        ).fetchone()[0]

    if prices_synced:
        # Show the actual trading date that came from the API
        sample_date = next(iter(date_map.values()), "")
        msg = f"同步完成：{len(stock_info)} 支股票，本次更新 {prices_synced} 筆收盤價（{sample_date}）"
    else:
        log.append(f"資料庫保留既有收盤價共 {total_with_price} 筆")
        msg = f"同步完成：{len(stock_info)} 支股票，無新價格（保留舊資料 {total_with_price} 筆）"

    return {
        "stocks_synced":    len(stock_info),
        "prices_synced":    prices_synced,
        "total_with_price": total_with_price,
        "message": msg,
        "log": log,
    }


@router.get("/stocks/debug")
def debug_api():
    """Test FinMind API connectivity with a known stock (2330 TSMC)."""
    try:
        rec = fm.fetch_price_for_stock("2330")
        return {"status": "ok", "price_2330": rec}
    except fm.FinMindError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e)}
