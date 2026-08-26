import math
from fastapi import APIRouter

router = APIRouter()


def _safe(v) -> float | None:
    try:
        f = float(v)
        return f if f > 0 and not math.isnan(f) else None
    except Exception:
        return None


def _finmind_ohlc(code: str, days: int) -> list[dict]:
    """Fallback for when Yahoo is unreachable. FinMind has no suffix
    ambiguity (no .TW/.TWO) since it's queried by plain code."""
    from finmind import fetch_daily_bars
    records = fetch_daily_bars(code)
    result = []
    for r in records:
        o, h, l, c = _safe(r.get("open")), _safe(r.get("max")), _safe(r.get("min")), _safe(r.get("close"))
        if None in (o, h, l, c):
            continue
        result.append({
            "date":   r["date"],
            "open":   round(o, 2),
            "high":   round(h, 2),
            "low":    round(l, 2),
            "close":  round(c, 2),
            "volume": int(r.get("Trading_Volume") or 0),
        })
    return result[-days:]


@router.get("/ohlc/{code}")
def get_ohlc(code: str, days: int = 120, market: str = "tw"):
    """Return up to `days` OHLC bars (use 120 so front-end can compute MA60 across 60 display bars).

    `market` picks the Yahoo suffix strategy: 'tw' tries .TW/.TWO (falling
    back to bare in case Yahoo already delists the suffix), 'us' tickers
    are unsuffixed on Yahoo so only the bare code is tried. FinMind (the
    Yahoo-unreachable fallback) only carries Taiwan data, so it's skipped
    entirely for 'us'.
    """
    suffixes = (".TW", ".TWO", "") if market != "us" else ("",)
    for suffix in suffixes:
        try:
            import yfinance as yf
            hist = yf.Ticker(code + suffix).history(period="6mo")
            if len(hist) == 0:
                continue
            tail = hist.tail(days)
            result = []
            for date, row in tail.iterrows():
                o = _safe(row["Open"])
                h = _safe(row["High"])
                l = _safe(row["Low"])
                c = _safe(row["Close"])
                if None in (o, h, l, c):
                    continue
                result.append({
                    "date":   date.strftime("%Y-%m-%d"),
                    "open":   round(o, 2),
                    "high":   round(h, 2),
                    "low":    round(l, 2),
                    "close":  round(c, 2),
                    "volume": int(row.get("Volume", 0)),
                })
            if result:
                return result
        except Exception:
            continue

    if market == "us":
        return []

    try:
        result = _finmind_ohlc(code, days)
        if result:
            return result
    except Exception:
        pass
    return []
