import pytest

from fifo import calc_fifo


def trade(date, type_, shares, price, fee=0, id_="t"):
    return {"id": id_, "date": date, "type": type_, "shares": shares, "price": price, "fee": fee}


def test_open_lots_oldest_first_after_partial_consumption():
    trades = [
        trade("2026-01-01", "buy", 100, 50.0, 1, "a"),
        trade("2026-02-01", "buy", 100, 90.0, 1, "b"),
        trade("2026-03-01", "sell", 50, 100.0, 1, "c"),
    ]
    result = calc_fifo(trades)

    # FIFO sell consumes 50 of the oldest (50.0) lot first, leaving 50 @ 50
    # then the untouched 100 @ 90 lot — still oldest-first.
    assert [l["shares"] for l in result["openLots"]] == [50, 100]
    assert result["openLots"][0]["date"] == "2026-01-01"
    assert result["openLots"][1]["date"] == "2026-02-01"
    assert result["holdingShares"] == 150


def test_open_lots_empty_when_fully_sold():
    trades = [
        trade("2026-01-01", "buy", 100, 50.0, 1, "a"),
        trade("2026-02-01", "sell", 100, 60.0, 1, "b"),
    ]
    result = calc_fifo(trades)
    assert result["openLots"] == []
    assert result["holdingShares"] == 0


def test_open_lots_unit_price_includes_amortized_fee():
    trades = [trade("2026-01-01", "buy", 100, 50.0, 5, "a")]
    result = calc_fifo(trades)
    assert result["openLots"][0]["unit"] == pytest.approx(50.05)


class TestSellTaxRate:
    """Without asset_class, sells are taxed at the flat 0.3% individual-stock
    rate (unchanged legacy behavior, and what the frontend's calcFIFO mirror
    still does for every call site). Passing asset_class switches to the
    correct TW rate table (0% bond ETF / 0.1% other ETF / 0.3% stock)."""

    def _sell_proceeds(self, asset_class):
        trades = [
            trade("2026-01-01", "buy", 1000, 10.0, 1, "a"),
            trade("2026-02-01", "sell", 1000, 10.0, 1, "b"),
        ]
        result = calc_fifo(trades, asset_class=asset_class)
        return result["sells"][0]["realized"]

    def test_default_uses_flat_stock_rate(self):
        # amount=10000, tax=floor(10000*0.003)=30, fee=1+1=2 -> realized = -32
        assert self._sell_proceeds(None) == pytest.approx(-32)

    def test_bond_etf_is_tax_free(self):
        assert self._sell_proceeds("bond") == pytest.approx(-2)  # fee only, no tax

    def test_equity_etf_uses_lower_rate(self):
        # tax=floor(10000*0.001)=10, fee=2 -> realized = -12
        assert self._sell_proceeds("equity") == pytest.approx(-12)

    def test_stock_asset_class_matches_default(self):
        assert self._sell_proceeds("stock") == pytest.approx(-32)

    def test_us_market_never_taxed_even_with_asset_class(self):
        trades = [
            trade("2026-01-01", "buy", 100, 10.0, 1, "a"),
            trade("2026-02-01", "sell", 100, 10.0, 1, "b"),
        ]
        result = calc_fifo(trades, market="us", asset_class="stock")
        assert result["sells"][0]["realized"] == pytest.approx(-2)  # fee only
