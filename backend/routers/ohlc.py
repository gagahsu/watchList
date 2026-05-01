import math
from fastapi import APIRouter

router = APIRouter()


def _safe(v) -> float | None:
    try:
        f = float(v)
        return f if f > 0 and not math.isnan(f) else None
    except Exception:
        return None


@router.get("/ohlc/{code}")
def get_ohlc(code: str, days: int = 60):
    import yfinance as yf
    for suffix in (".TW", ".TWO", ""):
        try:
            hist = yf.Ticker(code + suffix).history(period="4mo")
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
    return []
