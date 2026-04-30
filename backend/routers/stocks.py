from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db
import finmind as fm

router = APIRouter()


class SyncRequest(BaseModel):
    force: bool = False


@router.get("/stocks")
def get_stocks():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT code, name, industry, close, updated_at FROM stocks ORDER BY code"
        ).fetchall()
    return [
        {"code": r["code"], "name": r["name"], "industry": r["industry"],
         "close": r["close"], "updatedAt": r["updated_at"]}
        for r in rows
    ]


@router.post("/stocks/sync")
def sync_stocks(body: SyncRequest = SyncRequest()):
    force = body.force
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
            log.append("批量價格不支援（FinMind 免費帳號需逐檔查詢）")
        else:
            log.append("批量價格: 無資料（非交易日或資料尚未更新）")

        # ── 3. Per-stock fallback: watchlist entries + previously-tracked stocks ─
        with get_db() as conn:
            entry_codes = {r["code"] for r in
                           conn.execute("SELECT DISTINCT code FROM entries").fetchall()
                           if r["code"]}
            direct_tracked = {r["code"] for r in
                              conn.execute("SELECT code FROM tracked_stocks").fetchall()}
            prev_prices = {r["code"] for r in
                           conn.execute("SELECT code FROM stocks WHERE close IS NOT NULL").fetchall()}

        all_codes = entry_codes | direct_tracked | prev_prices

        # Skip codes already updated today unless force=True
        today   = date.today().isoformat()
        skipped: set[str] = set()
        if not force:
            with get_db() as conn:
                up_to_date = {r["code"] for r in
                              conn.execute(
                                  "SELECT code FROM stocks WHERE updated_at=%s", (today,)
                              ).fetchall()}
            skipped = all_codes & up_to_date
            codes   = list(all_codes - up_to_date)
            if skipped:
                log.append(f"跳過 {len(skipped)} 支（今日已更新）：{'、'.join(sorted(skipped)[:5])}"
                           + ("…" if len(skipped) > 5 else ""))
        else:
            codes = list(all_codes)
            log.append("強制模式：重新抓取所有個股")

        if codes:
            log.append(f"逐檔查詢 {len(codes)} 支個股…")
            price_map, date_map, errors = fm.fetch_prices_for_codes(codes)
            log.append(f"逐檔結果: {len(price_map)} 筆成功")
            if errors:
                log.append("部分失敗: " + "; ".join(errors[:5]))
        elif not all_codes:
            log.append("尚無個股資料，請先將股票加入 Watchlist 後再同步")
        else:
            log.append("所有個股均已是今日最新，無需更新")

    # ── 4. Upsert: preserve existing price when no new data ───────────────────
    # Deduplicate by stock_id — FinMind occasionally returns duplicate rows
    seen: dict[str, dict] = {}
    for s in stock_info:
        seen.setdefault(s["stock_id"], s)

    with get_db() as conn:
        rows = [
            (
                s["stock_id"],
                s["stock_name"],
                s.get("industry_category", ""),
                price_map.get(s["stock_id"]),
                date_map.get(s["stock_id"]),
            )
            for s in seen.values()
        ]
        conn.execute_values(
            """
            INSERT INTO stocks(code, name, industry, close, updated_at)
            VALUES %s
            ON CONFLICT(code) DO UPDATE SET
                name       = EXCLUDED.name,
                industry   = EXCLUDED.industry,
                close      = COALESCE(EXCLUDED.close,      stocks.close),
                updated_at = COALESCE(EXCLUDED.updated_at, stocks.updated_at)
            """,
            rows,
        )

    prices_synced = len(price_map)

    with get_db() as conn:
        total_with_price = conn.execute(
            "SELECT COUNT(*) FROM stocks WHERE close IS NOT NULL"
        ).fetchone()[0]

    skipped_count = len(skipped) if not force else 0

    if prices_synced:
        sample_date = next(iter(date_map.values()), "")
        msg = f"同步完成：更新 {prices_synced} 筆收盤價（{sample_date}）"
        if skipped_count:
            msg += f"，跳過 {skipped_count} 支已是今日最新"
    elif skipped_count:
        msg = f"所有 {skipped_count} 支個股均已是今日最新，未重新抓取"
    else:
        log.append(f"資料庫保留既有收盤價共 {total_with_price} 筆")
        msg = f"同步完成：{len(stock_info)} 支股票，無新價格（保留舊資料 {total_with_price} 筆）"

    return {
        "stocks_synced":    len(stock_info),
        "prices_synced":    prices_synced,
        "skipped":          skipped_count,
        "total_with_price": total_with_price,
        "all_up_to_date":   skipped_count > 0 and prices_synced == 0,
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
