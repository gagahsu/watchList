import math
import concurrent.futures
from fastapi import APIRouter
from database import get_db
from pydantic import BaseModel

router = APIRouter()


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
