"""設定檔載入與驗證。

兩個檔案：

* ``config/settings.yaml``  ── 全域參數（手續費折數、各資產類別的網格參數、風控）
* ``config/portfolio.yaml`` ── 持股清單（代號、名稱、股數、平均成本、類別）
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date as _date
from decimal import Decimal
from typing import Any

VALID_CLASSES = {"equity", "bond", "leveraged", "stock"}
VALID_DRIFT_MODES = {"off", "up_only", "both"}
VALID_TREND_FILTER_MODES = {"off", "pause", "widen"}


class ConfigError(Exception):
    """設定檔有問題時拋出。"""


#: 台股 ETF 代碼字尾對應的網格資產類別（00679B 債券 ETF、00631L 槓桿、00632R 反向）
_TW_ETF_SUFFIX_CLASS = {"B": "bond", "L": "leveraged", "R": "leveraged"}


def infer_asset_class(code: str, name: str, market: str) -> str:
    """Best-effort 網格資產類別（equity/bond/leveraged/stock），給「使用者剛在投資組合
    勾選 ATR」這種沒有地方問類別的情況用。投資組合的勾選欄位問不到類別，但網格參數
    是分類別的，所以先照台股命名慣例猜，再讓使用者在網格頁的「持股狀態」分頁改
    （PUT /grid/positions/{code} 的 assetClass）。"""
    if market == "us":
        return "stock"
    if any(k in name for k in ("正2", "正二", "反1", "反一", "槓桿")):
        return "leveraged"
    if code.startswith("00"):
        suffix = _TW_ETF_SUFFIX_CLASS.get(code[-1:].upper())
        if suffix:
            return suffix
        return "bond" if "債" in name else "equity"
    return "stock"


@dataclass(frozen=True)
class GridParams:
    """單一資產類別（或單一標的覆寫）的網格參數。"""

    atr_period: int = 14
    #: 網格步長 = k * ATR
    atr_multiplier: float = 0.5
    #: 步長下限（占價格百分比），用來確保覆蓋來回交易成本
    min_step_pct: float = 0.8
    #: 步長上限（占價格百分比），避免極端波動時網格拉到永遠不觸發
    max_step_pct: float = 6.0
    #: 相對建檔股數，最多往下加碼幾份
    max_buy_rungs: int = 5
    #: 相對建檔股數，最多往上減碼幾份
    max_sell_rungs: int = 5
    #: 單日最多成交幾份（單邊）
    max_rungs_per_day: int = 2
    #: 當日相對前收的跳空超過 N 倍 ATR 就轉人工複核
    gap_atr_limit: float = 3.0
    #: 錨點漂移模式：off / up_only / both
    drift_mode: str = "up_only"
    #: 錨點每日往趨勢均線靠攏的比例
    drift_beta: float = 0.02
    #: 漂移參考的均線長度
    trend_ema_period: int = 60
    #: 是否允許虧損賣出（網格獲利了結預設不允許）
    allow_loss_sell: bool = False

    # ------------------------------------------------------- 單邊行情防護
    # 以下四組參數預設全部關閉，行為與加入它們之前完全一致 —— 純網格在盤整
    # 區間是最好的，這些只在「單邊走勢把網格打穿」時才該打開。
    #: 趨勢濾網模式：off（不啟用）/ pause（順勢方向暫停逆勢單）/
    #: widen（逆勢方向的步長乘上 trend_step_multiple）
    trend_filter_mode: str = "off"
    #: 趨勢判斷用的收盤價均線長度
    trend_ma_period: int = 20
    #: RSI 期數與超買門檻；現價 > MA 且 RSI > 門檻 ⇒ 強勢多頭（賣出受抑制）
    rsi_period: int = 14
    rsi_overbought: float = 70.0
    #: MACD 期數；現價 < MA 且 DIF < 0 ⇒ 強勢空頭（買進受抑制）
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    #: widen 模式下，逆勢方向的步長倍數
    trend_step_multiple: float = 2.0
    #: 底倉比例。建檔股數（baseline_shares）的這個比例永遠不參與網格賣出，
    #: 單邊大漲賣飛時仍留有部位吃到趨勢。0 表示不保留底倉。
    base_position_pct: float = 0.0
    #: 連續幾天站上網格上緣就把整個區間上移（trailing grid）。0 表示關閉。
    range_reset_days: int = 0
    #: 每階股數 = baseline_shares（建檔股數）× 這個比例，以「手續費 1 元上限」
    #: 的股數（fee-optimal lot）為下限——不會因為這個比例算出更少股數而縮水。
    #: 0 表示關閉，一階固定是 fee-optimal lot（跟這個參數加入前的行為完全一樣）。
    #: 這是讓「一份」跟部位大小掛鉤：固定 fee-optimal lot 對大部位太小（滿檔
    #: 幾階只動到部位的一小部分），對小部位太大（幾階就把整個部位賣光）。
    rung_pct_of_baseline: float = 0.0
    #: 不對稱步長：賣出步長恆定是買進步長（ATR 決定的 base_step）的這個倍數，
    #: 不像 trend_filter_mode 的 widen 只在判定為逆勢時才放大——這個是永久生效
    #: 的。目的一樣是「讓利潤奔跑」：單邊上漲時賣出格子拉開，賣得慢一點，籌碼
    #: 才不會太早賣光；買進步長不受影響，接刀節奏不變。1.0（預設）表示關閉，
    #: 跟加入這個參數之前完全一樣（買賣步長對稱）。
    sell_step_multiple: float = 1.0

    def validate(self, label: str) -> None:
        if self.atr_period < 2:
            raise ConfigError(f"{label}: atr_period 必須 >= 2")
        if self.atr_multiplier <= 0:
            raise ConfigError(f"{label}: atr_multiplier 必須 > 0")
        if self.min_step_pct <= 0:
            raise ConfigError(f"{label}: min_step_pct 必須 > 0")
        if self.max_step_pct <= self.min_step_pct:
            raise ConfigError(f"{label}: max_step_pct 必須 > min_step_pct")
        if self.max_buy_rungs < 0 or self.max_sell_rungs < 0:
            raise ConfigError(f"{label}: 階數上限不可為負")
        if self.max_rungs_per_day < 1:
            raise ConfigError(f"{label}: max_rungs_per_day 必須 >= 1")
        if self.drift_mode not in VALID_DRIFT_MODES:
            raise ConfigError(
                f"{label}: drift_mode 必須是 {sorted(VALID_DRIFT_MODES)} 之一"
            )
        if not 0.0 <= self.drift_beta <= 1.0:
            raise ConfigError(f"{label}: drift_beta 必須介於 0 與 1")
        if self.trend_ema_period < 2:
            raise ConfigError(f"{label}: trend_ema_period 必須 >= 2")
        if self.trend_filter_mode not in VALID_TREND_FILTER_MODES:
            raise ConfigError(
                f"{label}: trend_filter_mode 必須是 "
                f"{sorted(VALID_TREND_FILTER_MODES)} 之一"
            )
        if self.trend_ma_period < 2:
            raise ConfigError(f"{label}: trend_ma_period 必須 >= 2")
        if self.rsi_period < 2:
            raise ConfigError(f"{label}: rsi_period 必須 >= 2")
        if not 0.0 < self.rsi_overbought <= 100.0:
            raise ConfigError(f"{label}: rsi_overbought 必須介於 0 與 100")
        if self.macd_fast < 1 or self.macd_signal < 1:
            raise ConfigError(f"{label}: macd_fast / macd_signal 必須 >= 1")
        if self.macd_slow <= self.macd_fast:
            raise ConfigError(f"{label}: macd_slow 必須大於 macd_fast")
        if self.trend_step_multiple < 1.0:
            raise ConfigError(f"{label}: trend_step_multiple 必須 >= 1")
        if not 0.0 <= self.base_position_pct < 1.0:
            raise ConfigError(
                f"{label}: base_position_pct 必須介於 0 與 1（不含 1，"
                f"底倉 100% 等於整檔停止網格）"
            )
        if self.range_reset_days < 0:
            raise ConfigError(f"{label}: range_reset_days 不可為負")
        if not 0.0 <= self.rung_pct_of_baseline < 1.0:
            raise ConfigError(
                f"{label}: rung_pct_of_baseline 必須介於 0 與 1（不含 1，"
                f"單階 100% 等於一次動用整個建檔部位）"
            )
        if self.sell_step_multiple < 1.0:
            raise ConfigError(f"{label}: sell_step_multiple 必須 >= 1（賣出步長不會比買進窄）")

    def merged(self, overrides: dict[str, Any] | None) -> "GridParams":
        if not overrides:
            return self
        known = {f for f in self.__dataclass_fields__}
        unknown = set(overrides) - known
        if unknown:
            raise ConfigError(f"未知的網格參數：{sorted(unknown)}")
        return replace(self, **overrides)


@dataclass(frozen=True)
class Settings:
    """全域設定。"""

    fee_discount: Decimal = Decimal("0.28")
    fee_minimum: int = 1
    #: 可動用現金（新台幣）。買進會扣減，賣出會回補 —— 只給台股持倉用。
    #: 已經扣掉 T+2 未交割買單（見 cash_pending），不然帳戶餘額還沒被
    #: 實際扣款、看起來比真正能動用的多。
    cash: float = 0.0
    #: cash 已經扣掉的未交割買單金額，只為了讓 /grid/advice 能把這筆扣減
    #: 攤在檯面上顯示，不影響任何計算。
    cash_pending: float = 0.0
    #: 現金水位低於此金額就停止買進（新台幣）
    cash_floor: float = 0.0
    #: 可動用現金（美元）。美股持倉（Holding.market == "us"）走這一包，
    #: 跟台股的 `cash` 完全分開，避免拿新台幣餘額去比美元成交金額。
    #: 同樣已扣掉未交割買單，見 us_cash_pending。
    us_cash: float = 0.0
    us_cash_pending: float = 0.0
    #: 美股現金水位下限（美元）
    us_cash_floor: float = 0.0
    #: 建議產生的時間（僅用於報表顯示）
    decision_time: str = "13:00"
    timezone: str = "Asia/Taipei"
    #: 日 K 資料超過幾天沒更新就視為過期
    max_data_staleness_days: int = 5
    #: 步長至少要是來回成本的幾倍，否則設定檢查會擋下
    min_step_cost_multiple: float = 3.0
    defaults: dict[str, GridParams] = field(default_factory=dict)

    def params_for(self, asset_class: str) -> GridParams:
        if asset_class not in self.defaults:
            raise ConfigError(f"settings.yaml 缺少資產類別 '{asset_class}' 的預設參數")
        return self.defaults[asset_class]


@dataclass(frozen=True)
class Holding:
    """一檔持股。"""

    ticker: str
    name: str
    asset_class: str
    shares: int
    avg_cost: float
    #: 'tw' 或 'us'。決定 ATR/報價的計價幣別，以及是否套用台股手續費與證交稅
    #: （美股走零手續費券商，一律不收費、不課台股證交稅 —— 見 grid/fees.py）。
    market: str = "tw"
    #: 代號是否已對照交易所資料驗證過。未驗證者不會產生下單建議。
    ticker_verified: bool = False
    enabled: bool = True
    overrides: dict[str, Any] = field(default_factory=dict)
    #: 手動登記的除息，格式 [{"date": "2026-07-16", "amount": 0.35}]
    ex_dividends: list[dict[str, Any]] = field(default_factory=list)
    #: 建檔基準日（YYYY-MM-DD）。錨點是從這天的市價開始算的，這天（含）以前
    #: 發生的除息早就反映在那個市價裡了，不該再登記／再扣一次；掃描除息時
    #: 只該列出這天之後的新事件。``None`` 表示沒登記，不做任何過濾（相容
    #: 舊資料）。
    tracked_since: str | None = None

    def validate(self) -> None:
        if self.market not in ("tw", "us"):
            raise ConfigError(f"{self.ticker}: market 必須是 'tw' 或 'us'，收到 {self.market!r}")
        if self.asset_class not in VALID_CLASSES:
            raise ConfigError(
                f"{self.ticker}: asset_class '{self.asset_class}' 無效，"
                f"必須是 {sorted(VALID_CLASSES)} 之一"
            )
        if self.shares < 0:
            raise ConfigError(f"{self.ticker}: shares 不可為負")
        if self.avg_cost <= 0:
            raise ConfigError(f"{self.ticker}: avg_cost 必須 > 0")
        for entry in self.ex_dividends:
            if "date" not in entry or "amount" not in entry:
                raise ConfigError(
                    f"{self.ticker}: ex_dividends 每筆都需要 date 與 amount"
                )
        if self.tracked_since is not None:
            try:
                _date.fromisoformat(self.tracked_since)
            except ValueError as exc:
                raise ConfigError(
                    f"{self.ticker}: tracked_since 日期格式錯誤，需要 YYYY-MM-DD："
                    f"{self.tracked_since}"
                ) from exc


def resolve_params(settings: Settings, holding: Holding) -> GridParams:
    """把類別預設值與個股覆寫合併成最終參數。"""
    params = settings.params_for(holding.asset_class).merged(holding.overrides)
    params.validate(holding.ticker)
    return params
