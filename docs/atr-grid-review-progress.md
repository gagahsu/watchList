# ATR 網格 review 進度記錄

依你提出的修改清單（記帳正確性 A → 網格結構 B → 策略 C），逐項查證後在
`claude/atr-grid-trading-improvements-ee0v4y` 分支上實作。這份文件記錄目前
做到哪、還缺什麼、以及你自己要做的後續動作。

## 已完成

| | 內容 | Commit |
|---|---|---|
| A1 | 券商加 `account_id`，LINE bot 記帳（手打指令、成交回報表格）自動帶入交割帳戶；`process_due_settlements()` 補上對過期未交割單的追趕（`<= today` 取代 `== today`） | `9e5a0c0` |
| A2 | `_calc_fee()` 拆成手續費／證交稅分開計算，稅改用 `grid/fees.py` 的稅率表（修正債券 ETF 被誤課 0.1% 的問題），美股手續費歸零；成交回報表格匯入改兩階段查詢避免逐列開連線 | `8b9291a` |
| A3+A4 | `build_settings()` 扣除該帳戶 T+2 未交割買單金額；`/grid/advice` 新增現金水位檢查與超支警告（純顯示，不動決策） | `6af2a76` |
| B1 | `GridParams.rung_pct_of_baseline`（預設 0＝關閉）：單階股數可設為建檔股數的比例，以 fee-optimal lot 為下限；`/grid/positions` 與網格參數頁同步更新 | `a174648` |
| C1 | `GridParams.sell_step_multiple`（預設 1.0＝關閉）：賣出步長恆定放大，不靠落後指標判斷 regime；`grid/backtest.py` 新增 `compare_variants()`/`compare_summary()` 與 `scripts/compare_grid_variants.py` 供實機回測比較「純網格／B1／C1／B1+C1」 | `4bb630d` |

所有變更皆維持預設值＝關閉／既有行為不變，188 個後端測試全數通過（每次改動後都跑過）。

## 你需要自己做的事（我這邊做不到）

- **昨天那五筆約 NT$29,431 的舊資料不會自動修好**（A1/A2 只修程式，不動歷史資料）：到個股詳情的交易分頁，把那幾筆買單的交割帳戶手動補上，補上後下次排程（09:05）會自動追上補扣。
- **這個容器沒有 `DATABASE_URL`**，連不上正式資料庫，也就無法：
  - 查證你實際啟用網格的是哪幾檔、`brokers` 表的折數是否跟 `settings.grid_fee_discount` 一致、有多少歷史資料受 A1/A2 影響（原本 review 列出但一直沒能確認的三件事，依然沒能確認）
  - 對你真正的 19 檔標的跑 `scripts/compare_grid_variants.py` 產生實際的回測對照表——這需要你在能連 DB 的環境（本機或正式伺服器）自己執行：
    ```
    cd backend
    python scripts/compare_grid_variants.py          # 掃描所有啟用中的標的
    python scripts/compare_grid_variants.py 2891 00757  # 只看指定幾檔
    ```

## 順帶發現、尚未處理的問題

1. 手續費折數其實有三份不是兩份：`brokers.discount`、`settings.grid_fee_discount`，還有前端 `app-state.service.ts` 的 localStorage `fee_discount`（預設 0.6，跟國泰的 0.28 差很多），被 `portfolio-view.component.ts` 拿去算持股成本。B2（券商完全沒被記錄）真正收斂時要三份一起處理。
2. 前端 `calcFIFO()` 對所有標的一律用 0.3% 證交稅（`fifo.py` docstring 自己承認），就算後端全修好，債券 ETF／股票型 ETF 的已實現損益在畫面上仍然是錯的。

## 尚未進行

- **B2**（券商從未被網格讀取）、**B3**（每檔獨立資金預算）：等你看過上面兩個折數/稅率不一致的問題想清楚要怎麼收斂，再排時程。
- **C2/C3/C4**（底倉、區間上移、趨勢濾網）：已是既有功能，預設關閉。
- **C5**（除息前不賣）、**C6**（網格標的數量）：C5 待你確認要不要做；C6 待你用 `compare_grid_variants.py` 或「持股狀態」分頁告訴我實際啟用哪幾檔。
- **C7**（動態步長）：已經是動態的，00757 的 1.00% 是 `min_step_pct` 下限在綁，純調參不用寫程式。

## 分支與提交

- 分支：`claude/atr-grid-trading-improvements-ee0v4y`
- 尚未開 PR（未被要求）；截至目前為止的提交都已推到遠端同名分支。
