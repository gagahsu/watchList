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
import math
import os
import uuid
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


def _remove_subscriber(user_id: str):
    subs = _get_subscribers()
    if user_id in subs:
        subs.remove(user_id)
        set_setting("line_subscribers", json.dumps(subs))


# ── Authorization whitelist ──────────────────────────────────────────────────
# Stored in settings under "line_allowed_users" as a JSON array of LINE user IDs.
# Bootstrap: on first read, existing subscribers are grandfathered in; if there
# are none, the first user to interact becomes the owner.

def _get_allowed() -> list[str]:
    raw = get_setting("line_allowed_users")
    if raw is not None:
        return json.loads(raw)
    subs = _get_subscribers()
    if subs:
        set_setting("line_allowed_users", json.dumps(subs))
        logger.info("LINE whitelist initialized from %d existing subscriber(s)", len(subs))
    return subs


def _is_allowed(user_id: str) -> bool:
    allowed = _get_allowed()
    return not allowed or user_id in allowed


def _add_allowed(user_id: str):
    allowed = _get_allowed()
    if user_id not in allowed:
        allowed.append(user_id)
        set_setting("line_allowed_users", json.dumps(allowed))
        logger.info("LINE user authorized: %s", user_id)


def _remove_allowed(user_id: str):
    allowed = _get_allowed()
    if user_id in allowed:
        allowed.remove(user_id)
        set_setting("line_allowed_users", json.dumps(allowed))
        logger.info("LINE user deauthorized: %s", user_id)


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

    tomorrow = today + timedelta(days=1)
    tomorrow_day = tomorrow.day
    last_day_tomorrow = calendar.monthrange(tomorrow.year, tomorrow.month)[1]
    messages: list[str] = []

    with get_db() as conn:
        accounts = {r["id"]: r for r in conn.execute("SELECT id, name, balance FROM accounts").fetchall()}

        # ── 1. Credit card payment reminders (明日繳費) ──────────────────
        credit_cards = conn.execute(
            "SELECT name, note FROM credit_cards WHERE payment_day = %s",
            (min(tomorrow_day, last_day_tomorrow),)
        ).fetchall()
        for cc in credit_cards:
            msg = f"💳 信用卡繳費提醒\n\n卡片：{cc['name']}"
            if cc["note"]:
                msg += f"\n備註：{cc['note']}"
            msg += "\n\n明日為繳費日，請儘早準備款項。"
            messages.append(msg)

        # ── 2. Liability reminders (明日還款) ────────────────────────────
        liabilities = conn.execute(
            "SELECT name, type, amount, monthly_payment, reminder_day, note, account_id "
            "FROM liabilities WHERE reminder_enabled = TRUE AND reminder_day IS NOT NULL"
        ).fetchall()
        for l in liabilities:
            if tomorrow_day == min(l["reminder_day"], last_day_tomorrow):
                msg = (
                    f"🔔 負債還款提醒\n\n"
                    f"項目：{l['name']}（{l['type']}）\n"
                    f"未償餘額：NT${l['amount']:,.0f}"
                )
                if l["monthly_payment"]:
                    msg += f"\n本月應繳：NT${l['monthly_payment']:,.0f}"
                if l["note"]:
                    msg += f"\n備註：{l['note']}"
                msg += "\n\n明日為還款日，請儘早準備款項。"
                messages.append(msg)

        # ── 3. Fund deduction reminders (明日扣款) ───────────────────────
        all_fund_schedules = conn.execute(
            "SELECT f.name, fs.day_of_month, fs.amount, f.account_id "
            "FROM fund_schedules fs JOIN funds f ON fs.fund_id = f.id"
        ).fetchall()
        for fs in all_fund_schedules:
            if min(fs["day_of_month"], last_day_tomorrow) == tomorrow_day:
                acc_name = accounts[fs["account_id"]]["name"] if fs["account_id"] and fs["account_id"] in accounts else None
                msg = f"🏦 基金扣款提醒\n\n基金：{fs['name']}\n扣款金額：NT${fs['amount']:,.0f}"
                if acc_name:
                    msg += f"\n扣款帳戶：{acc_name}"
                msg += "\n\n明日為扣款日，請確認帳戶餘額。"
                messages.append(msg)

        # ── 4. Dividend ex-date reminders (明日除息) ─────────────────────
        dividends = conn.execute(
            "SELECT code, cash_div FROM dividend_records WHERE ex_date = %s AND cash_div > 0",
            (tomorrow.isoformat(),)
        ).fetchall()
        if dividends:
            div_lines = "\n".join(f"  • {d['code']}　每股 NT${d['cash_div']}" for d in dividends)
            messages.append(f"💵 明日股息除息\n\n{div_lines}")

        # ── 4b. Dividend pay-date reminders (今日股息入帳) ────────────────
        pay_today = conn.execute(
            "SELECT code, cash_div FROM dividend_records WHERE pay_date = %s AND cash_div > 0",
            (today.isoformat(),)
        ).fetchall()
        if pay_today:
            shares_map: dict[str, float] = {}
            for t in conn.execute("SELECT code, type, shares FROM trades").fetchall():
                delta = t["shares"] if t["type"] == "buy" else -t["shares"]
                shares_map[t["code"]] = shares_map.get(t["code"], 0) + delta
            pay_lines = []
            for d in pay_today:
                held = shares_map.get(d["code"], 0)
                if held > 0:
                    est = d["cash_div"] * held
                    pay_lines.append(f"  • {d['code']}　每股 NT${d['cash_div']}　約 NT${est:,.0f}")
                else:
                    pay_lines.append(f"  • {d['code']}　每股 NT${d['cash_div']}")
            messages.append(
                f"💵 今日股息入帳\n\n{chr(10).join(pay_lines)}\n\n"
                f"金額以現持股估算，請以券商對帳單為準。"
            )

        # ── 5. Stock settlement reminders (明日 T+2 交割) ────────────────
        all_buy_trades = conn.execute(
            "SELECT code, date, shares, price, fee, account_id FROM trades "
            "WHERE type = 'buy' AND settled = FALSE"
        ).fetchall()

        settle_tomorrow: dict[str, dict] = {}
        for t in all_buy_trades:
            if _settlement_date(t["date"]) != tomorrow:
                continue
            amount = t["shares"] * t["price"] + (t["fee"] or 0)
            key = t["account_id"] or "__none__"
            if key not in settle_tomorrow:
                acc_name = (accounts[t["account_id"]]["name"] if t["account_id"] and t["account_id"] in accounts else "未連結帳戶")
                settle_tomorrow[key] = {"name": acc_name, "amount": 0.0, "codes": []}
            settle_tomorrow[key]["amount"] += amount
            settle_tomorrow[key]["codes"].append(t["code"])

        for info in settle_tomorrow.values():
            codes_str = "、".join(info["codes"][:3])
            if len(info["codes"]) > 3:
                codes_str += f" 等 {len(info['codes'])} 支"
            messages.append(
                f"📅 明日股票交割\n\n"
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


# ── Command handling ─────────────────────────────────────────────────────────

_HELP_TEXT = (
    "📋 可用指令：\n\n"
    "🔹 股票交易\n"
    "買 代碼 股數 價格 [券商]\n"
    "例：買 2330 1000 580 元大\n\n"
    "賣 代碼 股數 價格 [券商]\n"
    "例：賣 2330 1000 600 元大\n\n"
    "🔹 帳戶金流\n"
    "存入 金額 帳戶名稱\n"
    "例：存入 50000 玉山\n\n"
    "提出 金額 帳戶名稱\n"
    "例：提出 30000 玉山\n\n"
    "轉帳 金額 來源帳戶 目標帳戶\n"
    "例：轉帳 10000 玉山 富邦\n\n"
    "🔹 查詢\n"
    "餘額 – 所有帳戶餘額\n"
    "帳戶 – 帳戶列表\n"
    "券商 – 券商列表\n"
    "幫助 / 指令 / 選單 – 顯示此說明\n\n"
    "🔹 管理\n"
    "授權 LINE-ID – 允許他人使用\n"
    "取消授權 LINE-ID – 移除使用權"
)

_TRADE_CMDS = {"買": "buy", "買入": "buy", "買進": "buy", "賣": "sell", "賣出": "sell", "賣掉": "sell"}
_DEPOSIT_CMDS = {"存入", "存款", "入帳"}
_WITHDRAW_CMDS = {"提出", "提款", "出帳"}
_TRANSFER_CMDS = {"轉帳", "轉出"}


def _parse_number(s: str) -> float | None:
    s = s.replace(",", "").replace("，", "").rstrip("元股張")
    try:
        return float(s)
    except ValueError:
        return None


def _fuzzy_match(rows, name: str, key: str = "name") -> dict | None:
    for r in rows:
        if r[key] == name:
            return dict(r)
    for r in rows:
        if name in r[key] or r[key] in name:
            return dict(r)
    return None


def _calc_fee(shares: float, price: float, trade_type: str, broker: dict, code: str = "") -> float:
    fns = {"floor": math.floor, "round": round, "ceil": math.ceil}
    round_fn = fns.get(broker["rounding"], math.floor)
    brokerage = max(broker["min_fee"], round_fn(shares * price * 0.001425 * broker["discount"]))
    if trade_type == "sell":
        # US stocks (alphabetic codes) have no Taiwan transaction tax
        if code and code.replace(".", "").isalpha():
            tax = 0
        elif code.startswith("00"):
            tax = math.floor(shares * price * 0.001)   # ETF: 0.1%
        else:
            tax = math.floor(shares * price * 0.003)   # 一般股票: 0.3%
    else:
        tax = 0
    return brokerage + tax


def _process_command(text: str) -> str | None:
    """Parse a LINE text message and execute the command. Returns reply string or None."""
    parts = text.strip().split()
    if not parts:
        return None
    cmd = parts[0]

    # ── Help ────────────────────────────────────────────────────────────────
    if cmd in ("幫助", "help", "Help", "?", "說明", "指令", "指令列表", "選單"):
        return _HELP_TEXT

    # ── Authorization management ─────────────────────────────────────────────
    if cmd == "授權":
        if len(parts) < 2 or not parts[1].startswith("U"):
            return "格式錯誤。範例：授權 Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        _add_allowed(parts[1])
        return f"✅ 已授權：\n{parts[1]}\n\n對方重新傳訊即可開始使用。"

    if cmd == "取消授權":
        if len(parts) < 2 or not parts[1].startswith("U"):
            return "格式錯誤。範例：取消授權 Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        allowed = _get_allowed()
        if parts[1] in allowed and len(allowed) <= 1:
            return "無法移除最後一位使用者（白名單清空後任何人都能使用）。"
        _remove_allowed(parts[1])
        _remove_subscriber(parts[1])
        return f"✅ 已取消授權並停止推播：\n{parts[1]}"

    # ── Balance query ────────────────────────────────────────────────────────
    if cmd == "餘額":
        with get_db() as conn:
            rows = conn.execute("SELECT name, balance FROM accounts ORDER BY sort_order").fetchall()
        if not rows:
            return "目前沒有帳戶資料。"
        lines = "\n".join(f"  {r['name']}：NT${r['balance']:,.0f}" for r in rows)
        total = sum(r["balance"] for r in rows)
        return f"💰 帳戶餘額\n\n{lines}\n\n總計：NT${total:,.0f}"

    # ── Account list ─────────────────────────────────────────────────────────
    if cmd == "帳戶":
        with get_db() as conn:
            rows = conn.execute("SELECT name FROM accounts ORDER BY sort_order").fetchall()
        if not rows:
            return "目前沒有帳戶資料。"
        return "🏦 帳戶列表\n\n" + "\n".join(f"  • {r['name']}" for r in rows)

    # ── Broker list ──────────────────────────────────────────────────────────
    if cmd == "券商":
        with get_db() as conn:
            rows = conn.execute("SELECT name, discount, min_fee FROM brokers ORDER BY name").fetchall()
        if not rows:
            return "目前沒有券商資料。"
        lines = "\n".join(
            f"  • {r['name']}　折扣 {r['discount']*100:.0f}%　最低 NT${r['min_fee']}"
            for r in rows
        )
        return f"🏢 券商列表\n\n{lines}"

    # ── Trade commands ───────────────────────────────────────────────────────
    if cmd in _TRADE_CMDS:
        trade_type = _TRADE_CMDS[cmd]
        if len(parts) < 4:
            return f"格式錯誤。範例：{cmd} 2330 1000 580 [券商名稱]"
        code = parts[1].upper()
        shares = _parse_number(parts[2])
        price = _parse_number(parts[3])
        if shares is None or price is None or shares <= 0 or price <= 0:
            return "股數或價格格式錯誤。"

        broker = None
        broker_name = None
        if len(parts) >= 5:
            with get_db() as conn:
                brokers = conn.execute("SELECT * FROM brokers").fetchall()
            broker = _fuzzy_match(brokers, parts[4])
            if broker is None:
                return f"找不到券商「{parts[4]}」，請先在系統中建立，或傳「券商」查看列表。"
            broker_name = broker["name"]

        fee = _calc_fee(shares, price, trade_type, broker, code) if broker else 0.0
        today = date.today().isoformat()
        trade_id = str(uuid.uuid4())
        settled = trade_type == "sell"

        with get_db() as conn:
            conn.execute(
                "INSERT INTO trades(id, code, date, type, shares, price, fee, note, account_id, settled)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (trade_id, code, today, trade_type, shares, price, fee, "", None, settled),
            )

        type_str = "買入" if trade_type == "buy" else "賣出"
        amount = shares * price
        reply = (
            f"✅ {type_str}交易已記錄\n\n"
            f"股票：{code}\n"
            f"股數：{int(shares):,} 股\n"
            f"價格：NT${price:,.2f}\n"
            f"成交金額：NT${amount:,.0f}\n"
            f"手續費：NT${fee:,.0f}"
        )
        if broker_name:
            reply += f"\n券商：{broker_name}"
        if trade_type == "buy":
            reply += f"\n交割日：{_settlement_date(today).isoformat()}"
        return reply

    # ── Deposit ──────────────────────────────────────────────────────────────
    if cmd in _DEPOSIT_CMDS:
        if len(parts) < 3:
            return "格式錯誤。範例：存入 50000 帳戶名稱"
        amount = _parse_number(parts[1])
        if amount is None or amount <= 0:
            return "金額格式錯誤。"
        with get_db() as conn:
            accts = conn.execute("SELECT * FROM accounts").fetchall()
            acct = _fuzzy_match(accts, parts[2])
            if not acct:
                return f"找不到帳戶「{parts[2]}」，請傳「帳戶」查看列表。"
            txn_id = str(uuid.uuid4())
            today = date.today().isoformat()
            conn.execute(
                "INSERT INTO account_transactions(id,date,type,amount,account_id,to_account_id,note)"
                " VALUES(%s,%s,'deposit',%s,%s,NULL,'')",
                (txn_id, today, amount, acct["id"]),
            )
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (amount, acct["id"]))
            new_bal = conn.execute("SELECT balance FROM accounts WHERE id=%s", (acct["id"],)).fetchone()["balance"]
        return (
            f"✅ 存款已記錄\n\n"
            f"帳戶：{acct['name']}\n"
            f"存入：NT${amount:,.0f}\n"
            f"更新後餘額：NT${new_bal:,.0f}"
        )

    # ── Withdrawal ───────────────────────────────────────────────────────────
    if cmd in _WITHDRAW_CMDS:
        if len(parts) < 3:
            return "格式錯誤。範例：提出 30000 帳戶名稱"
        amount = _parse_number(parts[1])
        if amount is None or amount <= 0:
            return "金額格式錯誤。"
        with get_db() as conn:
            accts = conn.execute("SELECT * FROM accounts").fetchall()
            acct = _fuzzy_match(accts, parts[2])
            if not acct:
                return f"找不到帳戶「{parts[2]}」，請傳「帳戶」查看列表。"
            txn_id = str(uuid.uuid4())
            today = date.today().isoformat()
            conn.execute(
                "INSERT INTO account_transactions(id,date,type,amount,account_id,to_account_id,note)"
                " VALUES(%s,%s,'withdrawal',%s,%s,NULL,'')",
                (txn_id, today, amount, acct["id"]),
            )
            conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (amount, acct["id"]))
            new_bal = conn.execute("SELECT balance FROM accounts WHERE id=%s", (acct["id"],)).fetchone()["balance"]
        return (
            f"✅ 提款已記錄\n\n"
            f"帳戶：{acct['name']}\n"
            f"提出：NT${amount:,.0f}\n"
            f"更新後餘額：NT${new_bal:,.0f}"
        )

    # ── Transfer ─────────────────────────────────────────────────────────────
    if cmd in _TRANSFER_CMDS:
        if len(parts) < 4:
            return "格式錯誤。範例：轉帳 10000 來源帳戶 目標帳戶"
        amount = _parse_number(parts[1])
        if amount is None or amount <= 0:
            return "金額格式錯誤。"
        with get_db() as conn:
            accts = conn.execute("SELECT * FROM accounts").fetchall()
            src = _fuzzy_match(accts, parts[2])
            dst = _fuzzy_match(accts, parts[3])
            if not src:
                return f"找不到來源帳戶「{parts[2]}」。"
            if not dst:
                return f"找不到目標帳戶「{parts[3]}」。"
            if src["id"] == dst["id"]:
                return "來源帳戶與目標帳戶相同。"
            txn_id = str(uuid.uuid4())
            today = date.today().isoformat()
            conn.execute(
                "INSERT INTO account_transactions(id,date,type,amount,account_id,to_account_id,note)"
                " VALUES(%s,%s,'transfer',%s,%s,%s,'')",
                (txn_id, today, amount, src["id"], dst["id"]),
            )
            conn.execute("UPDATE accounts SET balance=balance-%s WHERE id=%s", (amount, src["id"]))
            conn.execute("UPDATE accounts SET balance=balance+%s WHERE id=%s", (amount, dst["id"]))
            src_bal = conn.execute("SELECT balance FROM accounts WHERE id=%s", (src["id"],)).fetchone()["balance"]
            dst_bal = conn.execute("SELECT balance FROM accounts WHERE id=%s", (dst["id"],)).fetchone()["balance"]
        return (
            f"✅ 轉帳已記錄\n\n"
            f"來源：{src['name']}（餘額 NT${src_bal:,.0f}）\n"
            f"目標：{dst['name']}（餘額 NT${dst_bal:,.0f}）\n"
            f"金額：NT${amount:,.0f}"
        )

    return None


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

        # Whitelist gate: unauthorized users are never subscribed and cannot
        # run commands; they only get a rejection with their own ID so the
        # owner can authorize them.
        if not _is_allowed(user_id):
            if event_type == "message" and reply_token:
                await _reply_async(
                    reply_token,
                    "此 Bot 為私人財務助理，未開放使用。\n\n"
                    f"您的 LINE ID：\n{user_id}\n\n"
                    f"如需使用，請由管理者傳送：\n授權 {user_id}",
                )
            logger.warning("LINE unauthorized access attempt: %s", user_id)
            continue

        is_new = user_id not in _get_subscribers()
        if event_type in ("follow", "message"):
            _add_allowed(user_id)   # persist bootstrap owner on first contact
            _add_subscriber(user_id)

        if event_type == "message" and reply_token:
            msg_text = event.get("message", {}).get("text", "")
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
                    "• ⚠️ 明日帳戶餘額不足預警\n"
                    "• 🚨 停損／🎯 停利／📉 加碼到價（平日 13:00）\n"
                    "• 📉 持股單日重挫（平日 14:30）\n"
                    "• 📊 籌碼異動（平日 19:00）\n"
                    "• 🎉 淨資產新高與回撤警示\n"
                    "• 📊 週報（週日 20:00）、月結（每月 1 日）\n\n"
                    "每日彙整通知時間：17:00\n\n"
                    "傳「幫助」查看可用指令。",
                )
            elif msg_text:
                lines = [l.strip() for l in msg_text.splitlines() if l.strip()]
                replies: list[str] = []
                for line in lines:
                    try:
                        r = _process_command(line)
                    except Exception as e:
                        logger.error("LINE command error (%s): %s", line, e)
                        r = f"「{line}」處理失敗，請確認格式後再試。"
                    if r is None:
                        r = f"「{line}」無法識別指令。\n傳「幫助」查看可用指令。"
                    replies.append(r)
                await _reply_async(reply_token, "\n\n─────────────────\n\n".join(replies))

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


@router.post("/push-test-features/{name}")
async def push_test_features(name: str):
    """Manually trigger one of the scheduled push jobs (for testing).
    name: price | drop | networth | nosl | chips | weekly | monthly"""
    import asyncio
    import push_alerts as pa
    jobs = {
        "price":    pa.check_price_alerts,
        "drop":     pa.check_daily_drop_alerts,
        "networth": pa.check_net_worth_alerts,
        "nosl":     pa.check_no_stop_loss_reminder,
        "chips":    pa.check_chip_alerts,
        "weekly":   pa.send_weekly_report,
        "monthly":  pa.send_monthly_report,
    }
    if name not in jobs:
        raise HTTPException(404, f"unknown job, choose from: {', '.join(jobs)}")
    await asyncio.to_thread(jobs[name])
    return {"status": "ok", "job": name}


@router.post("/push-test-sl")
async def push_test_sl():
    """Manually trigger stop-loss check (for testing)."""
    import asyncio
    await asyncio.to_thread(check_stop_loss_alerts)
    return {"status": "ok", "subscribers": len(_get_subscribers())}
