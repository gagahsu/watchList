"""Scheduled LINE push jobs: price alerts (stop-loss / take-profit / tranche),
daily drop, net-worth drawdown & new high, missing stop-loss, chip moves,
weekly and monthly reports.

All jobs are no-ops when there are no LINE subscribers. Each job guards
against duplicate sends where re-firing would spam (settings-table keys).
"""
import concurrent.futures
import logging
import math
from datetime import date, datetime, timedelta

from database import get_db, get_setting, set_setting
from fifo import calc_fifo, current_holdings, load_trades_by_code
from routers.linebot import _get_subscribers, _push_sync

logger = logging.getLogger(__name__)

SEP = "\n\n─────────────────\n\n"


# ── Shared helpers ───────────────────────────────────────────────────────────

def _safe(p) -> float | None:
    try:
        f = float(p)
        return f if f > 0 and not math.isnan(f) else None
    except Exception:
        return None


def _fetch_price(code: str, market: str) -> float | None:
    import yfinance as yf
    if market == "us":
        try:
            return _safe(yf.Ticker(code).fast_info.last_price)
        except Exception:
            return None
    for suffix in (".TW", ".TWO"):
        try:
            p = _safe(yf.Ticker(code + suffix).fast_info.last_price)
            if p is not None:
                return p
        except Exception:
            continue
    return None


def _fetch_prices(targets: dict[str, str]) -> dict[str, float | None]:
    """targets: {code: market} → {code: price|None}, fetched concurrently."""
    result: dict[str, float | None] = {}
    if not targets:
        return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_price, c, m): c for c, m in targets.items()}
        for fut in concurrent.futures.as_completed(futures, timeout=60):
            code = futures[fut]
            try:
                result[code] = fut.result()
            except Exception:
                result[code] = None
    return result


def _stock_names() -> dict[str, str]:
    with get_db() as conn:
        return {r["code"]: r["name"] for r in
                conn.execute("SELECT code, name FROM stocks").fetchall()}


def _fx_rate() -> float:
    try:
        return float(get_setting("usdtwd_rate") or 31.5)
    except (TypeError, ValueError):
        return 31.5


def _push_all(messages: list[str]):
    if not messages:
        return
    combined = SEP.join(messages)
    for uid in _get_subscribers():
        _push_sync(uid, combined)


def _once_per_day(key: str) -> bool:
    """True if this key has NOT fired today yet (and marks it fired)."""
    today = date.today().isoformat()
    if get_setting(key) == today:
        return False
    set_setting(key, today)
    return True


# ── 1. Price alerts: stop-loss + take-profit + tranche triggers (13:00 平日) ──

