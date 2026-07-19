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
from routers import notes, signals, trades, sources, stocks, tracked, quotes, brokers, accounts, liabilities, ohlc, chips, linebot, account_transactions, dividends, funds, credit_cards, net_worth, asset_classes, tranches

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
    """Daily job: capture asset/liability snapshot at 23:58, then check
    drawdown / new-high alerts on the fresh data."""
    from routers.net_worth import take_daily_snapshot
    take_daily_snapshot()
    try:
        from push_alerts import check_net_worth_alerts
        check_net_worth_alerts()
    except Exception as e:
        logger.error("排程：淨資產警示失敗: %s", e)


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


def _scheduled_price_alerts():
    """Weekday 13:00 job: stop-loss / take-profit / tranche-trigger LINE alerts."""
    try:
        from push_alerts import check_price_alerts
        check_price_alerts()
    except Exception as e:
        logger.error("排程：價格警示推播失敗: %s", e)


def _scheduled_drop_alerts():
    """Weekday 14:30 job: alert on holdings with a large single-day drop."""
    try:
        from push_alerts import check_daily_drop_alerts
        check_daily_drop_alerts()
    except Exception as e:
        logger.error("排程：重挫警示推播失敗: %s", e)


def _scheduled_chip_alerts():
    """Weekday 19:00 job: institutional streak / margin usage alerts."""
    try:
        from push_alerts import check_chip_alerts
        check_chip_alerts()
    except Exception as e:
        logger.error("排程：籌碼警示推播失敗: %s", e)


def _scheduled_no_sl_reminder():
    """Monday 09:00 job: remind about holdings without a stop-loss."""
    try:
        from push_alerts import check_no_stop_loss_reminder
        check_no_stop_loss_reminder()
    except Exception as e:
        logger.error("排程：停損檢查提醒失敗: %s", e)


def _scheduled_weekly_report():
    """Sunday 20:00 job: weekly portfolio report."""
    try:
        from push_alerts import send_weekly_report
        send_weekly_report()
    except Exception as e:
        logger.error("排程：週報推播失敗: %s", e)


def _scheduled_monthly_report():
    """1st of month 09:30 job: previous-month summary report."""
    try:
        from push_alerts import send_monthly_report
        send_monthly_report()
    except Exception as e:
        logger.error("排程：月報推播失敗: %s", e)


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
        _scheduled_price_alerts,
        CronTrigger(hour=13, minute=0, day_of_week="mon-fri", timezone="Asia/Taipei"),
        id="price_alerts_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_drop_alerts,
        CronTrigger(hour=14, minute=30, day_of_week="mon-fri", timezone="Asia/Taipei"),
        id="drop_alerts_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_chip_alerts,
        CronTrigger(hour=19, minute=0, day_of_week="mon-fri", timezone="Asia/Taipei"),
        id="chip_alerts_daily",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_no_sl_reminder,
        CronTrigger(hour=9, minute=0, day_of_week="mon", timezone="Asia/Taipei"),
        id="no_sl_reminder_weekly",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_weekly_report,
        CronTrigger(hour=20, minute=0, day_of_week="sun", timezone="Asia/Taipei"),
        id="weekly_report",
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_monthly_report,
        CronTrigger(day=1, hour=9, minute=30, timezone="Asia/Taipei"),
        id="monthly_report",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "排程器已啟動（股票清單 18:30、LINE 彙整 17:00、自動扣款 09:00、基金扣款 09:00、"
        "股票交割 09:05、淨資產快照+警示 23:58、價格警示 13:00、重挫警示 14:30、"
        "籌碼警示 19:00 平日、停損檢查提醒 週一 09:00、週報 週日 20:00、月報 每月1日 09:30）"
    )
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
app.include_router(tranches.router,            prefix="/api")

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
