from grid.engine import BUY, Decision
from routers.grid import _cash_check


def buy_decision(cash_flow: float, market: str = "tw") -> Decision:
    return Decision(
        ticker="0052", name="測試 ETF", asset_class="equity", action=BUY,
        market=market, shares=100, est_cash_flow=cash_flow,
    )


def test_cash_check_no_warning_when_within_budget():
    buys = [buy_decision(-10_000), buy_decision(-20_000)]
    info, warning = _cash_check("台股", buys, available=100_000, floor=0, pending=0, currency="NT")
    assert info == {"available": 100_000, "required": 30_000, "shortfall": 0, "pendingSettlement": 0}
    assert warning is None


def test_cash_check_warns_when_multiple_tickers_overspend_shared_cash():
    # Each ticker's own gate only checks against the *whole* balance
    # (grid/engine.py::_limit_buy) — two tickers asking for 60k each against
    # a 100k balance both pass individually but together overspend by 20k.
    buys = [buy_decision(-60_000), buy_decision(-60_000)]
    info, warning = _cash_check("台股", buys, available=100_000, floor=0, pending=0, currency="NT")
    assert info["required"] == 120_000
    assert info["shortfall"] == 20_000
    assert warning is not None
    assert "20,000" in warning


def test_cash_check_available_nets_out_floor_and_pending_is_informational_only():
    buys = [buy_decision(-5_000)]
    info, warning = _cash_check("台股", buys, available=50_000, floor=10_000, pending=8_000, currency="NT")
    # available already has cash_floor subtracted (spendable, not raw balance);
    # pending is surfaced for display only and doesn't change available/shortfall
    # (build_settings already net it out of `available` before this is called).
    assert info["available"] == 40_000
    assert info["pendingSettlement"] == 8_000
    assert warning is None


def test_cash_check_no_buys_is_never_a_warning():
    info, warning = _cash_check("美股", [], available=0, floor=0, pending=0, currency="US")
    assert info == {"available": 0, "required": 0, "shortfall": 0, "pendingSettlement": 0}
    assert warning is None