def check_price_alerts():
    if date.today().weekday() >= 5 or not _get_subscribers():
        return

    with get_db() as conn:
        tracked = conn.execute(
            "SELECT ts.code, ts.stop_loss, ts.take_profit, COALESCE(tm.market,'tw') AS market "
            "FROM tracked_stocks ts LEFT JOIN trade_markets tm ON ts.code = tm.code "
            "WHERE ts.status = 'holding'"
        ).fetchall()
        tranche_items = conn.execute(
            "SELECT ti.id, ti.seq, ti.trigger_price, ti.amount, tp.code, tp.note "
            "FROM tranche_items ti JOIN tranche_plans tp ON ti.plan_id = tp.id "
            "WHERE ti.status = 'pending' AND ti.alerted_at IS NULL"
        ).fetchall()

    sl_targets, tp_targets = [], []
    for r in tracked:
        try:
            sl = float(r["stop_loss"]) if r["stop_loss"] else 0
        except (ValueError, TypeError):
            sl = 0
        try:
            tp = float(r["take_profit"]) if r["take_profit"] else 0
        except (ValueError, TypeError):
            tp = 0
        if sl > 0:
            sl_targets.append({"code": r["code"], "market": r["market"], "price": sl})
        if tp > 0:
            tp_targets.append({"code": r["code"], "market": r["market"], "price": tp})

    codes: dict[str, str] = {}
    for t in sl_targets + tp_targets:
        codes[t["code"]] = t["market"]
    for it in tranche_items:
        codes.setdefault(it["code"], "tw")
    if not codes:
        return

    prices = _fetch_prices(codes)
    names = _stock_names()
    messages: list[str] = []

    sl_hits = [(t["code"], prices.get(t["code"]), t["price"]) for t in sl_targets
               if prices.get(t["code"]) is not None and prices[t["code"]] <= t["price"]]
    if sl_hits:
        lines = "\n".join(f"  • {c} {names.get(c, '')}　現價 {p:.2f}（停損 {sl:.2f}）"
                          for c, p, sl in sl_hits)
        messages.append(f"🚨 停損提醒\n\n以下股票已觸及停損價格：\n{lines}\n\n請確認是否執行停損。")

    tp_hits = [(t["code"], prices.get(t["code"]), t["price"]) for t in tp_targets
               if prices.get(t["code"]) is not None and prices[t["code"]] >= t["price"]]
    if tp_hits:
        lines = "\n".join(f"  • {c} {names.get(c, '')}　現價 {p:.2f}（停利 {tp:.2f}）"
                          for c, p, tp in tp_hits)
        messages.append(f"🎯 停利提醒\n\n以下股票已達停利價格：\n{lines}\n\n可考慮分批獲利了結。")

    tranche_hits = []
    for it in tranche_items:
        p = prices.get(it["code"])
        if p is not None and p <= it["trigger_price"]:
            tranche_hits.append(it)
    if tranche_hits:
        lines = "\n".join(
            f"  • {it['code']} {names.get(it['code'], '')}　第 {it['seq']} 筆"
            f"　觸發價 {it['trigger_price']:.2f}　金額 NT${it['amount']:,.0f}"
            for it in tranche_hits
        )
        messages.append(f"📉 分批加碼到價\n\n{lines}\n\n買進後請至網站標記「已買進」。")
        now = datetime.now().isoformat(timespec="seconds")
        with get_db() as conn:
            for it in tranche_hits:
                conn.execute("UPDATE tranche_items SET alerted_at=%s WHERE id=%s",
                             (now, it["id"]))

    if messages:
        _push_all(messages)
        logger.info("Price alerts pushed: SL=%d TP=%d tranche=%d",
                    len(sl_hits), len(tp_hits), len(tranche_hits))


# ── 2. Daily drop alert (14:30 平日) ──────────────────────────────────────────

def check_daily_drop_alerts():
    if date.today().weekday() >= 5 or not _get_subscribers():
        return
    if not _once_per_day("drop_alert_last_sent"):
        return

    try:
        threshold = float(get_setting("alert_drop_pct") or 5)
    except (TypeError, ValueError):
        threshold = 5.0

    import yfinance as yf
    names = _stock_names()
    lines = []
    for h in current_holdings():
        suffixes = [""] if h["market"] == "us" else [".TW", ".TWO"]
        for sfx in suffixes:
            try:
                hist = yf.Ticker(h["code"] + sfx).history(period="5d")
                closes = [c for c in hist["Close"].tolist() if _safe(c)]
                if len(closes) >= 2:
                    pct = (closes[-1] - closes[-2]) / closes[-2] * 100
                    if pct <= -threshold:
                        lines.append(f"  • {h['code']} {names.get(h['code'], '')}"
                                     f"　{closes[-1]:.2f}（{pct:+.2f}%）")
                    break
            except Exception:
                continue

    if lines:
        _push_all([f"📉 持股單日重挫（跌幅 ≥ {threshold:.0f}%）\n\n" + "\n".join(lines) +
                   "\n\n建議確認是否有個股消息面變化。"])
        logger.info("Daily drop alert pushed: %d stock(s)", len(lines))


# ── 3. Net worth drawdown & new high (23:58 快照後) ──────────────────────────

