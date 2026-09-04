from dataclasses import replace

import pytest
from tests.grid.conftest import TODAY, bars_with_atr

from grid.config import Settings
from grid.engine import (
    BEAR,
    BULL,
    BUY,
    NEUTRAL,
    HOLD,
    REVIEW,
    SELL,
    SKIP,
    commit,
    evaluate,
    grid_step,
    lot_size,
)
from grid.state import Lot


def _evaluate(holding, position, settings, state, price, bars=None, today=TODAY):
    bars = bars if bars is not None else bars_with_atr(60, close=100.0, spread=2.0)
    return evaluate(holding, position, bars, price, settings, state, today=today)


# ------------------------------------------------------------------ 基本行為


def test_lot_size_tracks_price(settings):
    assert lot_size(100.0, settings) == 50  # 50 * 100 = 5000 < 5012.53
    assert lot_size(50.0, settings) == 100


def test_grid_step_clamped_by_floor(settings):
    params = settings.params_for("equity")
    # ATR 0.2、價格 100 → 0.5 * 0.2 = 0.1，低於下限 0.1% * 100 = 0.1
    assert grid_step(100.0, 0.2, params) == pytest.approx(0.1)


def test_grid_step_clamped_by_ceiling(settings):
    params = replace(settings.params_for("equity"), max_step_pct=1.0)
    assert grid_step(100.0, 50.0, params) == pytest.approx(1.0)


def test_no_signal_inside_the_grid(holding, position, settings, state):
    # ATR ≈ 2.0 → 步長 ≈ 1.0。價格距錨點 0.5 元，不到一格。
    decision = _evaluate(holding, position, settings, state, price=100.5)
    assert decision.action == HOLD
    assert decision.shares == 0


def test_buy_signal_when_price_drops_one_step(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=98.9)
    assert decision.action == BUY
    assert decision.rungs == 1
    assert decision.shares == lot_size(98.9, settings)
    assert decision.est_cash_flow < 0
    assert decision.anchor_after < decision.anchor_before


def test_sell_signal_when_price_rises_one_step(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=101.1)
    assert decision.action == SELL
    assert decision.rungs == 1
    assert decision.est_cash_flow > 0
    assert decision.anchor_after > decision.anchor_before


def test_multiple_rungs_when_price_moves_far(holding, position, settings, state):
    # 步長約 1.0，跌 2.5 元 → 2 格（受單日上限 2 份限制）
    decision = _evaluate(holding, position, settings, state, price=97.5)
    assert decision.action == BUY
    assert decision.rungs == 2


def test_daily_rung_cap_is_enforced(holding, position, settings, state):
    tight = replace(settings.params_for("equity"), max_rungs_per_day=1)
    settings = Settings(cash=settings.cash, defaults={"equity": tight})
    decision = _evaluate(holding, position, settings, state, price=95.0)
    assert decision.rungs == 1
    assert any("單日上限" in n for n in decision.notes)


# ------------------------------------------------------------------ 風控閘門


def test_unverified_ticker_is_blocked(holding, position, settings, state):
    holding = replace(holding, ticker_verified=False)
    decision = _evaluate(holding, position, settings, state, price=90.0)
    assert decision.action == SKIP
    assert any("代號" in b for b in decision.blocks)


def test_insufficient_bars_is_skipped(holding, position, settings, state):
    decision = _evaluate(
        holding, position, settings, state, price=98.0, bars=bars_with_atr(5)
    )
    assert decision.action == SKIP
    assert any("ATR" in b for b in decision.blocks)


def test_stale_data_is_skipped(holding, position, settings, state):
    # K 棒停在 3 月中，卻在年底才執行 → 資料過期
    decision = _evaluate(
        holding, position, settings, state, price=98.0, today="2026-12-31"
    )
    assert decision.action == SKIP
    assert any("未更新" in b for b in decision.blocks)


