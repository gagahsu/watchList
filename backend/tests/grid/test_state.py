import pytest

from grid.state import Lot, Position, State


def make_position() -> Position:
    return Position(
        ticker="0052",
        shares=300,
        anchor=100.0,
        baseline_shares=300,
        lots=[
            Lot(date="2026-01-01", price=50.0, shares=100, source="initial"),
            Lot(date="2026-02-01", price=90.0, shares=100),
            Lot(date="2026-03-01", price=95.0, shares=100),
        ],
    )


def test_average_cost():
    position = make_position()
    assert position.average_cost() == pytest.approx((50 + 90 + 95) * 100 / 300)


def test_sell_matches_most_recent_lot_first():
    """優先消耗最後一筆 95 的批次"""
    position = make_position()
    pnl, _ = position.apply_sell("2026-03-10", price=100.0, shares=100, rungs=1)
    assert pnl == pytest.approx((100 - 95) * 100)
    assert position.shares == 200
    assert position.rung == -1
    assert len(position.lots) == 2
    assert position.lots[-1].price == 90.0


def test_sell_spanning_multiple_lots():
    position = make_position()
    pnl, _ = position.apply_sell("2026-03-10", price=100.0, shares=150, rungs=1)
    # 95 元那批 100 股 + 90 元那批 50 股
    expected = (100 - 95) * 100 + (100 - 90) * 50
    assert pnl == pytest.approx(expected)
    assert position.lots[-1].shares == 50


def test_peek_sell_basis_does_not_mutate():
    position = make_position()
    before = [(lot.price, lot.shares) for lot in position.lots]
    basis = position.peek_sell_basis(150)
    assert basis == pytest.approx(95 * 100 + 90 * 50)
    assert [(lot.price, lot.shares) for lot in position.lots] == before


def test_sell_more_than_recorded_lots_falls_back_to_average():
    """狀態與券商實際庫存不同步時不該炸掉。"""
    position = Position(ticker="X", shares=100, anchor=10.0, lots=[])
    pnl, _ = position.apply_sell("2026-03-10", price=10.0, shares=100, rungs=1)
    assert pnl == pytest.approx(0.0)
    assert position.shares == 0


def test_buy_appends_a_lot():
    position = make_position()
    position.apply_buy("2026-03-11", price=88.0, shares=50, rungs=1)
    assert position.shares == 350
    assert position.rung == 1
    assert position.lots[-1].price == 88.0
