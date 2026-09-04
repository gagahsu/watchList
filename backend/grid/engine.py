"""ATR 自適應網格引擎。

每天 13:00 對每一檔標的做這件事：

1. 用昨日以前的**完整日 K** 算 Wilder ATR(14)（今天的盤還沒收，不能拿來算）。
2. 步長 ``step = clamp(k * ATR, min_step_pct * P, max_step_pct * P)``。
   波動放大，格子自動變寬；波動收斂，格子自動變窄。
3. 現價 P 與錨點 anchor 相差幾個步長，就是要成交幾份。
   跌破 → 買；漲過 → 賣。
4. 一連串風控閘門逐一檢查，全過才輸出下單建議。
5. 成交後錨點移動到新的網格價位，階數同步更新。

純網格假設價格會在區間裡來回，遇到單邊走勢會兩頭挨打：一路漲把籌碼賣光
（賣飛）、一路跌把子彈打光（接刀）。三道可選的閘門專治這件事，預設全部關閉，
不打開時的行為與純網格完全相同：

* **趨勢濾網**（``trend_filter_mode``）：極端多／空頭時暫停逆勢的那一邊，
  或把逆勢方向的步長放大，讓格子變稀。見 :func:`detect_regime`。
* **底倉**（``base_position_pct``）：建檔股數的固定比例永遠不參與網格賣出，
  賣飛時仍留有部位吃到趨勢。見 :func:`base_position_shares`。
* **區間上移**（``range_reset_days``）：站穩網格上緣數日就把錨點移到現價、
  階數歸零，在新中樞重開一組網格。見 :func:`apply_range_reset`。

「一份」永遠是「手續費剛好 1 元的最大股數」，隨當日價格重算。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Sequence

from .config import GridParams, Holding, Settings, resolve_params
from .fees import max_shares_for_min_fee, split_buy_cost, split_sell_cost
from .indicators import Bar, ema, macd, sma, wilder_atr, wilder_rsi
from .state import Position, State, Trade

# 決策動作
BUY = "BUY"
SELL = "SELL"
HOLD = "HOLD"
REVIEW = "REVIEW"  # 有訊號但需要人工判斷
SKIP = "SKIP"  # 資料或設定不足，無法評估

# 趨勢濾網判定出的行情狀態
BULL = "bull"  # 強勢多頭：抑制賣出
BEAR = "bear"  # 強勢空頭：抑制買進
NEUTRAL = "neutral"  # 盤整或訊號不明：純網格


@dataclass
class Decision:
    """單一標的的當日決策。"""

    ticker: str
    name: str
    asset_class: str
    action: str
    market: str = "tw"
    shares: int = 0
    rungs: int = 0
    lot_shares: int = 0
    price: float = 0.0
    anchor_before: float = 0.0
    anchor_after: float = 0.0
    step: float = 0.0
    atr: float | None = None
    atr_pct: float | None = None
    step_pct: float = 0.0
    price_band_low: float | None = None
    price_band_high: float | None = None
    rung_before: int = 0
    rung_after: int = 0
    position_shares: int = 0
    est_gross: float = 0.0
    est_fee: int = 0
    est_tax: int = 0
    est_cash_flow: float = 0.0  # 負數表示現金流出
    est_realized_pnl: float | None = None
    signal_rungs: int = 0  # 未受限制前的原始訊號份數
    regime: str = NEUTRAL  # 趨勢濾網判定的行情狀態
    base_shares: int = 0  # 底倉股數（不參與網格賣出）
    reasons: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def is_actionable(self) -> bool:
        return self.action in (BUY, SELL) and self.shares > 0


def lot_size(price: float, settings: Settings, market: str = "tw") -> int:
    """fee-optimal lot：手續費仍等於最低收費的最大股數。美股零手續費，固定是 1 股。"""
    return max_shares_for_min_fee(price, settings.fee_discount, settings.fee_minimum, market)


def rung_shares(
    price: float, settings: Settings, params: GridParams, baseline_shares: float, market: str = "tw"
) -> int:
    """單階實際股數。``rung_pct_of_baseline`` 關閉（0，預設）時就是 :func:`lot_size`
    的 fee-optimal lot，行為與加入這個參數之前完全一樣。開啟後改成
    ``baseline_shares × rung_pct_of_baseline``，並以 fee-optimal lot 當下限
    （股數只會比它多，不會比它少，維持「手續費仍是最低收費」的下限保護）。

    這是讓「一份」跟部位大小掛鉤：固定的 fee-optimal lot 對大部位太小
    （滿檔幾階只動到部位的一小部分，網格空轉），對小部位太大（幾階就把整個
    部位賣光）。美股沒有手續費上限這個概念，lot_size 恆為 1 股，這裡也不
    套用比例。"""
    fee_optimal = lot_size(price, settings, market)
    if market != "tw" or params.rung_pct_of_baseline <= 0:
        return fee_optimal
    return max(fee_optimal, int(baseline_shares * params.rung_pct_of_baseline))


def grid_step(price: float, atr: float, params: GridParams) -> float:
    """ATR 決定的網格步長，夾在百分比上下限之間。"""
    raw = params.atr_multiplier * atr
    low = params.min_step_pct / 100.0 * price
    high = params.max_step_pct / 100.0 * price
    return min(max(raw, low), high)


def apply_ex_dividends(
    position: Position, holding: Holding, today: str
) -> list[str]:
    """把已經發生、但還沒反映到錨點的除息扣掉。

    這是網格用在配息型 ETF 上最容易爆的地雷：除息當天價格自然下跌，網格若沒
    調整錨點，就會把「除息」誤判成「下跌」而觸發買進訊號。使用者持有的高股息
    與債券 ETF 大多月配或季配，這個修正是必要的。
    """
    notes: list[str] = []
    for entry in holding.ex_dividends:
        ex_date = str(entry["date"])
        if ex_date in position.applied_ex_dividends:
            continue
        if ex_date > today:
            continue
        amount = float(entry["amount"])
        position.anchor -= amount
        position.applied_ex_dividends.append(ex_date)
        notes.append(f"{ex_date} 除息 {amount:.4f} 元，錨點下調至 {position.anchor:.4f}")
    return notes


def apply_anchor_drift(
    position: Position,
    trend_ref: float | None,
    params: GridParams,
    today: str | None = None,
) -> str | None:
    """讓錨點緩慢往趨勢均線靠攏。

    純網格在單邊行情中會失效：一路漲會賣光後再也買不回，一路跌會一直接刀。
    讓錨點以 ``drift_beta`` 的比例往長期均線靠，網格中樞就會跟著趨勢移動。

    預設 ``up_only``：只允許往上漂。這樣多頭時網格會跟上，不會早早賣光；空頭時
    錨點不下移，避免系統性地「賣在低點」。

    漂移一天只做一次 —— 同一天重複執行 advise 不該把錨點推得更遠。
    """
    if params.drift_mode == "off" or trend_ref is None:
        return None
    if today is not None and position.last_drift_date == today:
        return None
    delta = params.drift_beta * (trend_ref - position.anchor)
    if params.drift_mode == "up_only" and delta <= 0:
        return None
    if abs(delta) < 1e-9:
        return None
    before = position.anchor
    position.anchor += delta
    position.last_drift_date = today
    return (
        f"錨點跟隨 EMA{params.trend_ema_period}（{trend_ref:.2f}）由 "
        f"{before:.4f} 漂移至 {position.anchor:.4f}"
    )


@dataclass(frozen=True)
class Regime:
    """趨勢濾網的判定結果，連同判定所用的指標值一起帶出來供報表說明。"""

    state: str
    ma: float | None = None
    rsi: float | None = None
    macd_dif: float | None = None

    def describe(self, params: GridParams) -> str:
        if self.state == BULL:
            return (
                f"強勢多頭：現價站上 MA{params.trend_ma_period}"
                f"（{self.ma:.2f}）且 RSI({params.rsi_period})="
                f"{self.rsi:.1f} > {params.rsi_overbought:g}"
            )
        if self.state == BEAR:
            return (
                f"強勢空頭：現價跌破 MA{params.trend_ma_period}"
                f"（{self.ma:.2f}）且 MACD DIF={self.macd_dif:.3f} < 0"
            )
        return "趨勢中性"


def detect_regime(
    bars: Sequence[Bar], price: float, params: GridParams
) -> Regime:
    """判斷現在是不是「不該逆勢下單」的單邊行情。

    網格預設是左側交易（越跌越買、越漲越賣），在盤整區間最有效率，但遇到單邊
    走勢就會兩頭挨打：一路漲會把籌碼賣光（賣飛），一路跌會把子彈打光（接刀）。
    這裡用「均線定方向、震盪指標定強度」的老配方判定極端狀態：

    * 現價 > MA 且 RSI 超買 → 多頭，這時的賣出訊號是在賣飛
    * 現價 < MA 且 MACD DIF < 0 → 空頭，這時的買進訊號是在接刀

    兩個條件都不成立就回 ``NEUTRAL``，網格照常運作 —— 濾網只在極端時說話，
    不然會把網格本來要賺的震盪也一起濾掉。
    """
    if params.trend_filter_mode == "off":
        return Regime(NEUTRAL)

    closes = [bar.close for bar in bars]
    ma = sma(closes, params.trend_ma_period)
    if ma is None:
        return Regime(NEUTRAL)

    if price > ma:
        rsi = wilder_rsi(closes, params.rsi_period)
        if rsi is not None and rsi > params.rsi_overbought:
            return Regime(BULL, ma=ma, rsi=rsi)
        return Regime(NEUTRAL, ma=ma, rsi=rsi)

    if price < ma:
        values = macd(closes, params.macd_fast, params.macd_slow, params.macd_signal)
        dif = values[0] if values else None
        if dif is not None and dif < 0:
            return Regime(BEAR, ma=ma, macd_dif=dif)
        return Regime(NEUTRAL, ma=ma, macd_dif=dif)

    return Regime(NEUTRAL, ma=ma)


def apply_range_reset(
    position: Position,
    price: float,
    step: float,
    params: GridParams,
    today: str,
) -> str | None:
    """突破網格上緣站穩數日就把整個區間上移（trailing grid）。

    錨點漂移（``apply_anchor_drift``）走的是 EMA60，落後很多；成長型標的一旦
    真的突破，靠漂移追不上，網格會停在下方等一個回不來的價格。這裡改用硬條件：
    現價連續 ``range_reset_days`` 天站上網格上緣（錨點 + 最大賣出階數 × 步長），
    就把錨點重設到現價、階數歸零，等於在新的中樞重開一組網格。

    階數歸零是有意的：先前一路賣上來把階數壓成負的，那些格子是屬於舊區間的，
    在新區間繼續沿用只會讓系統以為自己已經賣到下限而不再動作。

    一天只累計一次；價格跌回區間內就把計數歸零，避免「突破一天、休息一天」的
    假突破也被算成站穩。
    """
    if params.range_reset_days <= 0:
        return None

    ceiling = position.anchor + params.max_sell_rungs * step
    if price <= ceiling:
        if position.breakout_days:
            position.breakout_days = 0
            position.last_breakout_date = None
        return None

    if position.last_breakout_date != today:
        position.breakout_days += 1
        position.last_breakout_date = today

    if position.breakout_days < params.range_reset_days:
        return (
            f"現價 {price:.2f} 站上網格上緣 {ceiling:.2f}，已第 "
            f"{position.breakout_days}/{params.range_reset_days} 天"
        )

    before_anchor = position.anchor
    before_rung = position.rung
    position.anchor = price
    position.rung = 0
    position.breakout_days = 0
    position.last_breakout_date = None
    return (
        f"連續 {params.range_reset_days} 天站上網格上緣 {ceiling:.2f}，網格區間上移："
        f"錨點 {before_anchor:.4f} → {price:.4f}，階數 {before_rung:+d} → 0"
    )


def base_position_shares(position: Position, params: GridParams) -> int:
    """底倉股數：建檔股數的 ``base_position_pct``，永遠不參與網格賣出。

    以「建檔股數」而非「當下股數」為基準，底倉才會是一個固定的地板 —— 拿當下
    股數算的話，每賣一次底倉就跟著縮水，最後還是會賣光，那就不是底倉了。
    """
    if params.base_position_pct <= 0:
        return 0
    return int(position.baseline_shares * params.base_position_pct)


def _staleness_days(last_bar_date: str, today: str) -> int:
    last = datetime.strptime(last_bar_date, "%Y-%m-%d").date()
    now = datetime.strptime(today, "%Y-%m-%d").date()
    return (now - last).days


def evaluate(
    holding: Holding,
    position: Position,
    bars: Sequence[Bar],
    price: float,
    settings: Settings,
    state: State,
    today: str | None = None,
) -> Decision:
    """對單一標的產生今日決策。

    ``bars`` 必須是**已收盤**的日 K（不含今天），``price`` 是 13:00 的即時價。
    本函式會就地更新 ``position`` 的錨點（除息、漂移、區間上移；區間上移另會
    重設 ``rung`` 與突破計數），但不會執行成交 ── 成交由 :func:`commit` 負責。
    """
    today = today or date.today().isoformat()
    params = resolve_params(settings, holding)
    decision = Decision(
        ticker=holding.ticker,
        name=holding.name,
        asset_class=holding.asset_class,
        action=SKIP,
        market=holding.market,
        price=price,
        anchor_before=position.anchor,
        anchor_after=position.anchor,
        rung_before=position.rung,
        rung_after=position.rung,
        position_shares=position.shares,
    )

    # ------------------------------------------------------------ 前置檢查
    if not holding.ticker_verified:
        decision.blocks.append("股票代號尚未驗證，先跑 `atrgrid verify-tickers`")
        return decision

    if price <= 0:
        decision.blocks.append("取不到有效即時價")
        return decision

    if not bars:
        decision.blocks.append("沒有日 K 資料")
        return decision

    stale = _staleness_days(bars[-1].date, today)
    if stale > settings.max_data_staleness_days:
        decision.blocks.append(
            f"日 K 資料已 {stale} 天未更新（最後一筆 {bars[-1].date}）"
        )
        return decision

    atr = wilder_atr(bars, params.atr_period)
    if atr is None or atr <= 0:
        decision.blocks.append(
            f"ATR({params.atr_period}) 無法計算，僅有 {len(bars)} 根日 K"
        )
        return decision

    # ------------------------------------------------ 錨點維護（除息、漂移）
    decision.notes.extend(apply_ex_dividends(position, holding, today))
    closes = [bar.close for bar in bars]
    trend_ref = ema(closes, params.trend_ema_period)
    drift_note = apply_anchor_drift(position, trend_ref, params, today)
    if drift_note:
        decision.notes.append(drift_note)
    decision.anchor_before = position.anchor
    decision.anchor_after = position.anchor

    # ---------------------------------------------------------------- 網格
    base_step = grid_step(price, atr, params)
    lot = rung_shares(price, settings, params, position.baseline_shares, holding.market)
    decision.atr = atr
    decision.atr_pct = atr / price * 100
    decision.lot_shares = lot
    decision.base_shares = base_position_shares(position, params)

    prev_close = bars[-1].close
    gap_atr = abs(price - prev_close) / atr
    is_gap = gap_atr > params.gap_atr_limit
    if is_gap:
        decision.reasons.append(
            f"相對前收 {prev_close:.2f} 跳空 {gap_atr:.1f} 倍 ATR，超過 "
            f"{params.gap_atr_limit:g} 倍上限"
        )
        decision.blocks.append("異常跳空，請先確認是否為除息、拆分或重大事件")

    # 區間上移要在算距離之前做完，否則會用舊錨點下一張早該作廢的單。跳空日不算
    # 突破 —— 除息、拆分或報價異常都會長得像「一天衝過上緣」，而區間上移是會
    # 改寫錨點與階數的不可逆動作，寧可多等一天。
    if not is_gap:
        reset_note = apply_range_reset(position, price, base_step, params, today)
        if reset_note:
            decision.notes.append(reset_note)
    decision.anchor_before = position.anchor
    decision.anchor_after = position.anchor

    distance = price - position.anchor
    side = SELL if distance > 0 else BUY

    # 不對稱步長：賣出步長永久是買進步長的 sell_step_multiple 倍，不像趨勢濾網
    # 的 widen 只在判定為逆勢時才放大。用意一樣是「讓利潤奔跑」，但不靠落後
    # 指標判斷 regime，單邊上漲時網格自然賣得慢一點。1.0（預設）＝關閉，跟加入
    # 這個參數之前完全一樣。
    step = base_step * params.sell_step_multiple if side == SELL else base_step
    if params.sell_step_multiple != 1.0 and side == SELL:
        decision.notes.append(
            f"不對稱步長：賣出步長由 {base_step:.3f} 放大 {params.sell_step_multiple:g} 倍為 {step:.3f} 元"
        )
    decision.step = step
    decision.step_pct = step / price * 100

    # ------------------------------------------------------------ 趨勢濾網
    regime = detect_regime(bars, price, params)
    decision.regime = regime.state
    against_trend = (regime.state == BULL and side == SELL) or (
        regime.state == BEAR and side == BUY
    )
    if against_trend:
        decision.reasons.append(regime.describe(params))
        if params.trend_filter_mode == "pause":
            decision.action = HOLD
            decision.reasons.append(
                "趨勢濾網 pause：暫停"
                + ("賣出，讓多頭部位的利潤繼續跑" if side == SELL else "買進，避免接刀")
            )
            return decision
        if params.trend_filter_mode == "widen":
            widened = step * params.trend_step_multiple
            decision.step = widened
            decision.step_pct = widened / price * 100
            decision.notes.append(
                f"趨勢濾網 widen：{'賣出' if side == SELL else '買進'}步長由 "
                f"{step:.3f} 放大 {params.trend_step_multiple:g} 倍為 {widened:.3f} 元"
            )
            step = widened

    raw_rungs = int(abs(distance) // step)
    if raw_rungs == 0:
        decision.action = HOLD
        decision.reasons.append(
            f"現價距錨點 {abs(distance):.3f} 元，未滿一格 {step:.3f} 元"
            f"（{decision.step_pct:.2f}%）"
        )
        return decision

    decision.signal_rungs = raw_rungs
    decision.action = side
    if side == BUY:
        decision.price_band_low = position.anchor - (raw_rungs + 1) * step
        decision.price_band_high = position.anchor - raw_rungs * step
    else:
        decision.price_band_low = position.anchor + raw_rungs * step
        decision.price_band_high = position.anchor + (raw_rungs + 1) * step
    decision.reasons.append(
        f"ATR({params.atr_period})={atr:.3f}（{decision.atr_pct:.2f}%），"
        f"步長 {step:.3f} 元（{decision.step_pct:.2f}%）"
    )
    decision.reasons.append(
        f"現價 {price:.2f} {'高於' if side == SELL else '低於'}錨點 "
        f"{position.anchor:.2f} 共 {raw_rungs} 格"
    )
    decision.notes.append(
        f"價格在 {decision.price_band_low:.2f}~{decision.price_band_high:.2f} 之間，"
        f"份數都維持 {raw_rungs} 份（超出區間需重新試算）"
    )

    # ------------------------------------------------------------ 風控閘門
    rungs = min(raw_rungs, params.max_rungs_per_day)
    if rungs < raw_rungs:
        decision.notes.append(
            f"單日上限 {params.max_rungs_per_day} 份，本次由 {raw_rungs} 份縮減"
        )

    if side == BUY:
        rungs = _limit_buy(decision, position, params, settings, state, price, lot, rungs, holding.market)
    else:
        rungs = _limit_sell(decision, position, params, settings, price, lot, rungs, holding.market)

    if rungs <= 0:
        decision.action = HOLD if not decision.blocks else REVIEW
        decision.shares = 0
        return decision

    shares = lot * rungs
    decision.rungs = rungs
    decision.shares = shares
    if rungs > 1 and holding.market == "tw":
        if lot <= lot_size(price, settings, holding.market):
            # 一份剛好是手續費 1 元的上限，合併下單會踩過門檻。
            decision.notes.append(
                f"請分 {rungs} 筆、每筆 {lot} 股下單（合併成 {shares} 股一筆會多付手續費）"
            )
        else:
            # rung_pct_of_baseline 開啟時一份已經比 fee-optimal lot 大，
            # 分筆下單不再有省手續費的意義，只是單純提示分批量。
            decision.notes.append(f"請分 {rungs} 筆、每筆 {lot} 股下單")

    if side == BUY:
        cost = split_buy_cost(
            rungs, lot, price, settings.fee_discount, settings.fee_minimum, holding.market
        )
        decision.est_gross = float(cost.gross)
        decision.est_fee = cost.fee
        decision.est_cash_flow = -float(cost.net)
        decision.anchor_after = position.anchor - step * rungs
        decision.rung_after = position.rung + rungs
    else:
        cost = split_sell_cost(
            rungs,
            lot,
            price,
            holding.asset_class,
            settings.fee_discount,
            settings.fee_minimum,
            holding.market,
        )
        decision.est_gross = float(cost.gross)
        decision.est_fee = cost.fee
        decision.est_tax = cost.tax
        decision.est_cash_flow = float(cost.proceeds)
        basis = position.peek_sell_basis(shares)
        decision.est_realized_pnl = float(cost.proceeds) - basis
        decision.anchor_after = position.anchor + step * rungs
        decision.rung_after = position.rung - rungs

    if decision.blocks:
        decision.action = REVIEW

    return decision


def _limit_buy(
    decision: Decision,
    position: Position,
    params: GridParams,
    settings: Settings,
    state: State,
    price: float,
    lot: int,
    rungs: int,
    market: str = "tw",
) -> int:
    """把買進份數壓到部位上限與現金允許的範圍內。"""
    room = params.max_buy_rungs - position.rung
    if room <= 0:
        decision.blocks.append(
            f"已加碼至上限（第 {position.rung} 階 / 上限 {params.max_buy_rungs} 階）"
        )
        return 0
    if rungs > room:
        decision.notes.append(f"受部位上限限制，由 {rungs} 份縮減為 {room} 份")
        rungs = room

    cash = state.us_cash if market == "us" else state.cash
    cash_floor = settings.us_cash_floor if market == "us" else settings.cash_floor
    spendable = cash - cash_floor
    if spendable <= 0:
        decision.blocks.append(
            f"可用現金 {cash:,.2f} 已達保留水位 {cash_floor:,.2f}"
        )
        return 0

    while rungs > 0:
        cost = split_buy_cost(
            rungs, lot, price, settings.fee_discount, settings.fee_minimum, market
        )
        if float(cost.net) <= spendable:
            break
        rungs -= 1
    if rungs == 0:
        one_lot = float(
            split_buy_cost(
                1, lot, price, settings.fee_discount, settings.fee_minimum, market
            ).net
        )
        unit = "美元" if market == "us" else "元"
        decision.blocks.append(
            f"現金不足，買一份需約 {one_lot:,.2f} {unit}，可動用 {spendable:,.2f} {unit}"
        )
    return rungs


def _limit_sell(
    decision: Decision,
    position: Position,
    params: GridParams,
    settings: Settings,
    price: float,
    lot: int,
    rungs: int,
    market: str = "tw",
) -> int:
    """把賣出份數壓到部位下限、實際持股與「不賠售」規則之內。"""
    room = params.max_sell_rungs + position.rung
    if room <= 0:
        decision.blocks.append(
            f"已減碼至下限（第 {position.rung} 階 / 下限 -{params.max_sell_rungs} 階）"
        )
        return 0
    if rungs > room:
        decision.notes.append(f"受部位下限限制，由 {rungs} 份縮減為 {room} 份")
        rungs = room

    base_shares = base_position_shares(position, params)
    sellable = position.shares - base_shares
    if base_shares and sellable <= 0:
        decision.blocks.append(
            f"底倉保護：持股 {position.shares} 股已到底倉 {base_shares} 股"
            f"（建檔 {int(position.baseline_shares)} 股 × "
            f"{params.base_position_pct:.0%}），不再往下賣"
        )
        return 0

    max_by_shares = sellable // lot if lot else 0
    if max_by_shares < rungs:
        if base_shares:
            decision.notes.append(
                f"持股 {position.shares} 股扣掉底倉 {base_shares} 股後，"
                f"僅夠賣 {max_by_shares} 份"
            )
        else:
            decision.notes.append(
                f"持股 {position.shares} 股僅夠賣 {max_by_shares} 份"
            )
        rungs = max_by_shares
    if rungs <= 0:
        decision.blocks.append(
            f"持股 {position.shares} 股（可賣 {sellable} 股）不足一份（{lot} 股）"
        )
        return 0

    if not params.allow_loss_sell:
        while rungs > 0:
            shares = lot * rungs
            cost = split_sell_cost(
                rungs,
                lot,
                price,
                decision.asset_class,
                settings.fee_discount,
                settings.fee_minimum,
                market,
            )
            if float(cost.proceeds) - position.peek_sell_basis(shares) > 0:
                break
            rungs -= 1
        if rungs == 0:
            decision.blocks.append(
                "扣除手續費與證交稅後為虧損賣出，已依 allow_loss_sell=false 擋下"
            )
    return rungs


def commit(state: State, decision: Decision, trade_date: str | None = None) -> None:
    """把決策寫進狀態：更新持股、錨點、階數、現金與成交紀錄。"""
    if not decision.is_actionable:
        return
    trade_date = trade_date or date.today().isoformat()
    position = state.positions[decision.ticker]

    if decision.action == BUY:
        position.apply_buy(trade_date, decision.price, decision.shares, decision.rungs)
        realized = 0.0
    else:
        gross_pnl, _ = position.apply_sell(
            trade_date, decision.price, decision.shares, decision.rungs
        )
        realized = gross_pnl - decision.est_fee - decision.est_tax

    position.anchor = decision.anchor_after
    if decision.market == "us":
        state.us_cash += decision.est_cash_flow
    else:
        state.cash += decision.est_cash_flow
    state.trades.append(
        Trade(
            date=trade_date,
            ticker=decision.ticker,
            action=decision.action,
            shares=decision.shares,
            price=decision.price,
            fee=decision.est_fee,
            tax=decision.est_tax,
            rungs=decision.rungs,
            realized_pnl=round(realized, 2),
        )
    )
    state.last_run_date = trade_date


def next_grid_levels(
    position: Position, step: float, count: int = 3
) -> tuple[list[float], list[float]]:
    """回傳接下來的買進與賣出價位，讓報表可以顯示「還要跌多少才買」。"""
    buys = [position.anchor - step * i for i in range(1, count + 1)]
    sells = [position.anchor + step * i for i in range(1, count + 1)]
    return buys, sells


def trading_day_hint(today: str | None = None) -> str | None:
    """週末提醒。國定假日不在此判斷 ── 交由資料來源的新鮮度檢查兜底。"""
    today = today or date.today().isoformat()
    weekday = datetime.strptime(today, "%Y-%m-%d").date().weekday()
    if weekday >= 5:
        return "今天是週末，台股休市；以下為參考試算"
    return None


def business_days_ago(days: int, today: str | None = None) -> str:
    base = (
        datetime.strptime(today, "%Y-%m-%d").date() if today else date.today()
    )
    return (base - timedelta(days=days)).isoformat()