def check_net_worth_alerts():
    if not _get_subscribers():
        return
    with get_db() as conn:
        snaps = conn.execute(
            "SELECT date, assets, liabilities FROM net_worth_snapshots ORDER BY date ASC"
        ).fetchall()
    if len(snaps) < 2:
        return

    nets = [(s["date"], s["assets"] - s["liabilities"]) for s in snaps]
    peak = max(n for _, n in nets)
    last_date, last_net = nets[-1]

    try:
        threshold = float(get_setting("alert_drawdown_pct") or 10)
    except (TypeError, ValueError):
        threshold = 10.0

    current_dd = (peak - last_net) / peak * 100 if peak > 0 else 0

    # Drawdown: push once when crossing the threshold; re-arm after recovering
    # to under half the threshold (hysteresis so it doesn't spam every day).
    state = get_setting("dd_alert_state") or "normal"
    if current_dd >= threshold and state != "alerted":
        _push_all([
            f"⚠️ 投組回撤警示\n\n"
            f"淨資產距高點回落 -{current_dd:.1f}%\n"
            f"（高點 NT${peak:,.0f} → 目前 NT${last_net:,.0f}）\n\n"
            f"建議檢視風險暴露頁確認部位。"
        ])
        set_setting("dd_alert_state", "alerted")
        logger.info("Drawdown alert pushed: -%.1f%%", current_dd)
    elif current_dd < threshold / 2 and state == "alerted":
        set_setting("dd_alert_state", "normal")

    # New high: today's snapshot is the peak; throttle to at most once / 7 days
    if last_net >= peak and peak > 0:
        last_push = get_setting("nw_high_last_push")
        ok = True
        if last_push:
            try:
                ok = (date.fromisoformat(last_date) - date.fromisoformat(last_push)).days >= 7
            except ValueError:
                ok = True
        if ok:
            _push_all([f"🎉 淨資產創新高\n\nNT${last_net:,.0f}（{last_date}）\n\n維持紀律，繼續前進。"])
            set_setting("nw_high_last_push", last_date)
            logger.info("New-high alert pushed: %s", last_net)


# ── 4. Missing stop-loss reminder (週一 09:00) ────────────────────────────────

def check_no_stop_loss_reminder():
    if not _get_subscribers():
        return
    with get_db() as conn:
        sl_map = {r["code"]: r["stop_loss"] for r in
                  conn.execute("SELECT code, stop_loss FROM tracked_stocks").fetchall()}
    names = _stock_names()
    missing = []
    for h in current_holdings():
        sl = sl_map.get(h["code"], "")
        try:
            has_sl = bool(sl) and float(sl) > 0
        except (ValueError, TypeError):
            has_sl = False
        if not has_sl:
            missing.append(h)
    if not missing:
        return
    lines = "\n".join(f"  • {h['code']} {names.get(h['code'], '')}"
                      f"　持股 {h['shares']:,.0f}　均價 {h['avgCost']:.2f}"
                      for h in missing)
    _push_all([f"🛡️ 停損檢查提醒\n\n以下持股尚未設定停損價：\n{lines}\n\n"
               f"未設停損的部位無法估算下檔風險，建議儘快補上。"])
    logger.info("No-stop-loss reminder pushed: %d stock(s)", len(missing))


# ── 5. Chip move alerts (19:00 平日) ─────────────────────────────────────────

_FOREIGN_LEVELS = (5, 10, 20)
_TRUST_LEVELS = (3, 5, 10)


