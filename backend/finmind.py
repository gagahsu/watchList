import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

TOKEN = (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9"
    ".eyJ1c2VyX2lkIjoiZ2FnYWhzdSIsImVtYWlsIjoiamlhaHVuZ2hzdUBnbWFpbC5jb20ifQ"
    ".W-PUpVQCWwM1DiNR8bVQSf92RqzCYQ7NVY4CS77CGEI"
)
BASE = "https://api.finmindtrade.com/api/v4/data"


class FinMindError(Exception):
    pass


def _check_body(body: dict) -> dict:
    api_status = body.get("status", 200)
    if api_status != 200:
        raise FinMindError(f"FinMind API error {api_status}: {body.get('msg', 'unknown')}")
    return body


def _get(params: dict) -> dict:
    """GET request — works for TaiwanStockInfo and other metadata datasets."""
    url = f"{BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "WatchList/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return _check_body(json.loads(r.read().decode("utf-8")))
    except urllib.error.HTTPError as e:
        raise FinMindError(f"HTTP {e.code}: {e.reason}") from e
    except urllib.error.URLError as e:
        raise FinMindError(f"Network error: {e.reason}") from e


def _post(params: dict) -> dict:
    """POST with form-encoded body — required for TaiwanStockPrice."""
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        BASE, data=data,
        headers={
            "User-Agent": "WatchList/1.0",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return _check_body(json.loads(r.read().decode("utf-8")))
    except urllib.error.HTTPError as e:
        # Try to read the error body for more detail
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = ""
        raise FinMindError(f"HTTP {e.code}: {e.reason} {detail}") from e
    except urllib.error.URLError as e:
        raise FinMindError(f"Network error: {e.reason}") from e


def fetch_stock_info() -> list[dict]:
    data = _get({"dataset": "TaiwanStockInfo", "token": TOKEN})
    return data.get("data", [])


def fetch_prices_for_date(trading_date: str) -> list[dict]:
    """Bulk price fetch — free tier may not allow this without data_id."""
    data = _get({
        "dataset":    "TaiwanStockPrice",
        "start_date": trading_date,
        "end_date":   trading_date,
        "token":      TOKEN,
    })
    return data.get("data", [])


def fetch_price_for_stock(stock_id: str) -> dict | None:
    """Latest daily price for one stock, looking back up to 14 calendar days."""
    start = (date.today() - timedelta(days=14)).isoformat()
    end   = date.today().isoformat()
    data = _get({
        "dataset":    "TaiwanStockPrice",
        "data_id":    stock_id,
        "start_date": start,
        "end_date":   end,
        "token":      TOKEN,
    })
    records = data.get("data", [])
    return max(records, key=lambda p: p["date"]) if records else None


def find_latest_prices_bulk() -> tuple[dict, str, str]:
    """
    Try bulk price fetch for recent trading days.
    Returns (price_map, trading_date, error_msg).
    """
    last_err = ""
    for days_back in range(7):
        d = (date.today() - timedelta(days=days_back)).isoformat()
        try:
            records = fetch_prices_for_date(d)
            if records:
                price_map    = {r["stock_id"]: r["close"] for r in records}
                trading_date = max(r["date"] for r in records)
                return price_map, trading_date, ""
        except FinMindError as e:
            last_err = str(e)
            # 400/401/403 = auth or free-tier restriction, no point retrying other dates
            if any(code in last_err for code in ("400", "401", "403")):
                break
        except Exception as e:
            last_err = str(e)
    return {}, "", last_err


def fetch_institutional(code: str, start_date: str) -> list[dict]:
    data = _get({
        "dataset":    "TaiwanStockInstitutionalInvestorsBuySell",
        "data_id":    code,
        "start_date": start_date,
        "end_date":   date.today().isoformat(),
        "token":      TOKEN,
    })
    return data.get("data", [])


def fetch_margin(code: str, start_date: str) -> list[dict]:
    data = _get({
        "dataset":    "TaiwanStockMarginPurchaseShortSale",
        "data_id":    code,
        "start_date": start_date,
        "end_date":   date.today().isoformat(),
        "token":      TOKEN,
    })
    return data.get("data", [])


def fetch_securities_lending(code: str, start_date: str) -> list[dict]:
    data = _get({
        "dataset":    "TaiwanStockSecuritiesLending",
        "data_id":    code,
        "start_date": start_date,
        "end_date":   date.today().isoformat(),
        "token":      TOKEN,
    })
    return data.get("data", [])


def fetch_shareholding(code: str, start_date: str) -> list[dict]:
    data = _get({
        "dataset":    "TaiwanStockHoldingSharesPer",
        "data_id":    code,
        "start_date": start_date,
        "end_date":   date.today().isoformat(),
        "token":      TOKEN,
    })
    return data.get("data", [])


def fetch_prices_for_codes(
    codes: list[str], delay: float = 0.3
) -> tuple[dict[str, float], dict[str, str], list[str]]:
    """
    Per-stock price fetch.
    Returns (price_map, date_map, errors_list).
    date_map: {code -> actual trading date string from API data}
    """
    price_map: dict[str, float] = {}
    date_map:  dict[str, str]   = {}
    errors: list[str] = []
    for code in codes:
        try:
            rec = fetch_price_for_stock(code)
            if rec:
                price_map[code] = rec["close"]
                date_map[code]  = rec["date"]   # actual trading date, e.g. "2026-04-28"
            else:
                errors.append(f"{code}: 無資料")
        except FinMindError as e:
            errors.append(f"{code}: {e}")
        except Exception as e:
            errors.append(f"{code}: {e}")
        time.sleep(delay)
    return price_map, date_map, errors
