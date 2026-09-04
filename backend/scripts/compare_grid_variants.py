"""比較「純網格 / B1 單階佔部位比例 / C1 不對稱步長 / B1+C1」在你實際持有的
網格標的歷史 K 線上跑起來長什麼樣子——這是 review 建議清單裡 C 組（策略）在
上線前該做的驗證，不是預測未來報酬，是檢查「開了會不會比較好、成交會不會
變太少或太多、成本吃掉多少」。

Run 從 `backend/`：
    python scripts/compare_grid_variants.py                # 掃描所有啟用中的網格標的
    python scripts/compare_grid_variants.py 0052 00757      # 只看指定幾檔

B1/C1 目前預設都是關閉（見 grid/config.py 的 rung_pct_of_baseline /
sell_step_multiple），「純網格」那一列就是現在線上實際在用的行為，其他三列
是「如果開了會怎樣」的對照，不會寫回資料庫、不影響任何線上設定。

資料來源是 routers/ohlc.py（Yahoo，FinMind 為備援），跟 /grid/advice 用的
一樣；yfinance 固定抓半年線，warmup（通常 60~70 根，取決於 ATR/EMA60 週期）
會吃掉前段，可比較的天數大約只剩 4 個月左右——看個大概方向即可，數字不必
太當真，也是這個腳本沒有實作自訂日期區間的原因。
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import get_db
from grid.adapter import AdapterError, build_context
from grid.backtest import compare_summary, compare_variants
from grid.indicators import Bar
from routers.ohlc import get_ohlc


def _bars_for(code: str, market: str) -> list[Bar]:
    today = date.today().isoformat()
    raw = get_ohlc(code, days=400, market=market)
    return [
        Bar(date=r["date"], open=r["open"], high=r["high"], low=r["low"],
            close=r["close"], volume=r.get("volume", 0))
        for r in raw
        if r["date"] < today  # 跟正式流程一致：不讓今天還沒收的 K 棒進 ATR
    ]


def main(codes: list[str] | None) -> None:
    with get_db() as conn:
        try:
            ctx = build_context(conn, codes)
        except AdapterError as exc:
            print(f"讀取網格設定失敗：{exc}")
            return

    if not ctx.holdings:
        print("沒有啟用中的網格標的可比較。")
        return

    for code, holding in sorted(ctx.holdings.items()):
        try:
            bars = _bars_for(code, holding.market)
            results = compare_variants(holding, bars, ctx.settings)
        except ValueError as exc:
            print(f"\n=== {code} {holding.name} ===\n資料不足，略過（{exc}）")
            continue
        except Exception as exc:  # noqa: BLE001 - 一檔抓不到報價不該讓整批中斷
            print(f"\n=== {code} {holding.name} ===\n略過（{exc}）")
            continue
        print(f"\n=== {code} {holding.name}（{holding.asset_class}） ===")
        print(compare_summary(results))


if __name__ == "__main__":
    main(sys.argv[1:] or None)