def check_chip_alerts():
    if date.today().weekday() >= 5 or not _get_subscribers():
        return
    if not _once_per_day("chip_alert_last_sent"):
        return

    from routers.chips import _fetch_and_store, _query_institutional, _query_margin

    with get_db() as conn:
        tracked_codes = [r["code"] for r in
                         conn.execute("SELECT code FROM tracked_stocks").fetchall()]
    codes = list(dict.fromkeys(
        [h["code"] for h in current_holdings() if h["market"] == "tw"] + tracked_codes
    ))[:20]

    names = _stock_names()
    lines = []
    for code in codes:
        try:
            _fetch_and_store(code)
            inst = _query_institutional(code, 30)
            if inst:
                last = inst[-1]
                fs, fd = last.get("foreignStreak", 0), last.get("foreignDirection", "none")
                ts_, td = last.get("trustStreak", 0), last.get("trustDirection", "none")
                if fs in _FOREIGN_LEVELS and fd in ("buy", "sell"):
                    total = sum(r["foreign"] for r in inst[-fs:]) / 1000
                    lines.append(f"  • {code} {names.get(code, '')}　外資連 {fs} "
                                 f"{'買' if fd == 'buy' else '賣'}（累計 {total:+,.0f} 張）")
                if ts_ in _TRUST_LEVELS and td in ("buy", "sell"):
                    total = sum(r["trust"] for r in inst[-ts_:]) / 1000
                    lines.append(f"  • {code} {names.get(code, '')}　投信連 {ts_} "
                                 f"{'買' if td == 'buy' else '賣'}（累計 {total:+,.0f} 張）")
            margin = _query_margin(code, 5)
            if margin and margin[-1]["marginUsage"] >= 60:
                lines.append(f"  • {code} {names.get(code, '')}　融資使用率 "
                             f"{margin[-1]['marginUsage']:.0f}%（偏高）")
        except Exception as e:
            logger.warning("Chip alert fetch failed for %s: %s", code, e)

    if lines:
        _push_all(["📊 籌碼異動\n\n" + "\n".join(lines)])
        logger.info("Chip alert pushed: %d line(s)", len(lines))


# ── 6/7/8. Weekly report incl. overdue-signal review (週日 20:00) ────────────

def send_weekly_report():
    if not _get_subscribers():
        return

    today = date.today()
    week_ago = today - timedelta(days=7)
    next_week = today + timedelta(days=7)
    fx = _fx_rate()
    names = _stock_names()

    by_code, markets = load_trades_by_code()
    with get_db() as conn:
        closes = {r["code"]: r["close"] for r in
                  conn.execute("SELECT code, close FROM stocks WHERE close IS NOT NULL").fetchall()}
        snaps = conn.execute(
            "SELECT date, assets, liabilities FROM net_worth_snapshots ORDER BY date ASC"
        ).fetchall()
        old_signals = conn.execute(
            "SELECT code, source, condition_text, date FROM signals WHERE status='active'"
        ).fetchall()
        ex_next = conn.execute(
            "SELECT code, ex_date, cash_div FROM dividend_records "
            "WHERE ex_date > %s AND ex_date <= %s AND cash_div > 0 ORDER BY ex_date",
            (today.isoformat(), next_week.isoformat()),
        ).fetchall()

    # Portfolio snapshot + week realized PnL
    total_mv = total_cost = week_realized = 0.0
    perf: list[tuple[str, float]] = []
    for code, ts in by_code.items():
        mkt = markets.get(code, "tw")
        to_ntd = fx if mkt == "us" else 1
        f = calc_fifo(ts, mkt)
        for s in f["sells"]:
            if week_ago.isoformat() < s["date"] <= today.isoformat():
                week_realized += s["realized"] * to_ntd
        if f["holdingShares"] > 0:
            cost = f["avgCost"] * f["holdingShares"]
            total_cost += cost * to_ntd
            c = closes.get(code)
            if c:
                total_mv += c * f["holdingShares"] * to_ntd
                perf.append((code, (c - f["avgCost"]) / f["avgCost"] * 100))

    lines = [f"📊 每週投組報告（{today.isoformat()}）", ""]
    lines.append(f"持倉市值：NT${total_mv:,.0f}")
    if total_cost > 0 and total_mv > 0:
        pnl = total_mv - total_cost
        lines.append(f"未實現損益：{pnl:+,.0f}（{pnl / total_cost * 100:+.2f}%）")
    lines.append(f"本週已實現：{week_realized:+,.0f}")
    if perf:
        best = max(perf, key=lambda x: x[1])
        worst = min(perf, key=lambda x: x[1])
        lines.append(f"最佳持股：{best[0]} {names.get(best[0], '')} {best[1]:+.1f}%")
        lines.append(f"最差持股：{worst[0]} {names.get(worst[0], '')} {worst[1]:+.1f}%")

    if len(snaps) >= 2:
        nets = [s["assets"] - s["liabilities"] for s in snaps]
        peak = max(nets)
        if peak > 0:
            lines.append(f"目前回撤：-{(peak - nets[-1]) / peak * 100:.1f}%（距高點）")

    if ex_next:
        lines.append("")
        lines.append("下週除息：")
        for d in ex_next[:5]:
            lines.append(f"  • {d['ex_date'][5:]} {d['code']} 每股 NT${d['cash_div']}")

    overdue = [s for s in old_signals
               if s["date"] < (datetime.now().timestamp() - 30 * 86400) * 1000]
    if overdue:
        lines.append("")
        lines.append(f"⏳ {len(overdue)} 個有效訊號已超過 30 天未處理：")
        for s in overdue[:5]:
            cond = (s["condition_text"] or "")[:20]
            lines.append(f"  • {s['code']}（{s['source'] or '未標來源'}）{cond}")
        lines.append("建議至訊號總覽確認是否失效。")

    _push_all(["\n".join(lines)])
    logger.info("Weekly report pushed")