def test_large_gap_triggers_manual_review(holding, position, settings, state):
    # ATR ≈ 2.0，跳空 10 元 = 5 倍 ATR，超過 3 倍上限
    decision = _evaluate(holding, position, settings, state, price=90.0)
    assert decision.action == REVIEW
    assert decision.shares == 110
    assert any("跳空" in r for r in decision.reasons)


def test_buy_blocked_at_position_limit(holding, position, settings, state):
    position.rung = 5  # 已達 max_buy_rungs
    decision = _evaluate(holding, position, settings, state, price=98.9)
    assert decision.shares == 0
    assert any("加碼至上限" in b for b in decision.blocks)


def test_buy_trimmed_to_remaining_room(holding, position, settings, state):
    position.rung = 4  # 只剩 1 階
    decision = _evaluate(holding, position, settings, state, price=97.5)
    assert decision.rungs == 1
    assert any("部位上限" in n for n in decision.notes)


def test_sell_blocked_at_position_floor(holding, position, settings, state):
    position.rung = -5
    decision = _evaluate(holding, position, settings, state, price=101.1)
    assert decision.shares == 0
    assert any("減碼至下限" in b for b in decision.blocks)


def test_buy_blocked_without_cash(holding, position, settings, state):
    state.cash = 100.0
    decision = _evaluate(holding, position, settings, state, price=98.9)
    assert decision.shares == 0
    assert any("現金不足" in b for b in decision.blocks)


def test_buy_trimmed_to_available_cash(holding, position, settings, state):
    state.cash = 5_500.0  # 只夠一份
    decision = _evaluate(holding, position, settings, state, price=97.5)
    assert decision.rungs == 1


def test_cash_floor_is_respected(holding, position, settings, state):
    state.cash = 10_000.0
    settings = replace(settings, cash_floor=9_000.0)
    decision = _evaluate(holding, position, settings, state, price=98.9)
    assert decision.shares == 0


def test_sell_blocked_when_holding_less_than_one_lot(holding, position, settings, state):
    position.shares = 10
    position.lots = [Lot(date="2026-01-01", price=50.0, shares=10)]
    decision = _evaluate(holding, position, settings, state, price=101.1)
    assert decision.shares == 0
    assert any("不足一份" in b for b in decision.blocks)


def test_loss_making_sell_is_blocked(holding, position, settings, state):
    # 這批成本 200，現價 101 賣出必虧
    position.lots = [Lot(date="2026-01-01", price=200.0, shares=1000)]
    decision = _evaluate(holding, position, settings, state, price=101.1)
    assert decision.shares == 0
    assert any("虧損賣出" in b for b in decision.blocks)


def test_loss_making_sell_allowed_when_configured(holding, position, settings, state):
    position.lots = [Lot(date="2026-01-01", price=200.0, shares=1000)]
    loose = replace(settings.params_for("equity"), allow_loss_sell=True)
    settings = Settings(cash=settings.cash, defaults={"equity": loose})
    decision = _evaluate(holding, position, settings, state, price=101.1)
    assert decision.action == SELL
    assert decision.shares > 0
    assert decision.est_realized_pnl < 0


# -------------------------------------------------------------- 除息與漂移


def test_ex_dividend_lowers_anchor_before_signalling(holding, position, settings, state):
    """除息 3 元不該被誤判成下跌 3 元。"""
    holding = replace(
        holding, ex_dividends=[{"date": "2026-03-10", "amount": 3.0}]
    )
    decision = _evaluate(holding, position, settings, state, price=100.0)
    assert position.anchor == pytest.approx(97.0)
    assert decision.action == SELL  # 相對除息後的錨點，價格反而偏高
    assert any("除息" in n for n in decision.notes)


def test_ex_dividend_applied_only_once(holding, position, settings, state):
    holding = replace(holding, ex_dividends=[{"date": "2026-03-10", "amount": 3.0}])
    _evaluate(holding, position, settings, state, price=100.0)
    anchor_after_first = position.anchor
    _evaluate(holding, position, settings, state, price=100.0)
    assert position.anchor == pytest.approx(anchor_after_first)


