# 理債富

**財務暨投資管理平台**

整合台股研究筆記、訊號管理、交易紀錄、資產負債與籌碼分析的全端應用程式。

---

## 功能

| 分類 | 功能 |
|------|------|
| **筆記** | 多本研究筆記、股票條目管理、CSV 匯入 |
| **研究** | 個股索引搜尋、訊號總覽（進場/出場/觀察）|
| **持倉** | 投資組合損益（FIFO）、鎖定觀察清單、K 線圖 + MA |
| **財務** | 帳戶餘額（含 T+2 交割預扣）、資產負債表、貸款明細追蹤 |
| **籌碼** | 三大法人買賣超（連買/連賣統計）、融資融券餘額 |
| **同步** | FinMind 收盤價 + 籌碼資料排程自動更新 |

---

## 技術架構

```
backend/          FastAPI + psycopg2 (PostgreSQL)
frontend/         Angular 21 standalone components
```

- **狀態管理**：Angular Signals
- **排程**：APScheduler（每日 18:30 更新股票清單）
- **資料來源**：[FinMind](https://finmindtrade.com/)（台股）、yfinance（即時報價）

---

## 本地開發

**後端**

```bash
cd backend
pip install -r requirements.txt
python ../run.py          # http://localhost:8000
```

**前端**

```bash
cd frontend
pnpm install
pnpm ng serve             # http://localhost:4200（代理 /api 至 :8000）
```

**建置前端（產生靜態檔）**

```bash
cd frontend
pnpm ng build             # 輸出至 backend/static/browser/
```

---

## 環境變數

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 連線字串（需支援 SSL） |

在 `backend/.env` 設定：

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

---

## 部署（Render）

專案包含 `render.yaml`，直接連結 GitHub repo 即可部署：

1. 在 Render 建立 PostgreSQL 資料庫，取得 `DATABASE_URL`
2. 建立 Web Service，設定環境變數 `DATABASE_URL`
3. Build command / Start command 已定義於 `render.yaml`

---

## 資料庫初始化

首次啟動時 `init_db()` 會自動建立所有資料表並執行 migration，無需手動操作。

如需從舊版 localStorage 匯入資料：

```bash
python migrate_localstorage.py export.json
```