# ── 9. Monthly report (每月 1 日 09:30,結算上月) ─────────────────────────────

def send_monthly_report():
    if not _get_subscribers():
        return

    today = date.today()
    month_end = today.replace(day=1) - timedelta(days=1)
    month_start = month_end.replace(day=1)
    label = f"{month_start.year} 年 {month_start.month} 月"
    fx = _fx_rate()

    by_code, markets = load_trades_by_code()
    holdings_shares = {h["code"]: h["shares"] for h in current_holdings()}

    month_realized = 0.0
    for code, ts in by_code.items():
        mkt = markets.get(code, "tw")
        to_ntd = fx if mkt == "us" else 1
        for s in calc_fifo(ts, mkt)["sells"]:
            if month_start.isoformat() <= s["date"] <= month_end.isoformat():
                month_realized += s["realized"] * to_ntd

    with get_db() as conn:
        divs = conn.execute(
            "SELECT code, cash_div FROM dividend_records "
            "WHERE pay_date >= %s AND pay_date <= %s AND cash_div > 0",
            (month_start.isoformat(), month_end.isoformat()),
        ).fetchall()
        txns = conn.execute(
            "SELECT type, amount FROM account_transactions WHERE date >= %s AND date <= %s",
            (month_start.isoformat(), month_end.isoformat()),
        ).fetchall()
        loans = conn.execute(
            "SELECT name, periods, paid_periods FROM liabilities "
            "WHERE periods IS NOT NULL AND paid_periods IS NOT NULL"
        ).fetchall()
        snaps = conn.execute(
            "SELECT date, assets, liabilities FROM net_worth_snapshots "
            "WHERE date >= %s AND date <= %s ORDER BY date ASC",
            (month_start.isoformat(), month_end.isoformat()),
        ).fetchall()

    div_total = sum(d["cash_div"] * holdings_shares.get(d["code"], 0) for d in divs)
    deposits = sum(t["amount"] for t in txns if t["type"] == "deposit")
    withdrawals = sum(t["amount"] for t in txns if t["type"] == "withdrawal")

    lines = [f"🗓️ {label}結算", ""]
    lines.append(f"已實現損益：{month_realized:+,.0f}")
    if div_total > 0:
        lines.append(f"股息入帳：NT${div_total:,.0f}（以現持股估算）")
    lines.append(f"資金流：存入 NT${deposits:,.0f}／提出 NT${withdrawals:,.0f}")
    if len(snaps) >= 2:
        first = snaps[0]["assets"] - snaps[0]["liabilities"]
        last = snaps[-1]["assets"] - snaps[-1]["liabilities"]
        lines.append(f"淨資產變化：NT${first:,.0f} → NT${last:,.0f}（{last - first:+,.0f}）")
    if loans:
        lines.append("")
        lines.append("貸款進度：")
        for l in loans:
            remain = (l["periods"] or 0) - (l["paid_periods"] or 0)
            lines.append(f"  • {l['name']}：已繳 {l['paid_periods']}/{l['periods']} 期，剩 {remain} 期")

    _push_all(["\n".join(lines)])
    logger.info("Monthly report pushed")
