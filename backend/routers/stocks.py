from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db, get_setting, set_setting
import finmind as fm
from routers.chips import sync_chips_for_codes

router = APIRouter()


class SyncRequest(BaseModel):
    force: bool = False


# ── stock list (names + industries) ──────────────────────────────────────────

def _sync_stock_list() -> list[dict]:
    """Fetch full stock list from FinMind and upsert names/industries into DB.

    Returns list of dicts with keys stock_id, stock_name, industry_category.
    Records today's date in settings so subsequent calls can skip the fetch.
    """
    stock_info = fm.fetch_stock_info()
    if not stock_info:
        raise fm.FinMindError("FinMind 回傳空白股票清單")

    seen: dict[str, dict] = {}
    for s in stock_info:
        seen.setdefault(s["stock_id"], s)

    with get_db() as conn:
        conn.execute_values(
            """
            INSERT INTO stocks(code, name, industry)
            VALUES %s
            ON CONFLICT(code) DO UPDATE SET
                name     = EXCLUDED.name,
                industry = EXCLUDED.industry
            """,
            [(s["stock_id"], s["stock_name"], s.get("industry_category", ""))
             for s in seen.values()],
        )

    set_setting("stock_list_synced_at", date.today().isoformat())
    return list(seen.values())


def _stock_count_in_db() -> int:
    with get_db() as conn:
        return conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]


# ── endpoints ─────────────────────────────────────────────────────────────────

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
    today = date.today().isoformat()

    # ── 1. Stock list (code + name + industry) ────────────────────────────────
    last_sync = get_setting("stock_list_synced_at")
    if not force and last_sync == today:
        log.append(f"股票清單: 使用今日快取（{_stock_count_in_db()} 支，排程已更新）")
    else:
        try:
            fetched = _sync_stock_list()
            log.append(f"股票清單: 從 FinMind 更新 {len(fetched)} 支")
        except fm.FinMindError as e:
            raise HTTPException(502, f"FinMind 無法取得股票清單: {e}")

    # ── 2. Determine target codes (only what the user tracks) ─────────────────
    with get_db() as conn:
        entry_codes    = {r["code"] for r in conn.execute("SELECT DISTINCT code FROM entries").fetchall() if r["code"]}
        direct_tracked = {r["code"] for r in conn.execute("SELECT code FROM tracked_stocks").fetchall()}

    all_codes = entry_codes | direct_tracked

    skipped: set[str] = set()
    if not force:
        with get_db() as conn:
            up_to_date = {r["code"] for r in
                          conn.execute("SELECT code FROM stocks WHERE updated_at=%s", (today,)).fetchall()}
        skipped   = all_codes & up_to_date
        to_fetch  = list(all_codes - up_to_date)
        if skipped:
            log.append(f"跳過 {len(skipped)} 支（今日已更新）")
    else:
        to_fetch = list(all_codes)
        log.append("強制模式：重新抓取所有追蹤個股")

    # ── 3. Price fetch ────────────────────────────────────────────────────────
    price_map: dict[str, float] = {}
    date_map:  dict[str, str]   = {}

    if to_fetch:
        bulk_map, bulk_date, bulk_err = fm.find_latest_prices_bulk()
        if bulk_map:
            # Filter bulk result to only tracked stocks
            price_map = {c: bulk_map[c] for c in to_fetch if c in bulk_map}
            date_map  = {c: bulk_date for c in price_map}
            missing   = [c for c in to_fetch if c not in bulk_map]
            log.append(f"批量價格: {len(price_map)} 筆 ({bulk_date})" +
                       (f"，{len(missing)} 支無資料" if missing else ""))
        else:
            if bulk_err:
                log.append("批量價格不支援（FinMind 免費帳號需逐檔查詢）")
            else:
                log.append("批量價格: 無資料（非交易日或資料尚未更新）")
            log.append(f"逐檔查詢 {len(to_fetch)} 支個股…")
            price_map, date_map, errors = fm.fetch_prices_for_codes(to_fetch)
            log.append(f"逐檔結果: {len(price_map)} 筆成功")
            if errors:
                log.append("部分失敗: " + "; ".join(errors[:5]))
    elif not all_codes:
        log.append("尚無追蹤個股，請先將股票加入 Watchlist 後再同步")
    else:
        log.append("所有追蹤個股均已是今日最新，無需更新")

    # ── 4. Upsert prices (only for stocks with new data) ─────────────────────
    if price_map:
        with get_db() as conn:
            conn.execute_values(
                """
                INSERT INTO stocks(code, name, industry, close, updated_at)
                VALUES %s
                ON CONFLICT(code) DO UPDATE SET
                    close      = EXCLUDED.close,
                    updated_at = EXCLUDED.updated_at
                """,
                [(code, '', '', price, date_map[code]) for code, price in price_map.items()],
            )

    prices_synced = len(price_map)
    skipped_count = len(skipped) if not force else 0

    if prices_synced:
        sample_date = next(iter(date_map.values()), "")
        msg = f"同步完成：更新 {prices_synced} 筆收盤價（{sample_date}）"
        if skipped_count:
            msg += f"，跳過 {skipped_count} 支已是今日最新"
    elif skipped_count:
        msg = f"所有 {skipped_count} 支個股均已是今日最新，未重新抓取"
    else:
        msg = "同步完成：無新價格資料"

    # ── 5. Chip data sync (tracked_stocks only) ──────────────────────────────
    tracked_codes = list(direct_tracked)
    if tracked_codes:
        log.append(f"籌碼資料：同步 {len(tracked_codes)} 支追蹤個股…")
        chips_synced = sync_chips_for_codes(tracked_codes, delay=0.5)
        log.append(f"籌碼資料：更新 {chips_synced} 支，其餘已是今日最新")
    else:
        chips_synced = 0

    return {
        "prices_synced":  prices_synced,
        "chips_synced":   chips_synced,
        "skipped":        skipped_count,
        "all_up_to_date": skipped_count > 0 and prices_synced == 0,
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
