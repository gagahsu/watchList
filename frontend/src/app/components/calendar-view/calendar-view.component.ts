import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { StockService } from '../../services/stock.service';

interface CalEvent {
  type: 'credit-card' | 'loan' | 'fund' | 'dividend' | 'balance-alert';
  label: string;
  sublabel?: string;
  amount?: number;
  accountId?: string | null;
}

const META = {
  'credit-card':   { icon: '💳', color: '#e74c3c', bg: 'rgba(231,76,60,.18)',   text: '信用卡扣款' },
  'loan':          { icon: '🔔', color: '#e67e22', bg: 'rgba(230,126,34,.18)',  text: '貸款還款'   },
  'fund':          { icon: '🏦', color: '#3498db', bg: 'rgba(52,152,219,.18)',  text: '基金扣款'   },
  'dividend':      { icon: '💵', color: '#27ae60', bg: 'rgba(39,174,96,.18)',   text: '股息除息'   },
  'balance-alert': { icon: '⚠️', color: '#c0392b', bg: 'rgba(192,57,43,.22)',   text: '餘額警示'   },
} as const;

@Component({
  selector: 'app-calendar-view',
  template: `
<!-- Summary strip -->
<div class="cal-summary">
  <div class="cal-sum-card">
    <div class="cal-sum-label">信用卡扣款</div>
    <div class="cal-sum-val">{{ state.creditCards().length || '—' }} 張</div>
  </div>
  <div class="cal-sum-card">
    <div class="cal-sum-label">貸款還款 / 月</div>
    <div class="cal-sum-val neg">{{ fmtNT(totalLoan()) }}</div>
  </div>
  <div class="cal-sum-card">
    <div class="cal-sum-label">基金扣款 / 月</div>
    <div class="cal-sum-val neg">{{ fmtNT(totalFund()) }}</div>
  </div>
  <div class="cal-sum-card">
    <div class="cal-sum-label">{{ year() }}年{{ month() + 1 }}月股息除息</div>
    <div class="cal-sum-val pos">{{ monthDivCount() || '—' }} 檔</div>
  </div>
</div>

<!-- Header -->
<div class="cal-header">
  <button class="cal-nav-btn" (click)="prevMonth()">‹</button>
  <div class="cal-title">
    {{ year() }} 年 {{ month() + 1 }} 月
    <button class="cal-today-btn" (click)="goToday()">今天</button>
  </div>
  <button class="cal-nav-btn" (click)="nextMonth()">›</button>
</div>

<!-- Grid -->
<div class="cal-grid">
  @for (w of WEEKDAYS; track w; let wi = $index) {
    <div class="cal-wday" [class.cal-wday-weekend]="wi === 0 || wi === 6">{{ w }}</div>
  }
  @for (cell of calDays(); track $index; let ci = $index) {
    <div class="cal-cell"
      [class.cal-cell-other]="!cell.curr"
      [class.cal-cell-today]="isToday(cell.day, cell.curr)"
      [class.cal-cell-selected]="cell.curr && selectedDay() === cell.day"
      (click)="selectDay(cell.day, cell.curr)">
      <div class="cal-day-num"
        [class.cal-day-weekend]="(ci % 7 === 0 || ci % 7 === 6) && cell.curr"
        [class.cal-day-today]="isToday(cell.day, cell.curr)">
        {{ cell.day }}
      </div>
      @if (cell.curr) {
        @for (ev of eventsForDay(cell.day).slice(0, 3); track $index) {
          <div class="cal-ev-pill"
            [style.background]="META[ev.type].bg"
            [style.color]="META[ev.type].color">
            {{ META[ev.type].icon }} {{ ev.label }}
          </div>
        }
        @if (eventsForDay(cell.day).length > 3) {
          <div class="cal-ev-more">+{{ eventsForDay(cell.day).length - 3 }} 更多</div>
        }
      }
    </div>
  }
</div>

<!-- Legend -->
<div class="cal-legend">
  @for (e of LEGEND; track e.type) {
    <span class="cal-legend-item">
      <span class="cal-legend-dot" [style.background]="e.color"></span>{{ e.text }}
    </span>
  }
</div>

<!-- Detail panel -->
@if (selectedDay() !== null) {
  <div class="cal-detail">
    <div class="cal-detail-header">
      {{ year() }} 年 {{ month() + 1 }} 月 {{ selectedDay() }} 日
    </div>
    @if (selectedEvents().length === 0) {
      <div class="cal-detail-empty">當日無排程事件</div>
    } @else {
      @for (ev of selectedEvents(); track $index) {
        <div class="cal-detail-row">
          <span class="cal-detail-icon">{{ META[ev.type].icon }}</span>
          <div class="cal-detail-info">
            <span class="cal-detail-label">{{ ev.label }}</span>
            <span class="cal-detail-sub">
              {{ META[ev.type].text }}{{ ev.sublabel ? ' · ' + ev.sublabel : '' }}
              @if (ev.accountId) {
                &nbsp;·&nbsp;<span class="cal-acct-tag">{{ accountName(ev.accountId) }}</span>
              }
            </span>
          </div>
          @if (ev.amount != null) {
            <span class="cal-detail-amt"
              [class.pos]="ev.type === 'dividend'"
              [class.neg]="ev.type !== 'dividend'">
              {{ fmtNT(ev.amount) }}
            </span>
          }
        </div>
      }
    }

    <!-- Per-account deduction summary -->
    @if (selectedAccountTotals().length > 0) {
      <div class="cal-acct-summary">
        <div class="cal-acct-summary-title">💳 帳戶扣款彙總</div>
        @for (row of selectedAccountTotals(); track row.accountId) {
          <div class="cal-acct-summary-row">
            <span class="cal-acct-name">{{ row.name }}</span>
            <span class="cal-acct-amt neg">{{ fmtNT(row.total) }}</span>
          </div>
        }
      </div>
    }
  </div>
}
  `,
  styles: [`
    .cal-summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    @media (max-width: 640px) { .cal-summary { grid-template-columns: repeat(2, 1fr); } }
    .cal-sum-card {
      background: var(--panel-bg);
      border: 1.5px solid var(--border);
      border-radius: 10px;
      padding: 12px 16px;
    }
    .cal-sum-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
    .cal-sum-val {
      font-size: 16px; font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text);
    }

    .cal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
    }
    .cal-nav-btn {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 8px; color: var(--text);
      font-size: 22px; width: 36px; height: 36px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: border-color .12s;
    }
    .cal-nav-btn:hover { border-color: var(--gold); }
    .cal-title {
      display: flex; align-items: center; gap: 12px;
      font-size: 17px; font-weight: 700; color: var(--text);
    }
    .cal-today-btn {
      font-size: 12px; padding: 3px 10px;
      border: 1px solid var(--border); border-radius: 5px;
      background: none; color: var(--text-muted); cursor: pointer;
      transition: border-color .12s, color .12s;
    }
    .cal-today-btn:hover { border-color: var(--gold); color: var(--gold); }

    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 3px;
    }
    .cal-wday {
      text-align: center; font-size: 12px; font-weight: 600;
      color: var(--text-muted); padding: 6px 0;
    }
    .cal-wday-weekend { color: #e74c3c; }

    .cal-cell {
      min-height: 82px;
      border-radius: 7px;
      border: 1px solid transparent;
      padding: 6px 5px;
      cursor: pointer;
      background: var(--panel-bg);
      transition: border-color .12s, background .12s;
      overflow: hidden;
    }
    .cal-cell-other { background: transparent; cursor: default; opacity: .35; }
    .cal-cell:not(.cal-cell-other):hover { border-color: var(--border); }
    .cal-cell-today {
      border-color: rgba(212,160,23,.5) !important;
      background: rgba(212,160,23,.06) !important;
    }
    .cal-cell-selected {
      border-color: var(--gold, #d4a017) !important;
      background: rgba(212,160,23,.12) !important;
    }

    .cal-day-num {
      font-size: 12px; font-weight: 600; color: var(--text-muted);
      margin-bottom: 4px; line-height: 1;
    }
    .cal-cell:not(.cal-cell-other) .cal-day-num { color: var(--text); }
    .cal-day-weekend { color: #e74c3c !important; }
    .cal-day-today {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%;
      background: var(--gold, #d4a017); color: #000 !important;
      font-size: 11px; font-weight: 700;
    }

    .cal-ev-pill {
      font-size: 10px; font-weight: 600;
      border-radius: 4px; padding: 2px 5px;
      margin-bottom: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 100%;
    }
    .cal-ev-more { font-size: 10px; color: var(--text-muted); padding-left: 1px; }

    .cal-legend {
      display: flex; flex-wrap: wrap; gap: 16px;
      margin-top: 10px; padding: 6px 2px;
    }
    .cal-legend-item {
      display: flex; align-items: center; gap: 5px;
      font-size: 11px; color: var(--text-muted);
    }
    .cal-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

    .cal-detail {
      margin-top: 16px;
      background: var(--panel-bg);
      border: 1.5px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .cal-detail-header {
      padding: 12px 18px;
      font-size: 14px; font-weight: 700; color: var(--text);
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,.03);
    }
    .cal-detail-empty { padding: 16px 18px; font-size: 13px; color: var(--text-muted); }
    .cal-detail-row {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 18px;
      border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .cal-detail-row:last-child { border-bottom: none; }
    .cal-detail-icon { font-size: 18px; flex-shrink: 0; }
    .cal-detail-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cal-detail-label { font-size: 14px; font-weight: 600; color: var(--text); }
    .cal-detail-sub { font-size: 11px; color: var(--text-muted); }
    .cal-detail-amt {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px; font-weight: 700; flex-shrink: 0;
    }
    .cal-acct-tag {
      display: inline-block;
      font-size: 10px; font-weight: 600;
      background: rgba(52,152,219,.12); color: #3498db;
      border: 1px solid rgba(52,152,219,.3); border-radius: 4px;
      padding: 0 5px; font-family: 'JetBrains Mono', monospace;
    }
    .cal-acct-summary {
      border-top: 1px solid var(--border);
      margin: 4px 0 0;
      padding: 12px 18px;
      background: rgba(52,152,219,.04);
    }
    .cal-acct-summary-title {
      font-size: 11px; font-weight: 700; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px;
    }
    .cal-acct-summary-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 13px; padding: 3px 0;
    }
    .cal-acct-name { color: var(--text); }
    .cal-acct-amt  { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
    .pos { color: var(--green, #27ae60); }
    .neg { color: var(--red, #e74c3c); }
  `],
})
export class CalendarViewComponent {
  readonly WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  readonly META = META;
  readonly LEGEND = (Object.keys(META) as (keyof typeof META)[]).map(k => ({ type: k, ...META[k] }));

