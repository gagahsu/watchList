import time
from fastapi import APIRouter
from datetime import date, timedelta
from collections import defaultdict
import finmind as fm
from database import get_db

router = APIRouter()


# ── name mapping ──────────────────────────────────────────────────────────────

_INST_MAP = {
    "foreign_investor":    "foreign",
    "foreign_dealer_self": "foreign",
    "investment_trust":    "trust",
    "dealer_self":         "dealer",
    "dealer_hedging":      "dealerHedge",
}


# ── streak ────────────────────────────────────────────────────────────────────

def _calc_streak(values: list[int]) -> tuple[int, str]:
    if not values:
        return 0, "none"
    direction = "buy" if values[-1] > 0 else ("sell" if values[-1] < 0 else "none")
    if direction == "none":
        return 0, "none"
    count = 0
    for v in reversed(values):
        if (direction == "buy" and v > 0) or (direction == "sell" and v < 0):
            count += 1
        else:
            break
    return count, direction


# ── fetch & upsert ────────────────────────────────────────────────────────────

def _upsert_institutional(code: str, rows: list[dict]):
    by_date: dict[str, dict] = defaultdict(lambda: {
        "foreign": 0, "trust": 0, "dealer": 0, "dealerHedge": 0
    })
    for r in rows:
        d   = r.get("date", "")[:10]
        key = _INST_MAP.get(r.get("name", "").lower())
        if key:
            by_date[d][key] += r.get("buy", 0) - r.get("sell", 0)

    if not by_date:
        return

    records = [
        (
            code, d,
            v["foreign"], v["trust"], v["dealer"], v["dealerHedge"],
            v["foreign"] + v["trust"] + v["dealer"] + v["dealerHedge"],
        )
        for d, v in by_date.items()
    ]
    with get_db() as conn:
        conn.execute_values(
            """
            INSERT INTO institutional_daily
              (code, date, foreign_net, trust_net, dealer_net, dealer_hedge_net, total_net)
            VALUES %s
            ON CONFLICT (code, date) DO UPDATE SET
              foreign_net      = EXCLUDED.foreign_net,
              trust_net        = EXCLUDED.trust_net,
              dealer_net       = EXCLUDED.dealer_net,
              dealer_hedge_net = EXCLUDED.dealer_hedge_net,
              total_net        = EXCLUDED.total_net
            """,
            records,
        )


def _upsert_margin(code: str, rows: list[dict]):
    records = []
    for r in rows:
        d             = r.get("date", "")[:10]
        margin_today  = r.get("MarginPurchaseTodayBalance", 0) or 0
        margin_limit  = r.get("MarginPurchaseLimit", 1) or 1
        short_today   = r.get("ShortSaleTodayBalance", 0) or 0
        records.append((
            code, d,
            margin_today,
            round(margin_today / margin_limit * 100, 2) if margin_limit else 0,
            short_today,
            round(short_today / margin_today * 100, 2) if margin_today else 0,
        ))
    if not records:
        return
    with get_db() as conn:
        conn.execute_values(
            """
            INSERT INTO margin_daily
              (code, date, margin_balance, margin_usage, short_balance, short_ratio)
            VALUES %s
            ON CONFLICT (code, date) DO UPDATE SET
              margin_balance = EXCLUDED.margin_balance,
              margin_usage   = EXCLUDED.margin_usage,
              short_balance  = EXCLUDED.short_balance,
              short_ratio    = EXCLUDED.short_ratio
            """,
            records,
        )


# ── today check ───────────────────────────────────────────────────────────────

def _has_today(table: str, code: str) -> bool:
    today = date.today().isoformat()
    with get_db() as conn:
        row = conn.execute(
            f"SELECT 1 FROM {table} WHERE code=%s AND date=%s", (code, today)
        ).fetchone()
    return row is not None


# ── query & format ────────────────────────────────────────────────────────────

def _query_institutional(code: str, limit: int = 60) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT date, foreign_net, trust_net, dealer_net, dealer_hedge_net, total_net
            FROM institutional_daily
            WHERE code=%s
            ORDER BY date DESC
            LIMIT %s
            """,
            (code, limit),
        ).fetchall()

    rows = list(reversed(rows))  # oldest → newest
    result = [
        {
            "date":        r["date"],
            "foreign":     r["foreign_net"],
            "trust":       r["trust_net"],
            "dealer":      r["dealer_net"],
            "dealerHedge": r["dealer_hedge_net"],
            "total":       r["total_net"],
        }
        for r in rows
    ]

    if result:
        for key, col in [("foreign", "foreign"), ("trust", "trust"),
                         ("dealer", "dealer"), ("total", "total")]:
            vals = [r[key] for r in result]
            cnt, direction = _calc_streak(vals)
            result[-1][f"{key}Streak"]    = cnt
            result[-1][f"{key}Direction"] = direction

    return result


def _query_margin(code: str, limit: int = 60) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT date, margin_balance, margin_usage, short_balance, short_ratio,
                   LAG(margin_balance) OVER (ORDER BY date) AS prev_margin,
                   LAG(short_balance)  OVER (ORDER BY date) AS prev_short
            FROM margin_daily
            WHERE code=%s
            ORDER BY date DESC
            LIMIT %s
            """,
            (code, limit),
        ).fetchall()

    rows = list(reversed(rows))
    return [
        {
            "date":          r["date"],
            "marginBalance": r["margin_balance"],
            "marginChange":  (r["margin_balance"] - r["prev_margin"]) if r["prev_margin"] is not None else 0,
            "marginUsage":   r["margin_usage"],
            "shortBalance":  r["short_balance"],
            "shortChange":   (r["short_balance"] - r["prev_short"]) if r["prev_short"] is not None else 0,
            "shortRatio":    r["short_ratio"],
        }
        for r in rows
    ]


# ── fetch from FinMind & store ────────────────────────────────────────────────

def _fetch_and_store(code: str):
    start = (date.today() - timedelta(days=100)).isoformat()
    try:
        inst_raw = fm.fetch_institutional(code, start)
        _upsert_institutional(code, inst_raw)
    except Exception:
        pass
    try:
        margin_raw = fm.fetch_margin(code, start)
        _upsert_margin(code, margin_raw)
    except Exception:
        pass


# ── sync helper (called from stocks sync) ────────────────────────────────────

def sync_chips_for_codes(codes: list[str], delay: float = 0.5) -> int:
    synced = 0
    for code in codes:
        if _has_today("institutional_daily", code) and _has_today("margin_daily", code):
            continue
        _fetch_and_store(code)
        synced += 1
        time.sleep(delay)
    return synced


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/chips/{code}/raw")
def get_chips_raw(code: str):
    """Debug: return first 3 rows of each raw FinMind dataset."""
    start = (date.today() - timedelta(days=10)).isoformat()
    out: dict = {}
    for name, fn, kwargs in [
        ("institutional", fm.fetch_institutional, {"code": code, "start_date": start}),
        ("margin",        fm.fetch_margin,        {"code": code, "start_date": start}),
    ]:
        try:
            rows = fn(**kwargs)
            out[name] = {"count": len(rows), "sample": rows[:3]}
        except Exception as e:
            out[name] = {"error": str(e)}
    return out


@router.get("/chips/{code}")
def get_chips(code: str):
    if not _has_today("institutional_daily", code) or not _has_today("margin_daily", code):
        _fetch_and_store(code)
    return {
        "institutional": _query_institutional(code),
        "margin":        _query_margin(code),
    }
