from fastapi import APIRouter, HTTPException
from database import get_db
from models import DividendRecordIn, DividendRecordOut
import uuid, time, json
import urllib.request, urllib.parse

router = APIRouter()

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.9",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.cmoney.tw/",
}


def _row(r) -> dict:
    return {
        "id": r["id"], "code": r["code"], "exDate": r["ex_date"],
        "cashDiv": r["cash_div"], "stockDiv": r["stock_div"],
        "payDate": r["pay_date"], "note": r["note"],
    }


def _http_get(url: str, extra_headers: dict = {}) -> bytes:
    headers = {**_HEADERS, **extra_headers}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def _fetch_cmoney(code: str) -> list[dict]:
    """Scrape CMoney ETF dividend page — Next.js __NEXT_DATA__ embedded JSON."""
    url = f"https://www.cmoney.tw/etf/tw/{code}/cashdividend"
    html = _http_get(url).decode("utf-8", errors="ignore")

    # Next.js embeds all page data as JSON inside <script id="__NEXT_DATA__">
    marker = '__NEXT_DATA__" type="application/json">'
    start = html.find(marker)
    if start == -1:
        raise ValueError("__NEXT_DATA__ not found in CMoney page")
    start += len(marker)
    end = html.find("</script>", start)
    data = json.loads(html[start:end])

    # Navigate to the dividend records in the page props
    records = []
    props = data.get("props", {}).get("pageProps", {})
    # CMoney stores dividend list under various keys — walk to find it
    for key in ("cashDividendList", "dividendList", "data", "dividends"):
        items = props.get(key, [])
        if items:
            for item in items:
                ex = item.get("exDividendDate") or item.get("exDate") or item.get("ex_date", "")
                cash = float(item.get("cashDividend") or item.get("cashDiv") or item.get("cash", 0) or 0)
                pay = item.get("payDate") or item.get("pay_date") or None
                if ex and cash > 0:
                    records.append({"exDate": ex[:10], "cashDiv": cash, "payDate": pay[:10] if pay else None})
            break
    return records


def _fetch_finmind(code: str) -> list[dict]:
    """FinMind TaiwanStockDividend — works for stocks, may include some ETFs."""
    from finmind import TOKEN, BASE, _check_body
    start = "2018-01-01"
    url = f"{BASE}?{urllib.parse.urlencode({'dataset':'TaiwanStockDividend','data_id':code,'start_date':start,'token':TOKEN})}"
    req = urllib.request.Request(url, headers={"User-Agent": "WatchList/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        body = _check_body(json.loads(r.read()))
    records = []
    for item in body.get("data", []):
        ex = item.get("date", "")
        cash = float(item.get("CashDividend") or item.get("cash_dividend") or 0)
        pay = item.get("CashDividendPaymentDate") or item.get("payDate") or None
        if ex and cash > 0:
            records.append({"exDate": ex[:10], "cashDiv": cash, "payDate": pay[:10] if pay else None})
    return records


def _fetch_twse(code: str) -> list[dict]:
    """TWSE open API for cash dividend / ex-right records."""
    # TWSE provides ex-dividend data per stock via TWT49U endpoint
    url = (
        "https://www.twse.com.tw/rwd/zh/exRight/TWT49U"
        f"?response=json&strDate=20180101&endDate=99991231&selectType=&stockNo={code}"
    )
    raw = _http_get(url, {"Referer": "https://www.twse.com.tw/"})
    body = json.loads(raw)
    records = []
    fields = body.get("fields", [])
    for row in body.get("data", []):
        item = dict(zip(fields, row))
        ex = item.get("除息交易日", "") or item.get("除權交易日", "")
        # Convert ROC date (114/01/15) → ISO (2025-01-15)
        if "/" in ex:
            parts = ex.split("/")
            ex = f"{int(parts[0])+1911}-{parts[1]}-{parts[2]}"
        cash_str = item.get("現金股利", "") or item.get("息值", "") or "0"
        try:
            cash = float(cash_str.replace(",", ""))
        except Exception:
            cash = 0
        if ex and cash > 0:
            records.append({"exDate": ex, "cashDiv": cash, "payDate": None})
    return records


@router.post("/dividends/sync/{code}")
def sync_dividends(code: str):
    """
    Try multiple sources to fetch dividend records for a stock/ETF code,
    upsert into dividend_records table, and return a summary.
    """
    code = code.upper().strip()
    results = {"code": code, "source": None, "fetched": 0, "saved": 0, "errors": []}

    records: list[dict] = []
    for name, fn in [("cmoney", _fetch_cmoney), ("twse", _fetch_twse), ("finmind", _fetch_finmind)]:
        try:
            records = fn(code)
            if records:
                results["source"] = name
                results["fetched"] = len(records)
                break
        except Exception as e:
            results["errors"].append(f"{name}: {e}")

    if not records:
        return results

    saved = 0
    with get_db() as conn:
        for rec in records:
            existing = conn.execute(
                "SELECT id FROM dividend_records WHERE code=%s AND ex_date=%s",
                (code, rec["exDate"]),
            ).fetchone()
            if existing:
                continue
            conn.execute(
                "INSERT INTO dividend_records(id,code,ex_date,cash_div,stock_div,pay_date,note) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s)",
                (str(uuid.uuid4()), code, rec["exDate"], rec["cashDiv"], 0,
                 rec.get("payDate"), "auto-sync"),
            )
            saved += 1

    results["saved"] = saved
    return results


@router.get("/dividends", response_model=list[DividendRecordOut])
def list_dividends():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM dividend_records ORDER BY ex_date DESC, id DESC"
        ).fetchall()
    return [_row(r) for r in rows]


@router.post("/dividends", response_model=DividendRecordOut)
def create_dividend(body: DividendRecordIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO dividend_records(id,code,ex_date,cash_div,stock_div,pay_date,note) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s)",
            (body.id, body.code, body.exDate, body.cashDiv, body.stockDiv, body.payDate, body.note),
        )
        row = conn.execute("SELECT * FROM dividend_records WHERE id=%s", (body.id,)).fetchone()
    return _row(row)


@router.delete("/dividends/{div_id}")
def delete_dividend(div_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM dividend_records WHERE id=%s", (div_id,)).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("DELETE FROM dividend_records WHERE id=%s", (div_id,))
    return {"ok": True}
