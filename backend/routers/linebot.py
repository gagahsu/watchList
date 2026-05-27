"""
LINE Bot integration: webhook subscriber registration + daily alert push.

Environment variables required:
  LINE_CHANNEL_SECRET          – Channel Secret from LINE Developers Console
  LINE_CHANNEL_ACCESS_TOKEN    – Channel Access Token

Subscribers are stored in the `settings` table under key "line_subscribers"
as a JSON array of LINE user IDs.
"""
import base64
import calendar
import hashlib
import hmac
import json
import logging
import os
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Header, HTTPException, Request

from database import get_db, get_setting, set_setting

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/linebot", tags=["linebot"])

LINE_CHANNEL_SECRET       = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")

_PUSH_URL  = "https://api.line.me/v2/bot/message/push"
_REPLY_URL = "https://api.line.me/v2/bot/message/reply"


# ── Helpers ────────────────────────────────────────────────────────────────

def _verify_signature(body: bytes, signature: str) -> bool:
    if not LINE_CHANNEL_SECRET:
        return False
    mac = hmac.new(LINE_CHANNEL_SECRET.encode(), body, hashlib.sha256)
    return hmac.compare_digest(base64.b64encode(mac.digest()).decode(), signature)


def _get_subscribers() -> list[str]:
    raw = get_setting("line_subscribers")
    return json.loads(raw) if raw else []


def _add_subscriber(user_id: str):
    subs = _get_subscribers()
    if user_id not in subs:
        subs.append(user_id)
        set_setting("line_subscribers", json.dumps(subs))
        logger.info("LINE subscriber added: %s", user_id)


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}"}


def _push_sync(user_id: str, text: str):
    if not LINE_CHANNEL_ACCESS_TOKEN:
        return
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(_PUSH_URL, headers=_auth_headers(),
                            json={"to": user_id, "messages": [{"type": "text", "text": text}]})
            if r.status_code != 200:
                logger.warning("LINE push failed %s: %s", r.status_code, r.text)
    except Exception as e:
        logger.error("LINE push error: %s", e)


async def _reply_async(reply_token: str, text: str):
    if not LINE_CHANNEL_ACCESS_TOKEN:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(_REPLY_URL, headers=_auth_headers(),
                          json={"replyToken": reply_token,
                                "messages": [{"type": "text", "text": text}]})


# ── Settlement helpers ──────────────────────────────────────────────────────

def _settlement_date(date_str: str) -> date:
    """Taiwan T+2 settlement: skip weekends."""
    d = date.fromisoformat(date_str)
    added = 0
    while added < 2:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d


# ── Alert logic ─────────────────────────────────────────────────────────────

