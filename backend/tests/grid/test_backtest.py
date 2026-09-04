"""回測層級的測試：確認網格在不同市況下的行為符合設計意圖。"""

import math
import random
from dataclasses import replace

import pytest

from grid.backtest import compare_summary, compare_variants, run_backtest, sweep_multiplier
from grid.config import Settings
from grid.indicators import Bar


def synth_bars(
    n: int,
    start: float = 100.0,
    drift: float = 0.0,
    vol: float = 0.015,
    seed: int = 7,
    wave: float = 0.0,
    wave_period: int = 40,
) -> list[Bar]:
    """產生合成日 K。

    ``drift`` 每日漂移、``vol`` 每日波動、``wave`` 疊加正弦波（模擬區間震盪）。
    """
    from datetime import date, timedelta

    rng = random.Random(seed)
    day = date(2026, 1, 1)
    price = start
    bars = []
    for i in range(n):
        shock = rng.gauss(drift, vol)
        price *= 1 + shock
        cyclical = 1 + wave * math.sin(2 * math.pi * i / wave_period)
        close = price * cyclical
        intraday = abs(rng.gauss(0, vol)) * close + 0.005 * close
        bars.append(
            Bar(
                date=(day + timedelta(days=i)).isoformat(),
                open=close,
                high=close + intraday / 2,
                low=max(0.01, close - intraday / 2),
                close=close,
            )
        )
    return bars


@pytest.fixture
def bt_settings(settings):
    """回測用參數：步長下限放寬，讓 ATR 真正主導。"""
    params = replace(
        settings.params_for("equity"),
        atr_multiplier=0.8,
        min_step_pct=1.0,
        max_rungs_per_day=2,
    )
    return Settings(cash=500_000.0, defaults={"equity": params, "bond": params,
                                              "leveraged": params})


def test_backtest_runs_and_reports(holding, bt_settings):
    bars = synth_bars(400, wave=0.06)
    result = run_backtest(holding, bars, bt_settings)
    assert result.bars > 300
    assert result.total_trades > 0
    assert result.cash_end != result.cash_start
    assert "測試 ETF" in result.summary()


def test_range_bound_market_generates_round_trips(holding, bt_settings):
    """區間震盪是網格的主場：買賣應該成雙成對地發生。"""
    bars = synth_bars(500, drift=0.0, vol=0.008, wave=0.08, wave_period=50)
    result = run_backtest(holding, bars, bt_settings)
    assert result.buys > 3
    assert result.sells > 3
    assert result.realized_pnl > 0


def test_grid_beats_holding_in_a_choppy_market(holding, bt_settings):
    """震盪盤中，網格的低買高賣應該勝過純持有。"""
    bars = synth_bars(600, drift=0.0, vol=0.006, wave=0.10, wave_period=60, seed=11)
    result = run_backtest(holding, bars, bt_settings)
    assert result.grid_edge > 0


def test_position_limits_cap_the_downside_accumulation(holding, bt_settings):
    """一路下跌時，加碼必須停在上限，不能無限接刀。"""
    bars = synth_bars(400, drift=-0.004, vol=0.01, seed=3)
    result = run_backtest(holding, bars, bt_settings)
    max_buy = bt_settings.params_for("equity").max_buy_rungs
    assert result.max_rung <= max_buy
    assert result.days_at_buy_limit > 0  # 確實撞到上限並停手


def test_position_floor_caps_selling_in_a_bull_market(holding, bt_settings):
    bars = synth_bars(400, drift=0.004, vol=0.01, seed=5)
    result = run_backtest(holding, bars, bt_settings)
    min_sell = bt_settings.params_for("equity").max_sell_rungs
    assert result.min_rung >= -min_sell
    assert result.shares_end > 0  # 不會被賣光


def test_no_loss_sell_keeps_realized_pnl_non_negative(holding, bt_settings):
    """allow_loss_sell=false 之下，每一筆賣出都不該是虧的。"""
    bars = synth_bars(500, drift=-0.001, vol=0.012, wave=0.05, seed=13)
    result = run_backtest(holding, bars, bt_settings)
    for trade in result.trades:
        if trade["action"] == "SELL":
            assert trade["realized_pnl"] > 0


def test_wider_step_trades_less(holding, bt_settings):
    bars = synth_bars(500, wave=0.08, seed=17)
    results = dict(
        sweep_multiplier(holding, bars, bt_settings, multipliers=(0.5, 2.0))
    )
    assert results[2.0].total_trades < results[0.5].total_trades