def test_future_ex_dividend_is_not_applied(holding, position, settings, state):
    holding = replace(holding, ex_dividends=[{"date": "2026-09-10", "amount": 3.0}])
    _evaluate(holding, position, settings, state, price=100.0)
    assert position.anchor == pytest.approx(100.0)


def test_up_only_drift_raises_anchor_in_uptrend(holding, position, settings, state):
    drifting = replace(
        settings.params_for("equity"),
        drift_mode="up_only",
        drift_beta=0.1,
        trend_ema_period=20,
    )
    settings = Settings(cash=settings.cash, defaults={"equity": drifting})
    bars = bars_with_atr(80, close=140.0, spread=2.0, trend=0.5)  # 明顯上升趨勢
    position.anchor = 100.0
    _evaluate(holding, position, settings, state, price=bars[-1].close, bars=bars)
    assert position.anchor > 100.0


def test_up_only_drift_never_lowers_the_anchor(holding, position, settings, state):
    """錨點高於均線時不該被往下拉 —— 否則系統會系統性地賣在低點。"""
    drifting = replace(
        settings.params_for("equity"),
        drift_mode="up_only",
        drift_beta=0.1,
        trend_ema_period=20,
    )
    settings = Settings(cash=settings.cash, defaults={"equity": drifting})
    bars = bars_with_atr(80, close=100.0, spread=2.0, trend=-0.5)  # 下降趨勢
    position.anchor = 130.0  # 明顯高於 EMA20
    _evaluate(holding, position, settings, state, price=bars[-1].close, bars=bars)
    assert position.anchor == pytest.approx(130.0)


def test_both_drift_mode_does_lower_the_anchor(holding, position, settings, state):
    two_way = replace(
        settings.params_for("equity"),
        drift_mode="both",
        drift_beta=0.1,
        trend_ema_period=20,
    )
    settings = Settings(cash=settings.cash, defaults={"equity": two_way})
    bars = bars_with_atr(80, close=100.0, spread=2.0, trend=-0.5)
    position.anchor = 130.0
    _evaluate(holding, position, settings, state, price=bars[-1].close, bars=bars)
    assert position.anchor < 130.0


# ------------------------------------------------------------------- commit


def test_commit_buy_updates_everything(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=98.9)
    cash_before = state.cash
    commit(state, decision, trade_date=TODAY)

    assert position.shares == 1000 + decision.shares
    assert position.rung == 1
    assert position.anchor == pytest.approx(decision.anchor_after)
    assert state.cash == pytest.approx(cash_before + decision.est_cash_flow)
    assert len(state.trades) == 1
    assert state.trades[0].action == BUY


def test_commit_sell_realizes_profit(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=101.1)
    commit(state, decision, trade_date=TODAY)

    assert position.shares == 1000 - decision.shares
    assert position.rung == -1
    assert state.trades[0].realized_pnl > 0  # 成本 50，賣在 101
    assert state.cash > 1_000_000.0


def test_round_trip_buy_then_sell_returns_to_origin(holding, position, settings, state):
    buy = _evaluate(holding, position, settings, state, price=98.9)
    commit(state, buy, trade_date=TODAY)
    assert position.rung == 1

    sell = _evaluate(holding, position, settings, state, price=100.2, today="2026-03-16")
    assert sell.action == SELL
    commit(state, sell, trade_date="2026-03-16")
    assert position.rung == 0
    # 低買高賣，這一趟該是賺的
    assert state.trades[-1].realized_pnl > 0


def test_hold_decision_is_not_committed(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=100.2)
    commit(state, decision, trade_date=TODAY)
    assert state.trades == []
    assert position.shares == 1000


def test_multi_rung_order_is_costed_as_separate_orders(
    holding, position, settings, state
):
    """買 2 份的手續費應該是 1+1，而不是合併下單的 3 元。"""
    decision = _evaluate(holding, position, settings, state, price=97.5)
    assert decision.rungs == 2
    assert decision.est_fee == 2
    assert any("分 2 筆" in n for n in decision.notes)


