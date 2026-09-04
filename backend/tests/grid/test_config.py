"""infer_asset_class() 的分類規則。

投資組合的 ATR 勾選欄位沒有地方問資產類別，但網格參數是分類別的，
所以勾選時由這個函式猜一個，使用者可再到網格頁的「持股狀態」改。
"""
import pytest

from grid.config import (
    VALID_CLASSES,
    ConfigError,
    GridParams,
    infer_asset_class,
)


@pytest.mark.parametrize("code,name,expected", [
    ("00679B", "元大美債20年", "bond"),        # 台股債券 ETF 代碼字尾 B
    ("00687B", "", "bond"),                    # 沒抓到名稱也認得出來
    ("00937B", "群益ESG投等債20+", "bond"),
    ("00631L", "元大台灣50正2", "leveraged"),  # 字尾 L
    ("00632R", "元大台灣50反1", "leveraged"),  # 字尾 R
    ("0050", "元大台灣50", "equity"),
    ("00878", "國泰永續高股息", "equity"),
    ("2330", "台積電", "stock"),
    ("6488", "環球晶", "stock"),
])
def test_tw_codes(code, name, expected):
    assert infer_asset_class(code, name, "tw") == expected


def test_name_wins_when_code_has_no_suffix():
    assert infer_asset_class("00864", "某某債券基金", "tw") == "bond"


def test_leveraged_name_beats_etf_code():
    assert infer_asset_class("00675L", "富邦台灣加權正2", "tw") == "leveraged"


def test_us_is_always_stock():
    # 美股沒有台股那套代碼慣例，一律給 stock，讓使用者自己改。
    assert infer_asset_class("TLT", "iShares 20+ Year Treasury", "us") == "stock"


def test_always_returns_a_valid_class():
    for args in [("0050", "", "tw"), ("2330", "", "tw"), ("00679B", "", "tw"), ("SPY", "", "us")]:
        assert infer_asset_class(*args) in VALID_CLASSES


# ------------------------------------------------- 單邊行情防護參數的驗證


def test_defaults_keep_the_new_gates_off():
    params = GridParams()
    assert params.trend_filter_mode == "off"
    assert params.base_position_pct == 0.0
    assert params.range_reset_days == 0


def test_rejects_unknown_trend_filter_mode():
    with pytest.raises(ConfigError, match="trend_filter_mode"):
        GridParams(trend_filter_mode="maybe").validate("test")


def test_rejects_base_position_of_100_percent():
    with pytest.raises(ConfigError, match="base_position_pct"):
        GridParams(base_position_pct=1.0).validate("test")


def test_rejects_step_multiple_below_one():
    with pytest.raises(ConfigError, match="trend_step_multiple"):
        GridParams(trend_step_multiple=0.5).validate("test")


def test_rejects_macd_slow_not_longer_than_fast():
    with pytest.raises(ConfigError, match="macd_slow"):
        GridParams(macd_fast=26, macd_slow=12).validate("test")


def test_accepts_a_full_single_sided_protection_setup():
    GridParams(
        trend_filter_mode="widen",
        trend_step_multiple=2.0,
        base_position_pct=0.4,
        range_reset_days=3,
    ).validate("test")