def check_and_push_alerts():
    """Called daily by APScheduler. Checks DB and pushes to LINE subscribers."""
    subscribers = _get_subscribers()
    if not subscribers:
        return

    today = date.today()

    # Guard: skip if alerts were already sent today (prevents duplicate pushes
    # when the endpoint is called manually while APScheduler already ran).
    last_sent = get_setting("line_alerts_last_sent")
    if last_sent == today.isoformat():
        logger.info("LINE alert already sent today (%s), skipping.", today)
        return

    today_day = today.day
    last_day_today = calendar.monthrange(today.year, today.month)[1]
    tomorrow = today + timedelta(days=1)
    tomorrow_day = tomorrow.day
    last_day_tomorrow = calendar.monthrange(tomorrow.year, tomorrow.month)[1]
    messages: list[str] = []

    with get_db() as conn:
        accounts = {r["id"]: r for r in conn.execute("SELECT id, name, balance FROM accounts").fetchall()}

        # ── 1. Credit card payment reminders ────────────────────────────
        credit_cards = conn.execute(
            "SELECT name, note FROM credit_cards WHERE payment_day = %s",
            (min(today_day, last_day_today),)
        ).fetchall()
        for cc in credit_cards:
            msg = f"💳 信用卡繳費提醒\n\n卡片：{cc['name']}"
            if cc["note"]:
                msg += f"\n備註：{cc['note']}"
            msg += "\n\n請確認今日是否已繳款。"
            messages.append(msg)

        # ── 2. Liability reminders ───────────────────────────────────────
        liabilities = conn.execute(
            "SELECT name, type, amount, monthly_payment, reminder_day, note, account_id "
            "FROM liabilities WHERE reminder_enabled = TRUE AND reminder_day IS NOT NULL"
        ).fetchall()
        for l in liabilities:
            if today_day == min(l["reminder_day"], last_day_today):
                msg = (
                    f"🔔 負債還款提醒\n\n"
                    f"項目：{l['name']}（{l['type']}）\n"
                    f"未償餘額：NT${l['amount']:,.0f}"
                )
                if l["monthly_payment"]:
                    msg += f"\n本月應繳：NT${l['monthly_payment']:,.0f}"
                if l["note"]:
                    msg += f"\n備註：{l['note']}"
                msg += "\n\n請確認今日是否已繳款。"
                messages.append(msg)

        # ── 3. Fund deduction reminders ──────────────────────────────────
        all_fund_schedules = conn.execute(
            "SELECT f.name, fs.day_of_month, fs.amount, f.account_id "
            "FROM fund_schedules fs JOIN funds f ON fs.fund_id = f.id"
        ).fetchall()
        for fs in all_fund_schedules:
            if min(fs["day_of_month"], last_day_today) == today_day:
                acc_name = accounts[fs["account_id"]]["name"] if fs["account_id"] and fs["account_id"] in accounts else None
                msg = f"🏦 基金扣款提醒\n\n基金：{fs['name']}\n扣款金額：NT${fs['amount']:,.0f}"
                if acc_name:
                    msg += f"\n扣款帳戶：{acc_name}"
                messages.append(msg)

        # ── 4. Dividend ex-date reminders ────────────────────────────────
        dividends = conn.execute(
            "SELECT code, cash_div FROM dividend_records WHERE ex_date = %s AND cash_div > 0",
            (today.isoformat(),)
        ).fetchall()
        if dividends:
            div_lines = "\n".join(f"  • {d['code']}　每股 NT${d['cash_div']}" for d in dividends)
            messages.append(f"💵 今日股息除息\n\n{div_lines}")

        # ── 5. Stock settlement reminders (T+2 due today) ────────────────
        all_buy_trades = conn.execute(
            "SELECT code, date, shares, price, fee, account_id FROM trades "
            "WHERE type = 'buy' AND settled = FALSE"
        ).fetchall()

        settle_today: dict[str, dict] = {}
        for t in all_buy_trades:
            if _settlement_date(t["date"]) != today:
                continue
            amount = t["shares"] * t["price"] + (t["fee"] or 0)
            key = t["account_id"] or "__none__"
            if key not in settle_today:
                acc_name = (accounts[t["account_id"]]["name"] if t["account_id"] and t["account_id"] in accounts else "未連結帳戶")
                settle_today[key] = {"name": acc_name, "amount": 0.0, "codes": []}
            settle_today[key]["amount"] += amount
            settle_today[key]["codes"].append(t["code"])

        for info in settle_today.values():
            codes_str = "、".join(info["codes"][:3])
            if len(info["codes"]) > 3:
                codes_str += f" 等 {len(info['codes'])} 支"
            messages.append(
                f"📅 今日股票交割\n\n"
                f"帳戶：{info['name']}\n"
                f"交割金額：NT${info['amount']:,.0f}\n"
                f"股票：{codes_str}\n\n"
                f"請確認帳戶已有足夠餘額。"
            )

        # ── 6. Balance alert (D-1: warn today if tomorrow's deductions exceed balance) ──
        tomorrow_ded: dict[str, float] = {}

        def _add_ded(account_id: str | None, amt: float) -> None:
            if account_id and account_id in accounts:
                tomorrow_ded[account_id] = tomorrow_ded.get(account_id, 0) + amt

        for l in liabilities:
            if tomorrow_day == min(l["reminder_day"], last_day_tomorrow) and l["monthly_payment"] and l["account_id"]:
                _add_ded(l["account_id"], l["monthly_payment"])

        for fs in all_fund_schedules:
            if min(fs["day_of_month"], last_day_tomorrow) == tomorrow_day:
                _add_ded(fs["account_id"], fs["amount"])

        for t in all_buy_trades:
            if _settlement_date(t["date"]) == tomorrow:
                _add_ded(t["account_id"], t["shares"] * t["price"] + (t["fee"] or 0))

        for account_id, total_due in tomorrow_ded.items():
            acct = accounts.get(account_id)
            if not acct or acct["balance"] >= total_due:
                continue
            shortfall = total_due - acct["balance"]
            messages.append(
                f"⚠️ 明日帳戶餘額不足提醒\n\n"
                f"帳戶：{acct['name']}\n"
                f"帳戶餘額：NT${acct['balance']:,.0f}\n"
                f"明日應扣：NT${total_due:,.0f}\n"
                f"缺口：NT${shortfall:,.0f}\n\n"
                f"請儘速補足款項！"
            )

    set_setting("line_alerts_last_sent", today.isoformat())
    if messages:
        combined = "\n\n─────────────────\n\n".join(messages)
        for uid in subscribers:
            _push_sync(uid, combined)
        logger.info("LINE alert pushed to %d subscriber(s): %d message(s)", len(subscribers), len(messages))
    else:
        logger.debug("LINE alert check: no alerts today")


