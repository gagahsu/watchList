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
    messages: list[str] = []

    with get_db() as conn:
        # ── Account settlement warnings ─────────────────────────────────
        accounts = conn.execute("SELECT id, name, balance FROM accounts").fetchall()
        buy_trades = conn.execute(
            "SELECT account_id, date, shares, price, fee FROM trades "
            "WHERE type = 'buy' AND account_id IS NOT NULL"
        ).fetchall()

        for acc in accounts:
            pending = sum(
                t["shares"] * t["price"] + (t["fee"] or 0)
                for t in buy_trades
                if t["account_id"] == acc["id"] and _settlement_date(t["date"]) >= today
            )
            available = acc["balance"] - pending
            if pending > 0 and available < 0:
                messages.append(
                    f"⚠️ 交割款不足提醒\n\n"
                    f"帳戶：{acc['name']}\n"
                    f"帳戶餘額：NT${acc['balance']:,.0f}\n"
                    f"待交割：NT${pending:,.0f}\n"
                    f"缺口：NT${-available:,.0f}\n\n"
                    f"請儘速補足款項！"
                )

        # ── Liability reminders ─────────────────────────────────────────
        today_day = today.day
        last_day  = calendar.monthrange(today.year, today.month)[1]

        liabilities = conn.execute(
            "SELECT name, type, amount, reminder_day, note FROM liabilities "
            "WHERE reminder_enabled = TRUE AND reminder_day IS NOT NULL"
        ).fetchall()

        for l in liabilities:
            if today_day == min(l["reminder_day"], last_day):
                msg = (
                    f"🔔 負債還款提醒\n\n"
                    f"項目：{l['name']}（{l['type']}）\n"
                    f"未償餘額：NT${l['amount']:,.0f}"
                )
                if l["note"]:
                    msg += f"\n備註：{l['note']}"
                msg += "\n\n請確認今日是否已繳款。"
                messages.append(msg)

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
                    "• ⚠️ 交割款帳戶餘額不足\n"
                    "• 🔔 負債還款提醒日\n\n"
                    "通知時間：每日早上 08:00",
                )
            else:
                await _reply_async(reply_token, "您已在訂閱名單中，有提醒時會主動通知。")

    return {"status": "ok"}


# ── Manual trigger (for testing) ─────────────────────────────────────────────

@router.post("/push-test")
async def push_test():
    """Manually trigger alert check (for testing)."""
    import asyncio
    await asyncio.to_thread(check_and_push_alerts)
    return {"status": "ok", "subscribers": len(_get_subscribers())}
