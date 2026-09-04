import pytest

from grid.indicators import (
    Bar,
    atr_series,
    ema,
    ema_series,
    macd,
    sma,
    true_range,
    wilder_atr,
    wilder_rsi,
)


def make_bars(n: int, base: float = 100.0, spread: float = 2.0) -> list[Bar]:
    bars = []
    for i in range(n):
        close = base + i * 0.1
        bars.append(
            Bar(
                date=f"2026-01-{i + 1:02d}",
                open=close,
                high=close + spread / 2,
                low=close - spread / 2,
                close=close,
            )
        )
    return bars


def test_true_range_without_previous_close():
    bar = Bar("2026-01-01", 100, 102, 99, 101)
    assert true_range(bar, None) == 3


def test_true_range_uses_gap():
    bar = Bar("2026-01-02", 100, 102, 99, 101)
    # 前收 90 → |102 - 90| = 12 勝過當日高低差 3
    assert true_range(bar, 90) == 12


def test_bar_rejects_inverted_range():
    with pytest.raises(ValueError):
        Bar("2026-01-01", 100, 98, 102, 100)


def test_atr_needs_enough_bars():
    assert wilder_atr(make_bars(10), period=14) is None
    assert wilder_atr(make_bars(15), period=14) is not None


def test_atr_of_constant_range_equals_that_range():
    """每天高低差固定 2.0、價格平移 0.1，ATR 應趨近 2.0。"""
    atr = wilder_atr(make_bars(60, spread=2.0), period=14)
    assert atr == pytest.approx(2.0, abs=0.15)


def test_atr_expands_with_volatility():
    calm = wilder_atr(make_bars(60, spread=1.0), period=14)
    wild = wilder_atr(make_bars(60, spread=5.0), period=14)
    assert wild > calm * 4


def test_atr_series_aligns_with_bars():
    bars = make_bars(40)
    series = atr_series(bars, period=14)
    assert len(series) == len(bars)
    assert series[13] is None
    assert series[14] is not None
    assert series[-1] == pytest.approx(wilder_atr(bars, 14))


def test_ema_of_constant_series_is_that_constant():
    assert ema([5.0] * 30, 10) == pytest.approx(5.0)


def test_ema_tracks_trend_below_latest_value():
    values = [float(i) for i in range(1, 51)]
    result = ema(values, 10)
    assert result is not None
    assert result < values[-1]
    assert result > values[-15]


def test_ema_series_final_matches_ema():
    values = [float(i % 7) + i * 0.3 for i in range(60)]
    assert ema_series(values, 20)[-1] == pytest.approx(ema(values, 20))


def test_ema_returns_none_when_too_short():
    assert ema([1.0, 2.0], 10) is None


# ------------------------------------------------- SMA / RSI / MACD（趨勢濾網）


def test_sma_uses_the_latest_window():
    assert sma([1.0, 2.0, 3.0, 4.0], 2) == pytest.approx(3.5)


def test_sma_needs_enough_data():
    assert sma([1.0, 2.0], 3) is None


def test_rsi_is_100_when_every_bar_gains():
    assert wilder_rsi([float(i) for i in range(1, 40)]) == pytest.approx(100.0)


def test_rsi_is_0_when_every_bar_loses():
    assert wilder_rsi([float(i) for i in range(40, 1, -1)]) == pytest.approx(0.0)


def test_rsi_on_a_flat_series_is_neutral_not_overbought():
    # 全平盤沒有定義良好的 RSI；回 100 會讓沒動的標的被誤判成強勢多頭
    assert wilder_rsi([100.0] * 30) == pytest.approx(50.0)


def test_rsi_needs_period_plus_one_bars():
    assert wilder_rsi([100.0] * 14, period=14) is None
    assert wilder_rsi([100.0] * 15, period=14) is not None


def test_macd_is_positive_in_an_uptrend():
    dif, dem, hist = macd([float(i) for i in range(1, 80)])
    assert dif > 0
    assert dem > 0


def test_macd_is_negative_in_a_downtrend():
    dif, _, _ = macd([float(i) for i in range(80, 1, -1)])
    assert dif < 0


def test_macd_needs_enough_data():
    assert macd([float(i) for i in range(30)]) is None


def test_macd_rejects_fast_not_shorter_than_slow():
    with pytest.raises(ValueError):
        macd([float(i) for i in range(80)], fast=26, slow=26)