# ── Webhook endpoint ─────────────────────────────────────────────────────────

@router.post("/webhook")
async def webhook(request: Request, x_line_signature: str = Header(...)):
    body = await request.body()

    if LINE_CHANNEL_SECRET and not _verify_signature(body, x_line_signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    payload = json.loads(body)
    for event in payload.get("events", []):
        user_id     = event.get("source", {}).get("userId")
        event_type  = event.get("type")
        reply_token = event.get("replyToken")

        if not user_id:
            continue

        is_new = user_id not in _get_subscribers()
        if event_type in ("follow", "message"):
            _add_subscriber(user_id)

        if event_type == "message" and reply_token:
            if is_new:
                await _reply_async(
                    reply_token,
                    "已訂閱提醒通知 ✓\n\n"
                    "我會在以下情況主動通知您：\n"
                    "• 💳 信用卡繳費日\n"
                    "• 🔔 負債還款提醒日\n"
                    "• 🏦 基金扣款日\n"
                    "• 💵 股息除息日\n"
                    "• 📅 股票交割日（T+2）\n"
                    "• ⚠️ 明日帳戶餘額不足預警\n\n"
                    "通知時間：每日早上 08:00",
                )
            else:
                await _reply_async(reply_token, "您已在訂閱名單中，有提醒時會主動通知。")

    return {"status": "ok"}


# ── Stop-loss check ──────────────────────────────────────────────────────────

def check_stop_loss_alerts():
    """Called at 13:00 on weekdays. Pushes stop-loss triggered alerts."""
    if date.today().weekday() >= 5:
        return

    subscribers = _get_subscribers()
    if not subscribers:
        return

    with get_db() as conn:
        rows = conn.execute(
            "SELECT ts.code, ts.stop_loss, COALESCE(tm.market, 'tw') AS market "
            "FROM tracked_stocks ts "
            "LEFT JOIN trade_markets tm ON ts.code = tm.code "
            "WHERE ts.stop_loss IS NOT NULL AND ts.stop_loss != '' "
            "AND ts.status = 'holding'"
        ).fetchall()

    targets = []
    for r in rows:
        try:
            sl = float(r["stop_loss"])
            if sl > 0:
                targets.append({"code": r["code"], "market": r["market"], "stop_loss": sl})
        except (ValueError, TypeError):
            continue

    if not targets:
        return

    import concurrent.futures
    import math
    import yfinance as yf

    def _safe(p) -> float | None:
        try:
            f = float(p)
            return f if f > 0 and not math.isnan(f) else None
        except Exception:
            return None

    def _fetch(item: dict) -> tuple[str, float | None, float]:
        code, market, sl = item["code"], item["market"], item["stop_loss"]
        if market == "us":
            try:
                return code, _safe(yf.Ticker(code).fast_info.last_price), sl
            except Exception:
                return code, None, sl
        for suffix in (".TW", ".TWO"):
            try:
                p = _safe(yf.Ticker(code + suffix).fast_info.last_price)
                if p is not None:
                    return code, p, sl
            except Exception:
                continue
        return code, None, sl

    triggered: list[tuple[str, float, float]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch, item): item for item in targets}
        for fut in concurrent.futures.as_completed(futures, timeout=30):
            try:
                code, price, sl = fut.result()
                if price is not None and price <= sl:
                    triggered.append((code, price, sl))
            except Exception as e:
                logger.warning("Stop-loss price fetch error: %s", e)

    if not triggered:
        logger.debug("Stop-loss check: no triggers at 13:00")
        return

    lines = "\n".join(
        f"  • {code}　現價 {price:.2f}（停損 {sl:.2f}）"
        for code, price, sl in triggered
    )
    msg = (
        f"🚨 停損提醒\n\n"
        f"以下股票已觸及停損價格：\n{lines}\n\n"
        f"請確認是否執行停損。"
    )
    for uid in subscribers:
        _push_sync(uid, msg)
    logger.info("LINE stop-loss alert pushed: %d stock(s) triggered", len(triggered))


# ── Manual trigger (for testing) ─────────────────────────────────────────────

@router.post("/push-test")
async def push_test():
    """Manually trigger alert check (for testing)."""
    import asyncio
    await asyncio.to_thread(check_and_push_alerts)
    return {"status": "ok", "subscribers": len(_get_subscribers())}


@router.post("/push-test-sl")
async def push_test_sl():
    """Manually trigger stop-loss check (for testing)."""
    import asyncio
    await asyncio.to_thread(check_stop_loss_alerts)
    return {"status": "ok", "subscribers": len(_get_subscribers())}
