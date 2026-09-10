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
| 順帶問題 #1 | 手續費折數三份不同步：`build_settings()` 改成優先讀取連到網格現金帳戶的那個券商（`brokers.account_id`）的 discount/min_fee，改國泰折數會直接反映到網格試算；沒連結時退回原本的 `grid_fee_discount` 設定 | `ab02385` |
| 順帶問題 #2 | 非網格標的證交稅算錯：新增 `grid/adapter.py::asset_classes_for()`，grid-tracked 用 `grid_positions.asset_class`、其餘用 `infer_asset_class()` 推斷，取代 `fifo.py`/`push_alerts.py`/`GET /grid/asset-classes` 三處原本只查 grid_positions 的寫法；前端不用改任何一行就自動吃到正確稅率 | `ab02385` |
| LINE 網格記帳 | 新增「網格買/網格賣」LINE 指令：用回報價格現場試算 rungs/step（跟 `/grid/preview` 同路徑），方向不一致就拒絕、股數不一致只警告仍照實際股數記錄；走跟網頁版 `/grid/record` 相同路徑，`sig_ref='grid'`，可與一般買賣分開。順手修 `commit_fill()` 一個既有小 bug（`rung_after` 從未真正寫回，一直回傳 0） | `15aa902` |
| B2 | `trades` 加 `broker_id`，LINE 記帳（含網格買/賣）與網頁版 `/grid/record` 都寫入；前端交易分頁原本就有券商下拉選單，之前只拿來算手續費、選完即丟，這次補上讓選擇真的存進交易記錄 | `af34095` |
| B3 | `Holding.budget_pct`（0~1，預設 0＝不限制）：每檔網格最多可動用「可用現金 × 比例」，超過在 `_limit_buy` 直接擋單（硬性，不是 A3 那種只警告）。新增 `grid_net_spent()` 從 trades 現算這檔網格自己已花掉多少錢；`grid_positions` 加 `budget_pct` 欄位，「持股狀態」分頁可直接編輯、顯示已用/總預算 | `af34095` |

所有變更皆維持預設值＝關閉／既有行為不變，215 個後端測試全數通過（每次改動後都跑過）。

## 你需要自己做的事（我這邊做不到）

- **昨天那五筆約 NT$29,431 的舊資料不會自動修好**（A1/A2 只修程式，不動歷史資料）：到個股詳情的交易分頁，把那幾筆買單的交割帳戶手動補上，補上後下次排程（09:05）會自動追上補扣。
- **LINE 網格記帳的新指令**：`網格買 代碼 股數 價格 [日期]` / `網格賣 代碼 股數 價格 [日期]`（傳「幫助」看完整說明）。只能記已啟用網格的代碼；跟一般 `買/賣` 指令不同，不用也不能指定券商——手續費折數固定跟著網格現金帳戶連結的那個券商。
- **每檔資金預算（B3）要自己去網格頁「持股狀態」分頁設定**：每一列現在多一欄「資金預算」，預設「未限制」（跟現在完全一樣），點一下可以設成佔可用現金的百分比，超過就會直接擋下該檔的買進建議（不是警告）。
- **這個容器沒有 `DATABASE_URL`**，連不上正式資料庫，也就無法：
  - 查證你實際啟用網格的是哪幾檔、`brokers` 表的折數是否跟 `settings.grid_fee_discount` 一致、有多少歷史資料受 A1/A2 影響（原本 review 列出但一直沒能確認的三件事，依然沒能確認）
  - 對你真正的 19 檔標的跑 `scripts/compare_grid_variants.py` 產生實際的回測對照表——這需要你在能連 DB 的環境（本機或正式伺服器）自己執行：
    ```
    cd backend
    python scripts/compare_grid_variants.py          # 掃描所有啟用中的標的
    python scripts/compare_grid_variants.py 2891 00757  # 只看指定幾檔
    ```

## 順帶發現、已處理／尚未處理的問題

1. ~~手續費折數三份不同步~~ → **已處理**（見上表「順帶問題 #1」）。但前端 `app-state.service.ts` 的 localStorage `fee_discount`（預設 0.6）仍是獨立的第三份，只用在 `portfolio-view.component.ts` 的「賣出試算」估計值，跟券商無關，刻意沒動——B2（券商完全沒被記錄）真正收斂時再一起考慮要不要讓它也跟真實券商連動。
2. ~~前端 `calcFIFO()` 對非網格標的證交稅算錯~~ → **已處理**（見上表「順帶問題 #2」），現在涵蓋所有交易過的標的，不只網格標的。

## 尚未進行

- 前端 localStorage 那第三份 `fee_discount`（賣出試算用，跟真實券商無關）仍未收斂，B2 有意保留現狀。
- **C2/C3/C4**（底倉、區間上移、趨勢濾網）：已是既有功能，預設關閉。
- **C5**（除息前不賣）、**C6**（網格標的數量）：C5 待你確認要不要做；C6 已就你貼的 15 檔給過具體分析（2891/2887 太小、00878 等 4 檔債券/高股息 ETF 太大、科技與債券兩組重疊度偏高），要不要動、動哪幾檔還沒決定。
- **C7**（動態步長）：已經是動態的，00757 的 1.00% 是 `min_step_pct` 下限在綁，純調參不用寫程式。

## 分支與提交

- 分支：`claude/atr-grid-trading-improvements-ee0v4y`
- 尚未開 PR（未被要求）；截至目前為止的提交都已推到遠端同名分支。