def test_tighter_step_costs_more_in_fees(holding, bt_settings):
    bars = synth_bars(500, wave=0.08, seed=19)
    results = dict(
        sweep_multiplier(holding, bars, bt_settings, multipliers=(0.5, 2.0))
    )
    tight = results[0.5]
    wide = results[2.0]
    assert tight.total_fees + tight.total_tax >= wide.total_fees + wide.total_tax


def test_backtest_rejects_insufficient_history(holding, bt_settings):
    with pytest.raises(ValueError, match="需要至少"):
        run_backtest(holding, synth_bars(20), bt_settings)


def test_cash_never_goes_negative(holding, bt_settings):
    bars = synth_bars(500, drift=-0.003, vol=0.015, seed=23)
    small_cash = Settings(cash=20_000.0, defaults=bt_settings.defaults)
    result = run_backtest(holding, bars, small_cash, cash=20_000.0)
    assert result.cash_end >= 0


def test_bond_class_trades_without_tax(holding, bt_settings):
    bond = replace(holding, asset_class="bond")
    bars = synth_bars(500, vol=0.004, wave=0.03, seed=29)
    result = run_backtest(bond, bars, bt_settings)
    assert result.total_tax == 0
    assert result.total_fees > 0


# ------------------------------------------------------------ compare_variants


def test_compare_variants_returns_the_default_four_labels(holding, bt_settings):
    bars = synth_bars(400, wave=0.06)
    results = compare_variants(holding, bars, bt_settings)
    assert [label for label, _ in results] == ["純網格", "B1 單階佔部位比例", "C1 不對稱步長", "B1+C1"]


def test_compare_variants_baseline_matches_plain_run_backtest(holding, bt_settings):
    """「純網格」組的覆寫是空字典，B1/C1 都維持關閉，數字應該跟直接呼叫
    run_backtest() 一模一樣——這是 compare_variants() 本身不該改變任何行為
    的保證。"""
    bars = synth_bars(400, wave=0.06)
    baseline = run_backtest(holding, bars, bt_settings)
    results = dict(compare_variants(holding, bars, bt_settings))
    grid_only = results["純網格"]
    assert grid_only.total_trades == baseline.total_trades
    assert grid_only.equity_end == pytest.approx(baseline.equity_end)


def test_compare_variants_preserves_holdings_existing_overrides(holding, bt_settings, monkeypatch):
    """每一組疊加的覆寫（B1/C1）不該把 holding 原本就有的覆寫（例如個股已經
    調過的 atr_multiplier）蓋掉。用 spy 攔截實際傳進 run_backtest() 的
    holding.overrides，直接檢查合併結果，避免依賴回測結果的成交次數等
    容易受其他因素干擾的間接指標。"""
    import grid.backtest as backtest_module

    custom = replace(holding, overrides={"atr_multiplier": 1.2})
    seen: list[dict] = []
    original = backtest_module.run_backtest

    def spy(h, bars, settings, cash=None):
        seen.append(dict(h.overrides))
        return original(h, bars, settings, cash=cash)

    monkeypatch.setattr(backtest_module, "run_backtest", spy)
    bars = synth_bars(400, wave=0.06)
    backtest_module.compare_variants(custom, bars, bt_settings)

    assert seen[0] == {"atr_multiplier": 1.2}  # 純網格：不疊加任何東西
    assert seen[1] == {"atr_multiplier": 1.2, "rung_pct_of_baseline": 0.02}
    assert seen[2] == {"atr_multiplier": 1.2, "sell_step_multiple": 1.5}
    assert seen[3] == {
        "atr_multiplier": 1.2, "rung_pct_of_baseline": 0.02, "sell_step_multiple": 1.5,
    }


def test_compare_variants_asymmetric_step_sells_less_in_a_bull_market(holding, bt_settings):
    """C1 的用意是「讓利潤奔跑」：單邊上漲時賣出步長變寬，賣得比對稱版慢，
    賣出次數應該更少、期末持股應該更多。"""
    bars = synth_bars(400, drift=0.004, vol=0.01, seed=5)
    results = dict(compare_variants(holding, bars, bt_settings))
    grid_only = results["純網格"]
    asymmetric = results["C1 不對稱步長"]
    assert asymmetric.sells <= grid_only.sells
    assert asymmetric.shares_end >= grid_only.shares_end


def test_compare_summary_lists_every_variant(holding, bt_settings):
    bars = synth_bars(400, wave=0.06)
    results = compare_variants(holding, bars, bt_settings)
    text = compare_summary(results)
    for label, _ in results:
        assert label in text
