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


class ConfigError(Exception):
    """設定檔有問題時拋出。"""


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
    #: 可動用現金（元）。買進會扣減，賣出會回補。
    cash: float = 0.0
    #: 現金水位低於此金額就停止買進
    cash_floor: float = 0.0
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