def test_single_rung_has_no_split_note(holding, position, settings, state):
    decision = _evaluate(holding, position, settings, state, price=98.9)
    assert decision.est_fee == 1
    assert not any("分" in n and "筆" in n for n in decision.notes)


def test_us_stock_decision_has_no_fee_or_tax(settings):
    """美股走零手續費券商，買賣都不該產生手續費或證交稅。"""
    from grid.config import Holding
    from grid.state import Lot, Position, State

    us_settings = Settings(
        us_cash=1_000_000.0,
        defaults={**settings.defaults, "stock": settings.params_for("equity")},
    )
    us_holding = Holding(
        ticker="AAPL", name="Apple", asset_class="stock", market="us",
        shares=1000, avg_cost=50.0, ticker_verified=True,
    )
    us_position = Position(
        ticker="AAPL", shares=1000, anchor=100.0, rung=0, baseline_shares=1000,
        lots=[Lot(date="2026-01-01", price=50.0, shares=1000, source="initial")],
    )
    us_state = State(us_cash=1_000_000.0, positions={"AAPL": us_position})

    buy = _evaluate(us_holding, us_position, us_settings, us_state, price=97.5)
    assert buy.action == BUY
    assert buy.est_fee == 0
    assert buy.est_tax == 0
    # 零手續費沒有「湊到最低手續費」的一份股數概念，一份就是 1 股。
    assert lot_size(97.5, us_settings, "us") == 1

    sell = _evaluate(us_holding, us_position, us_settings, us_state, price=102.6, today="2026-03-16")
    assert sell.action == SELL
    assert sell.est_fee == 0
    assert sell.est_tax == 0


def test_us_buy_is_gated_by_us_cash_not_tw_cash(settings):
    """一個有大量台幣現金、但美元現金不足的帳戶，不該被台幣餘額誤判成夠錢買美股
    （這是 grid_cash_account_id 跟 grid_us_cash_account_id 沒分開時會踩到的坑）。"""
    from grid.config import Holding
    from grid.state import Lot, Position, State

    us_settings = Settings(
        cash=1_000_000.0,  # 大把台幣現金
        us_cash=100.0,     # 但美元現金只有 $100，不夠買一股 $97.5 x 3 格
        defaults={**settings.defaults, "stock": settings.params_for("equity")},
    )
    us_holding = Holding(
        ticker="AAPL", name="Apple", asset_class="stock", market="us",
        shares=1000, avg_cost=50.0, ticker_verified=True,
    )
    us_position = Position(
        ticker="AAPL", shares=1000, anchor=100.0, rung=0, baseline_shares=1000,
        lots=[Lot(date="2026-01-01", price=50.0, shares=1000, source="initial")],
    )
    us_state = State(cash=1_000_000.0, us_cash=100.0, positions={"AAPL": us_position})

    decision = _evaluate(us_holding, us_position, us_settings, us_state, price=95.0)
    assert decision.rungs == 1  # $100 只夠買 1 股
    assert decision.shares == 1


def test_drift_applies_only_once_per_day(holding, position, settings, state):
    """同一天重複執行 advise 不該把錨點越推越遠。"""
    drifting = replace(
        settings.params_for("equity"),
        drift_mode="up_only",
        drift_beta=0.1,
        trend_ema_period=20,
    )
    settings = Settings(cash=settings.cash, defaults={"equity": drifting})
    bars = bars_with_atr(80, close=140.0, spread=2.0, trend=0.5)

    position.anchor = 100.0
    _evaluate(holding, position, settings, state, price=140.0, bars=bars)
    after_first = position.anchor
    assert after_first > 100.0

    _evaluate(holding, position, settings, state, price=140.0, bars=bars)
    assert position.anchor == pytest.approx(after_first)


def test_drift_resumes_the_next_day(holding, position, settings, state):
    drifting = replace(
        settings.params_for("equity"),
        drift_mode="up_only",
        drift_beta=0.1,
        trend_ema_period=20,
    )
    settings = Settings(cash=settings.cash, defaults={"equity": drifting})
    bars = bars_with_atr(80, close=140.0, spread=2.0, trend=0.5)

    position.anchor = 100.0
    _evaluate(holding, position, settings, state, price=140.0, bars=bars)
    after_first = position.anchor
    _evaluate(
        holding, position, settings, state, price=140.0, bars=bars, today="2026-03-16"
    )
    assert position.anchor > after_first


