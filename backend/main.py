import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from routers import notes, signals, trades, sources, stocks, tracked, quotes, brokers, accounts, liabilities, ohlc, chips, linebot, account_transactions, dividends, funds, credit_cards, net_worth, asset_classes

logger = logging.getLogger(__name__)


def _scheduled_stock_list_sync():
    """Daily job: refresh stock names/industries from FinMind."""
    try:
        from routers.stocks import _sync_stock_list
        result = _sync_stock_list()
        logger.info("排程：股票清單更新完成，共 %d 支", len(result))
    except Exception as e:
        logger.error("排程：股票清單更新失敗: %s", e)


def _scheduled_line_alerts():
    """Daily job: push account/liability alerts to LINE subscribers."""
    try:
        from routers.linebot import check_and_push_alerts
        check_and_push_alerts()
    except Exception as e:
        logger.error("排程：LINE 提醒推播失敗: %s", e)


def _scheduled_net_worth_snapshot():
    """Daily job: capture asset/liability snapshot at 23:58."""
    from routers.net_worth import take_daily_snapshot
    take_daily_snapshot()


def _scheduled_process_due_payments():
    """Daily job: auto-deduct loan/credit-card payments on reminder day."""
    from routers.liabilities import process_due_payments
    process_due_payments()


def _scheduled_process_fund_deductions():
    """Daily job: increase fund cost basis by the deduction amount on the fund's deduction day."""
    try:
        from routers.funds import process_fund_deductions
        process_fund_deductions()
    except Exception as e:
        logger.error("排程：基金扣款處理失敗: %s", e)


def _scheduled_process_due_settlements():
    """Daily job: auto-deduct T+2 stock settlement payments on settlement day."""
    try:
        from routers.trades import process_due_settlements
        process_due_settlements()
    except Exception as e:
        logger.error("排程：股票交割扣款失敗: %s", e)


def _scheduled_stop_loss_check():
    """Weekday 13:00 job: check stop-loss prices and push LINE alerts."""
    try:
        from routers.linebot import check_stop_loss_alerts
        check_stop_loss_alerts()
    except Exception as e:
        logger.error("排程：停損推播失敗: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from routers.trades import fix_unsettled_trades
    fix_unsettled_trades()
    scheduler = BackgroundScheduler(timezone="Asia/Taipei")
    # Daily at 18:30 Taiwan time (after market data is available)
    scheduler.add_job(
        _scheduled_stock_list_sync,
        CronTrigger(hour=18, minute=30, timezone="Asia/Taipei"),
        id="stock_list_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_line_alerts,
        CronTrigger(hour=17, minute=0, timezone="Asia/Taipei"),
        id="line_alerts_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_net_worth_snapshot,
        CronTrigger(hour=23, minute=58, timezone="Asia/Taipei"),
        id="net_worth_snapshot_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_process_due_payments,
        CronTrigger(hour=9, minute=0, timezone="Asia/Taipei"),
        id="process_due_payments_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_process_fund_deductions,
        CronTrigger(hour=9, minute=0, timezone="Asia/Taipei"),
        id="process_fund_deductions_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_process_due_settlements,
        CronTrigger(hour=9, minute=5, timezone="Asia/Taipei"),
        id="process_due_settlements_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_stop_loss_check,
        CronTrigger(hour=13, minute=0, day_of_week="mon-fri", timezone="Asia/Taipei"),
        id="stop_loss_check_daily",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("排程器已啟動（股票清單 18:30、LINE 提醒 17:00、自動扣款 09:00、基金扣款 09:00、股票交割 09:05、淨資產快照 23:58、停損檢查 13:00 平日）")
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="WatchList API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes.router,       prefix="/api")
app.include_router(signals.router,     prefix="/api")
app.include_router(trades.router,      prefix="/api")
app.include_router(sources.router,     prefix="/api")
app.include_router(stocks.router,      prefix="/api")
app.include_router(tracked.router,     prefix="/api")
app.include_router(quotes.router,      prefix="/api")
app.include_router(brokers.router,     prefix="/api")
app.include_router(accounts.router,    prefix="/api")
app.include_router(liabilities.router, prefix="/api")
app.include_router(ohlc.router,        prefix="/api")
app.include_router(chips.router,               prefix="/api")
app.include_router(account_transactions.router, prefix="/api")
app.include_router(dividends.router,           prefix="/api")
app.include_router(linebot.router,             prefix="/api")
app.include_router(funds.router,               prefix="/api")
app.include_router(credit_cards.router,        prefix="/api")
app.include_router(net_worth.router,           prefix="/api")
app.include_router(asset_classes.router,       prefix="/api")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static", "browser")
INDEX_HTML  = os.path.join(STATIC_DIR, "index.html")

if os.path.isdir(STATIC_DIR):
    app.mount("/static-files", StaticFiles(directory=STATIC_DIR), name="static_files")


@app.get("/api/ping", include_in_schema=False)
def ping():
    """Keep-alive endpoint for external cron jobs (does NOT trigger any alerts)."""
    return {"status": "ok"}


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    candidate = os.path.join(STATIC_DIR, full_path)
    if os.path.isfile(candidate):
        return FileResponse(candidate)
    if os.path.isfile(INDEX_HTML):
        return FileResponse(INDEX_HTML)
    return {"error": "Angular build not found. Run: cd frontend && ng build"}
