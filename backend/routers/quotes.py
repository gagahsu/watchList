import math
import time
import concurrent.futures
from fastapi import APIRouter
from database import get_db, get_setting, set_setting
from pydantic import BaseModel

router = APIRouter()

_FX_CACHE_SECS = 3600  # re-fetch at most once per hour


class QuoteItem(BaseModel):
    code: str
    market: str = "tw"


class QuoteRequest(BaseModel):
    items: list[QuoteItem]


def _safe_price(p) -> float | None:
    try:
        f = float(p)
        return f if f > 0 and not math.isnan(f) else None
    except Exception:
        return None


def _price_tw(code: str) -> float | None:
    import yfinance as yf
    for suffix in (".TW", ".TWO"):
        try:
            p = _safe_price(yf.Ticker(code + suffix).fast_info.last_price)
            if p is not None:
                return p
        except Exception:
            continue
    return None


def _price_us(code: str) -> float | None:
    import yfinance as yf
    try:
        return _safe_price(yf.Ticker(code).fast_info.last_price)
    except Exception:
        return None


def _fetch(item: QuoteItem) -> tuple[str, float | None]:
    if item.market == "us":
        return item.code, _price_us(item.code)
    return item.code, _price_tw(item.code)


@router.get("/fx-rate")
def get_fx_rate():
    """Return USD/TWD exchange rate, cached in settings table for up to 1 hour."""
    cached_rate = get_setting("usdtwd_rate")
    cached_ts   = get_setting("usdtwd_ts")
    now = time.time()

    if cached_rate and cached_ts and (now - float(cached_ts)) < _FX_CACHE_SECS:
        return {"rate": float(cached_rate), "cached": True}

    import yfinance as yf
    try:
        rate = _safe_price(yf.Ticker("USDTWD=X").fast_info.last_price)
        if rate and rate > 0:
            set_setting("usdtwd_rate", str(rate))
            set_setting("usdtwd_ts",   str(now))
            return {"rate": rate, "cached": False}
    except Exception:
        pass

    # Fall back to cached value even if stale, or default
    if cached_rate:
        return {"rate": float(cached_rate), "cached": True}
    return {"rate": 31.5, "cached": True}


@router.post("/quotes")
def get_quotes(body: QuoteRequest):
    if not body.items:
        return {}
    result: dict[str, float | None] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch, item): item for item in body.items}
        for fut in concurrent.futures.as_completed(futures, timeout=30):
            item = futures[fut]
            try:
                code, price = fut.result()
                result[code] = price
            except Exception:
                result[item.code] = None

    # Persist fetched prices so the next page load doesn't need a full re-fetch
    updates = [(price, code) for code, price in result.items() if price is not None]
    if updates:
        with get_db() as conn:
            for price, code in updates:
                conn.execute(
                    "UPDATE stocks SET close=%s WHERE code=%s",
                    (price, code),
                )

    return result