# ------------------------------------------------------ 趨勢濾網（單邊行情）


def _with_params(settings, **overrides):
    """把 equity 的參數換掉，回傳新的 Settings。"""
    params = replace(settings.params_for("equity"), **overrides)
    return Settings(cash=settings.cash, defaults={"equity": params})


#: 一路漲的日 K：最後 20 根收在 81~100，MA20≈90.5、RSI=100
BULL_BARS = dict(count=60, close=100.0, spread=2.0, trend=1.0)
#: 一路跌的日 K：最後 20 根收在 119~100，MA20≈109.5、MACD DIF < 0
BEAR_BARS = dict(count=60, close=100.0, spread=2.0, trend=-1.0)


def test_regime_is_neutral_when_filter_is_off(holding, position, settings, state):
    # 預設 trend_filter_mode='off'：多頭走勢照樣賣，行為與加入濾網前一致
    decision = _evaluate(
        holding, position, settings, state, price=103.0, bars=bars_with_atr(**BULL_BARS)
    )
    assert decision.regime == NEUTRAL
    assert decision.action == SELL
    assert decision.shares > 0


def test_pause_filter_stops_selling_in_a_bull_run(holding, position, settings, state):
    settings = _with_params(settings, trend_filter_mode="pause")
    decision = _evaluate(
        holding, position, settings, state, price=103.0, bars=bars_with_atr(**BULL_BARS)
    )
    assert decision.regime == BULL
    assert decision.action == HOLD
    assert decision.shares == 0
    assert any("暫停賣出" in r for r in decision.reasons)


def test_pause_filter_still_buys_in_a_bull_run(holding, position, settings, state):
    # 濾網只擋逆勢的那一邊：多頭時的買進（回檔承接）不受影響
    settings = _with_params(settings, trend_filter_mode="pause")
    decision = _evaluate(
        holding, position, settings, state, price=97.0, bars=bars_with_atr(**BULL_BARS)
    )
    assert decision.action == BUY
    assert decision.shares > 0


def test_pause_filter_stops_buying_in_a_bear_run(holding, position, settings, state):
    settings = _with_params(settings, trend_filter_mode="pause")
    decision = _evaluate(
        holding, position, settings, state, price=97.0, bars=bars_with_atr(**BEAR_BARS)
    )
    assert decision.regime == BEAR
    assert decision.action == HOLD
    assert decision.shares == 0
    assert any("避免接刀" in r for r in decision.reasons)


def test_pause_filter_still_sells_in_a_bear_run(holding, position, settings, state):
    settings = _with_params(settings, trend_filter_mode="pause")
    decision = _evaluate(
        holding, position, settings, state, price=103.0, bars=bars_with_atr(**BEAR_BARS)
    )
    assert decision.action == SELL
    assert decision.shares > 0


def test_widen_filter_doubles_the_step_against_the_trend(
    holding, position, settings, state
):
    # ATR=2 → 原步長 1.0。距錨點 3 元本來是 3 格，步長放大成 2.0 後只剩 1 格。
    settings = _with_params(
        settings, trend_filter_mode="widen", trend_step_multiple=2.0
    )
    decision = _evaluate(
        holding, position, settings, state, price=103.0, bars=bars_with_atr(**BULL_BARS)
    )
    assert decision.regime == BULL
    assert decision.action == SELL
    assert decision.step == pytest.approx(2.0)
    assert decision.signal_rungs == 1
    assert any("步長由" in n for n in decision.notes)


def test_widen_filter_leaves_the_with_trend_side_alone(
    holding, position, settings, state
):
    settings = _with_params(
        settings, trend_filter_mode="widen", trend_step_multiple=2.0
    )
    decision = _evaluate(
        holding, position, settings, state, price=97.0, bars=bars_with_atr(**BULL_BARS)
    )
    assert decision.action == BUY
    assert decision.step == pytest.approx(1.0)
    assert decision.signal_rungs == 3


