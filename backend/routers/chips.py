import json
import time
from fastapi import APIRouter
from datetime import date, timedelta
from collections import defaultdict
import finmind as fm
from database import get_db

router = APIRouter()

BIG_HOLDER_LEVELS = {"400,000以上", "400000以上"}
RETAIL_LEVELS     = {"1-999", "1,000-5,000", "5,000-10,000"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _calc_streak(values: list[float]) -> tuple[int, str]:
    if not values:
        return 0, "none"
    last = values[-1]
    direction = "buy" if last > 0 else ("sell" if last < 0 else "none")
    if direction == "none":
        return 0, "none"
    count = 0
    for v in reversed(values):
        if (direction == "buy" and v > 0) or (direction == "sell" and v < 0):
            count += 1
        else:
            break
    return count, direction


def _process_institutional(rows: list[dict]) -> list[dict]:
    by_date: dict[str, dict] = defaultdict(lambda: {
        "foreign": 0, "trust": 0, "dealer": 0, "dealerHedge": 0
    })
    for r in rows:
        d   = r.get("date", "")[:10]
        nm  = r.get("name", "")
        net = r.get("buy", 0) - r.get("sell", 0)
        if "外資自營商" in nm:
            by_date[d]["foreign"] += net
        elif "外資" in nm:
            by_date[d]["foreign"] += net
        elif "投信" in nm:
            by_date[d]["trust"]       += net
        elif "避險" in nm:
            by_date[d]["dealerHedge"] += net
        elif "自營" in nm:
            by_date[d]["dealer"]      += net

    result = []
    for d in sorted(by_date):
        v = by_date[d]
        result.append({
            "date":        d,
            "foreign":     v["foreign"],
            "trust":       v["trust"],
            "dealer":      v["dealer"],
            "dealerHedge": v["dealerHedge"],
            "total":       v["foreign"] + v["trust"] + v["dealer"] + v["dealerHedge"],
        })

    if result:
        for key in ("foreign", "trust", "dealer", "total"):
            vals = [r[key] for r in result]
            cnt, direction = _calc_streak(vals)
            result[-1][f"{key}Streak"]    = cnt
            result[-1][f"{key}Direction"] = direction

    return result


def _process_margin(rows: list[dict]) -> list[dict]:
    result = []
    for r in sorted(rows, key=lambda x: x.get("date", "")[:10]):
        margin_today = r.get("MarginPurchaseToday", 0) or 0
        margin_limit = r.get("MarginPurchaseLimit", 1) or 1
        short_today  = r.get("ShortSaleToday", 0) or 0
        result.append({
            "date":          r.get("date", "")[:10],
            "marginBalance": margin_today,
            "marginChange":  (r.get("MarginPurchaseBuy", 0) or 0)
                             - (r.get("MarginPurchaseSell", 0) or 0)
                             - (r.get("MarginPurchaseCashRepayment", 0) or 0),
            "marginUsage":   round(margin_today / margin_limit * 100, 2) if margin_limit else 0,
            "shortBalance":  short_today,
            "shortChange":   (r.get("ShortSaleBuy", 0) or 0)
                             - (r.get("ShortSaleSell", 0) or 0)
                             - (r.get("ShortSaleCashRepayment", 0) or 0),
            "shortRatio":    round(short_today / margin_today * 100, 2) if margin_today else 0,
        })
    return result


def _process_lending(rows: list[dict]) -> list[dict]:
    result = []
    for r in sorted(rows, key=lambda x: x.get("date", "")[:10]):
        result.append({
            "date":    r.get("date", "")[:10],
            "balance": r.get("lendingBalance", 0) or 0,
            "change":  r.get("lendingBalanceChange", 0) or 0,
        })
    return result


def _process_shareholding(rows: list[dict]) -> list[dict]:
    by_date: dict[str, dict] = defaultdict(lambda: {
        "bigHolder": 0.0, "retail": 0.0, "total": 0
    })
    for r in rows:
        d     = r.get("date", "")[:10]
        level = r.get("HoldingSharesLevel", "")
        pct   = float(r.get("percent", 0) or 0)
        cnt   = int(r.get("people", 0) or 0)
        by_date[d]["total"] += cnt
        if level in BIG_HOLDER_LEVELS:
            by_date[d]["bigHolder"] += pct
        elif level in RETAIL_LEVELS:
            by_date[d]["retail"] += pct

    result = []
    for d in sorted(by_date):
        v = by_date[d]
        result.append({
            "date":              d,
            "bigHolder":         round(v["bigHolder"], 2),
            "retail":            round(v["retail"], 2),
            "totalShareholders": v["total"],
        })
    return result


# ── cache helpers ─────────────────────────────────────────────────────────────

def _load_cache(code: str) -> dict | None:
    today = date.today().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT data FROM chip_cache WHERE code=%s AND fetched_at=%s",
            (code, today),
        ).fetchone()
    return json.loads(row["data"]) if row else None


def _save_cache(code: str, data: dict):
    today = date.today().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chip_cache(code, data, fetched_at) VALUES(%s,%s,%s)"
            " ON CONFLICT(code) DO UPDATE SET data=EXCLUDED.data, fetched_at=EXCLUDED.fetched_at",
            (code, json.dumps(data, ensure_ascii=False), today),
        )


# ── core fetch & process ──────────────────────────────────────────────────────

def _fetch_chip_data(code: str) -> dict:
    start_daily  = (date.today() - timedelta(days=100)).isoformat()
    start_weekly = (date.today() - timedelta(days=210)).isoformat()
    errors: dict[str, str] = {}

    try:
        inst_raw = fm.fetch_institutional(code, start_daily)
    except Exception as e:
        inst_raw = []; errors["institutional"] = str(e)

    try:
        margin_raw = fm.fetch_margin(code, start_daily)
    except Exception as e:
        margin_raw = []; errors["margin"] = str(e)

    try:
        lending_raw = fm.fetch_securities_lending(code, start_daily)
    except Exception as e:
        lending_raw = []; errors["lending"] = str(e)

    try:
        share_raw = fm.fetch_shareholding(code, start_weekly)
    except Exception as e:
        share_raw = []; errors["shareholding"] = str(e)

    return {
        "institutional": _process_institutional(inst_raw),
        "margin":        _process_margin(margin_raw),
        "lending":       _process_lending(lending_raw),
        "shareholding":  _process_shareholding(share_raw),
        "errors":        errors,
    }


# ── sync helper (called from stocks sync) ────────────────────────────────────

def sync_chips_for_codes(codes: list[str], delay: float = 0.5) -> int:
    """Fetch and cache chip data for given codes. Skips codes already cached today."""
    today = date.today().isoformat()
    synced = 0
    for code in codes:
        with get_db() as conn:
            row = conn.execute(
                "SELECT fetched_at FROM chip_cache WHERE code=%s", (code,)
            ).fetchone()
        if row and row["fetched_at"] == today:
            continue
        try:
            data = _fetch_chip_data(code)
            _save_cache(code, data)
            synced += 1
        except Exception:
            pass
        time.sleep(delay)
    return synced


# ── endpoint ──────────────────────────────────────────────────────────────────

@router.get("/chips/{code}")
def get_chips(code: str):
    cached = _load_cache(code)
    if cached:
        return cached
    data = _fetch_chip_data(code)
    _save_cache(code, data)
    return data
