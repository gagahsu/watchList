import json
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

TOKEN = (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9"
    ".eyJ1c2VyX2lkIjoiZ2FnYWhzdSIsImVtYWlsIjoiamlhaHVuZ2hzdUBnbWFpbC5jb20ifQ"
    ".W-PUpVQCWwM1DiNR8bVQSf92RqzCYQ7NVY4CS77CGEI"
)
BASE = "https://api.finmindtrade.com/api/v4/data"


def _get(params: dict) -> dict:
    url = f"{BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "WatchList/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_stock_info() -> list[dict]:
    """Return all TW stock records: stock_id, stock_name, type, industry_category."""
    data = _get({"dataset": "TaiwanStockInfo", "token": TOKEN})
    return data.get("data", [])


def fetch_prices_for_date(trading_date: str) -> list[dict]:
    """Return all stocks' daily price for a specific date (bulk, no data_id)."""
    data = _get({
        "dataset": "TaiwanStockDailyPrice",
        "start_date": trading_date,
        "end_date": trading_date,
        "token": TOKEN,
    })
    return data.get("data", [])


def fetch_price_for_stock(stock_id: str) -> dict | None:
    """Return the latest daily price record for one stock (last 7 days)."""
    start = (date.today() - timedelta(days=7)).isoformat()
    end = date.today().isoformat()
    data = _get({
        "dataset": "TaiwanStockDailyPrice",
        "data_id": stock_id,
        "start_date": start,
        "end_date": end,
        "token": TOKEN,
    })
    records = data.get("data", [])
    return max(records, key=lambda p: p["date"]) if records else None


def find_latest_prices() -> tuple[dict, str]:
    """
    Try the past 7 calendar days in reverse until we find a trading day.
    Returns (price_map, trading_date) where price_map is {stock_id: close}.
    Falls back to per-stock fetch for watchlist codes if bulk returns nothing.
    """
    for days_back in range(7):
        d = (date.today() - timedelta(days=days_back)).isoformat()
        try:
            records = fetch_prices_for_date(d)
            if records:
                price_map = {r["stock_id"]: r["close"] for r in records}
                trading_date = max(r["date"] for r in records)
                return price_map, trading_date
        except Exception:
            continue
    return {}, ""


def fetch_prices_for_codes(codes: list[str]) -> dict:
    """Fetch latest price one-by-one for a list of stock codes. Rate-limited to 1 req/s."""
    price_map: dict[str, float] = {}
    for code in codes:
        try:
            rec = fetch_price_for_stock(code)
            if rec:
                price_map[code] = rec["close"]
        except Exception:
            pass
        time.sleep(0.5)
    return price_map