# ------------------------------------------------------------------ 底倉


def test_base_position_blocks_the_last_sell(holding, position, settings, state):
    # 建檔 1000 股、底倉 50% → 500 股是地板，持股剛好到地板就不再賣
    settings = _with_params(settings, base_position_pct=0.5)
    position.shares = 500
    decision = _evaluate(holding, position, settings, state, price=103.0)
    assert decision.action == REVIEW
    assert decision.shares == 0
    assert any("底倉保護" in b for b in decision.blocks)


def test_base_position_caps_the_sellable_shares(holding, position, settings, state):
    # 持股 560、底倉 500 → 只剩 60 股可賣，一份 48 股（103 元）故只賣 1 份
    settings = _with_params(settings, base_position_pct=0.5)
    position.shares = 560
    decision = _evaluate(holding, position, settings, state, price=103.0)
    assert decision.action == SELL
    assert decision.base_shares == 500
    assert decision.rungs == 1
    assert position.shares - decision.shares >= 500


def test_no_base_position_by_default_sells_down_to_zero(
    holding, position, settings, state
):
    position.shares = 50
    decision = _evaluate(holding, position, settings, state, price=103.0)
    assert decision.base_shares == 0
    assert decision.action == SELL
    assert decision.shares == 48  # 一份 48 股（103 元），50 股只夠賣一份


# ------------------------------------------------ 網格區間上移（trailing grid）


def test_range_reset_needs_consecutive_days(holding, position, settings, state):
    # 步長 1.0、max_sell_rungs 5 → 上緣 105。106 元算突破，但只站一天不重設。
    settings = _with_params(settings, range_reset_days=3)
    decision = _evaluate(holding, position, settings, state, price=106.0)
    assert position.anchor == pytest.approx(100.0)
    assert position.breakout_days == 1
    assert any("1/3 天" in n for n in decision.notes)


def test_range_reset_counter_is_once_per_day(holding, position, settings, state):
    settings = _with_params(settings, range_reset_days=3)
    _evaluate(holding, position, settings, state, price=106.0)
    _evaluate(holding, position, settings, state, price=106.0)
    assert position.breakout_days == 1


def test_range_reset_counter_resets_when_price_falls_back(
    holding, position, settings, state
):
    settings = _with_params(settings, range_reset_days=3)
    _evaluate(holding, position, settings, state, price=106.0)
    _evaluate(holding, position, settings, state, price=103.0, today="2026-03-16")
    assert position.breakout_days == 0
    assert position.last_breakout_date is None


def test_range_reset_moves_the_whole_grid_up(holding, position, settings, state):
    settings = _with_params(settings, range_reset_days=3)
    position.rung = -3  # 一路賣上來，已經減碼三階
    for day in ("2026-03-15", "2026-03-16", "2026-03-17"):
        decision = _evaluate(
            holding, position, settings, state, price=106.0, today=day
        )
    assert position.anchor == pytest.approx(106.0)
    assert position.rung == 0
    assert position.breakout_days == 0
    assert decision.action == HOLD  # 錨點就是現價，當天不再有訊號
    assert any("區間上移" in n for n in decision.notes)


def test_range_reset_off_by_default(holding, position, settings, state):
    for day in ("2026-03-15", "2026-03-16", "2026-03-17"):
        _evaluate(holding, position, settings, state, price=106.0, today=day)
    assert position.anchor == pytest.approx(100.0)
    assert position.breakout_days == 0


def test_range_reset_ignores_gap_days(holding, position, settings, state):
    # 除息、拆分或報價異常都長得像「一天衝過上緣」；區間上移不可逆，跳空日不算
    settings = _with_params(settings, range_reset_days=1)
    decision = _evaluate(holding, position, settings, state, price=130.0)
    assert decision.action == REVIEW
    assert position.anchor == pytest.approx(100.0)
    assert position.breakout_days == 0