  year        = signal(new Date().getFullYear());
  month       = signal(new Date().getMonth());
  selectedDay = signal<number | null>(null);

  constructor(public state: AppStateService, private stock: StockService) {}

  prevMonth() {
    if (this.month() === 0) { this.year.update(y => y - 1); this.month.set(11); }
    else this.month.update(m => m - 1);
    this.selectedDay.set(null);
  }
  nextMonth() {
    if (this.month() === 11) { this.year.update(y => y + 1); this.month.set(0); }
    else this.month.update(m => m + 1);
    this.selectedDay.set(null);
  }
  goToday() {
    const n = new Date();
    this.year.set(n.getFullYear()); this.month.set(n.getMonth()); this.selectedDay.set(n.getDate());
  }

  isToday(day: number, curr: boolean) {
    if (!curr) return false;
    const n = new Date();
    return n.getFullYear() === this.year() && n.getMonth() === this.month() && n.getDate() === day;
  }

  selectDay(day: number, curr: boolean) {
    if (!curr) return;
    this.selectedDay.update(prev => prev === day ? null : day);
  }

  calDays = computed(() => {
    const y = this.year(), m = this.month();
    const firstDay     = new Date(y, m, 1).getDay();
    const daysInMonth  = new Date(y, m + 1, 0).getDate();
    const daysInPrev   = new Date(y, m, 0).getDate();
    const cells: { day: number; curr: boolean }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, curr: false });
    for (let d = 1; d <= daysInMonth; d++)  cells.push({ day: d, curr: true });
    for (let d = 1; cells.length < 42; d++) cells.push({ day: d, curr: false });
    return cells;
  });

  eventsMap = computed(() => {
    const y = this.year(), m = this.month();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const map = new Map<number, CalEvent[]>();

    const push = (rawDay: number, ev: CalEvent) => {
      const d = Math.min(Math.max(rawDay, 1), lastDay);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(ev);
    };

    for (const c of this.state.creditCards()) {
      push(c.paymentDay, { type: 'credit-card', label: c.name, sublabel: c.note || undefined });
    }
    for (const l of this.state.liabilities()) {
      if (!l.reminderEnabled || !l.reminderDay) continue;
      push(l.reminderDay, { type: 'loan', label: l.name, amount: l.monthlyPayment ?? undefined, accountId: l.accountId });
    }
    for (const f of this.state.funds()) {
      for (const s of f.schedules) {
        push(s.dayOfMonth, { type: 'fund', label: f.name, amount: s.amount });
      }
    }
    const nameMap = this.stock.codeToName();
    for (const d of this.state.dividends()) {
      const dt = new Date(d.exDate + 'T00:00:00');
      if (dt.getFullYear() === y && dt.getMonth() === m) {
        push(dt.getDate(), {
          type: 'dividend',
          label: `${d.code} ${nameMap[d.code] ?? ''}`.trim(),
          sublabel: `每股 NT$${d.cashDiv}`,
        });
      }
    }

    // ── Balance-alert: warn on D-1 if account balance won't cover D's deductions ──
    // Collect deductions by day → accountId → total
    const dedByDay = new Map<number, Map<string, number>>();
    const addDed = (rawDay: number, accountId: string, amt: number) => {
      const d = Math.min(Math.max(rawDay, 1), lastDay);
      if (!dedByDay.has(d)) dedByDay.set(d, new Map());
      const m2 = dedByDay.get(d)!;
      m2.set(accountId, (m2.get(accountId) ?? 0) + amt);
    };
    for (const l of this.state.liabilities()) {
      if (!l.reminderEnabled || !l.reminderDay || !l.accountId || !l.monthlyPayment) continue;
      addDed(l.reminderDay, l.accountId, l.monthlyPayment);
    }
    const accounts = this.state.accounts();
    for (const [day, acctMap] of dedByDay) {
      if (day <= 1) continue;   // can't warn on previous month's day
      const warnDay = day - 1;
      for (const [accountId, totalDue] of acctMap) {
        const acct = accounts.find(a => a.id === accountId);
        if (!acct) continue;
        if (acct.balance < totalDue) {
          const shortfall = totalDue - acct.balance;
          push(warnDay, {
            type: 'balance-alert',
            label: `${acct.name} 餘額不足`,
            sublabel: `明日扣 NT$${Math.round(totalDue).toLocaleString()}，缺 NT$${Math.round(shortfall).toLocaleString()}`,
            amount: shortfall,
            accountId,
          });
        }
      }
    }

    return map;
  });

  eventsForDay(day: number): CalEvent[] { return this.eventsMap().get(day) ?? []; }

  selectedEvents = computed(() => {
    const d = this.selectedDay();
    return d != null ? (this.eventsMap().get(d) ?? []) : [];
  });

  selectedAccountTotals = computed(() => {
    const evs = this.selectedEvents();
    const map = new Map<string, number>();
    for (const ev of evs) {
      if (!ev.accountId || ev.type === 'dividend' || ev.amount == null) continue;
      map.set(ev.accountId, (map.get(ev.accountId) ?? 0) + ev.amount);
    }
    return Array.from(map.entries()).map(([accountId, total]) => ({
      accountId, total, name: this.accountName(accountId),
    }));
  });

  accountName(id: string) {
    return this.state.accounts().find(a => a.id === id)?.name ?? id;
  }

  totalLoan = computed(() =>
    this.state.liabilities()
      .filter(l => l.reminderEnabled && l.reminderDay)
      .reduce((s, l) => s + (l.monthlyPayment ?? 0), 0)
  );
  totalFund = computed(() =>
    this.state.funds().flatMap(f => f.schedules).reduce((s, sc) => s + sc.amount, 0)
  );
  monthDivCount = computed(() => {
    const y = this.year(), m = this.month();
    return this.state.dividends().filter(d => {
      const dt = new Date(d.exDate + 'T00:00:00');
      return dt.getFullYear() === y && dt.getMonth() === m;
    }).length;
  });

  fmtNT(n: number) { return n ? `NT$${Math.round(n).toLocaleString()}` : '—'; }
}
