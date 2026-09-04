import contextlib

from routers import linebot


def broker(discount=0.28, min_fee=1, rounding="floor"):
    return {"discount": discount, "min_fee": min_fee, "rounding": rounding}


@contextlib.contextmanager
def _fake_get_db(conn):
    yield conn


def test_calc_fee_tw_uses_broker_schedule():
    # 1,000 shares @ 580 = 580,000; *0.001425*0.28 = 231.42 -> floor 231
    assert linebot._calc_fee(1000, 580, broker(), market="tw") == 231


def test_calc_fee_floors_to_broker_minimum():
    assert linebot._calc_fee(1, 10, broker(min_fee=20), market="tw") == 20


def test_calc_fee_zero_for_us_market():
    assert linebot._calc_fee(1000, 580, broker(), market="us") == 0


def test_calc_tax_zero_on_buy():
    assert linebot._calc_tax(1000, 100, "buy", "equity", market="tw") == 0


def test_calc_tax_zero_for_us_market():
    assert linebot._calc_tax(1000, 100, "sell", "stock", market="us") == 0


def test_calc_tax_sell_bond_is_exempt():
    # Bond ETFs are tax-exempt on sell (grid/fees.py::BOND_ETF_TAX_RATE == 0)
    assert linebot._calc_tax(1000, 100, "sell", "bond", market="tw") == 0


def test_calc_tax_sell_stock_rate():
    # 1000 * 100 = 100,000 * 0.3% = 300
    assert linebot._calc_tax(1000, 100, "sell", "stock", market="tw") == 300


def test_calc_tax_sell_equity_etf_rate():
    # 1000 * 100 = 100,000 * 0.1% = 100
    assert linebot._calc_tax(1000, 100, "sell", "equity", market="tw") == 100


def test_bulk_markets_and_asset_classes_infers_us_market_from_code_shape(monkeypatch):
    class FakeConn:
        def execute(self, *_a, **_k):
            return self

        def fetchall(self):
            return []

    monkeypatch.setattr(linebot, "get_db", lambda: _fake_get_db(FakeConn()))
    markets, asset_classes = linebot._bulk_markets_and_asset_classes(["AAPL", "2330"])
    assert markets == {"AAPL": "us", "2330": "tw"}
    assert asset_classes == {"AAPL": "stock", "2330": "stock"}


def test_bulk_markets_and_asset_classes_prefers_recorded_values(monkeypatch):
    class FakeConn:
        def execute(self, sql, _params=None):
            self._sql = sql
            return self

        def fetchall(self):
            if "trade_markets" in self._sql:
                return [{"code": "0052", "market": "tw"}]
            if "grid_positions" in self._sql:
                return [{"code": "0052", "asset_class": "bond"}]
            return [{"code": "0052", "name": "元大寶灣"}]

    monkeypatch.setattr(linebot, "get_db", lambda: _fake_get_db(FakeConn()))
    markets, asset_classes = linebot._bulk_markets_and_asset_classes(["0052"])
    assert markets == {"0052": "tw"}
    assert asset_classes == {"0052": "bond"}


def test_bulk_markets_and_asset_classes_empty_codes_short_circuits():
    assert linebot._bulk_markets_and_asset_classes([]) == ({}, {})


def test_resolve_account_id_prefers_broker_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    b = {"account_id": "broker-account"}
    assert linebot._resolve_account_id(b) == "broker-account"


def test_resolve_account_id_falls_back_when_broker_has_no_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    b = {"account_id": None}
    assert linebot._resolve_account_id(b) == "fallback-account"


def test_resolve_account_id_falls_back_when_no_broker(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    assert linebot._resolve_account_id(None) == "fallback-account"


def test_resolve_account_id_none_when_nothing_configured(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: None)
    assert linebot._resolve_account_id(None) is None
    assert linebot._resolve_account_id({"account_id": None}) is None
