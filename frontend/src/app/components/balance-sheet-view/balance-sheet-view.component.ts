import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { Liability } from '../../models/types';
import { calcFIFO, uid } from '../../utils';

const LIABILITY_TYPES = ['房貸', '車貸', '信用貸款', '信用卡', '學貸', '其他'];
const LOAN_TYPES = new Set(['房貸', '車貸', '信用貸款', '學貸']);
const TYPE_ICON: Record<string, string> = {
  '房貸': '🏠', '車貸': '🚗', '信用貸款': '🏦', '信用卡': '💳', '學貸': '🎓', '其他': '📋',
};

function isReminderToday(l: Liability): boolean {
  if (!l.reminderEnabled || !l.reminderDay) return false;
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() === Math.min(l.reminderDay, lastDay);
}

@Component({
  selector: 'app-balance-sheet-view',
  template: `
@let totalAssets = assetTotal();
@let totalLiab   = liabilityTotal();
@let netWorth    = totalAssets - totalLiab;

<!-- ── Summary ─────────────────────────────────────── -->
<div class="bs-summary">
  <div class="bs-summary-card">
    <div class="bs-label">總資產</div>
    <div class="bs-value">{{ fmtNT(totalAssets) }}</div>
  </div>
  <div class="bs-summary-card bs-liab-card">
    <div class="bs-label">總負債</div>
    <div class="bs-value text-danger">{{ fmtNT(totalLiab) }}</div>
  </div>
  <div class="bs-summary-card" [class.pnl-pos]="netWorth >= 0" [class.pnl-neg]="netWorth < 0">
    <div class="bs-label">淨資產</div>
    <div class="bs-value" [class.pos]="netWorth >= 0" [class.neg]="netWorth < 0">
      {{ fmtNT(netWorth) }}
    </div>
  </div>
</div>

<!-- ── Asset cards ─────────────────────────────────── -->
<div class="bs-group-title">資產</div>
<div class="bs-card-grid">
  <div class="bs-card">
    <div class="bs-card-icon">💰</div>
    <div class="bs-card-name">現金帳戶</div>
    <div class="bs-card-amount">{{ fmtNT(cashTotal()) }}</div>
    <div class="bs-card-sub">{{ state.accounts().length }} 個帳戶</div>
    <button class="bs-card-btn" (click)="goAccounts()">管理帳戶 →</button>
  </div>
  <div class="bs-card">
    <div class="bs-card-icon">📈</div>
    <div class="bs-card-name">持股市值</div>
    <div class="bs-card-amount">{{ fmtNT(stockTotal()) }}</div>
    <div class="bs-card-sub">{{ holdingRows().length }} 支股票</div>
    @if (holdingRows().some(h => h.mv === null)) {
      <div class="bs-card-warn">部分持股市價未知</div>
    }
  </div>
</div>

<!-- ── Liability cards ─────────────────────────────── -->
<div class="bs-group-header">
  <div class="bs-group-title">負債</div>
  <button class="idx-add-btn" (click)="startNew()">＋ 新增負債</button>
</div>

@if (state.liabilities().length === 0 && !showAddForm()) {
  <div class="bs-empty">尚無負債記錄</div>
} @else {
  <div class="bs-card-grid">
    @for (grp of liabilityGroups(); track grp.type) {
      <div class="bs-card bs-card-liab" [class.bs-card-alert]="grp.hasAlert">
        <div class="bs-card-icon">{{ typeIcon(grp.type) }}</div>
        <div class="bs-card-name">
          {{ grp.type }}
          @if (grp.hasAlert) { <span class="bs-alert-dot">🔔</span> }
        </div>
        <div class="bs-card-amount text-danger">{{ fmtNT(grp.total) }}</div>
        <div class="bs-card-sub">{{ grp.count }} 筆</div>
        <button class="bs-card-btn" (click)="toggleType(grp.type)">
          {{ expandedType() === grp.type ? '收合 ▲' : '明細 ▼' }}
        </button>
      </div>
    }
  </div>

  <!-- expanded detail for selected type -->
  @if (expandedType()) {
    <div class="bs-detail-panel">
      @for (l of liabilitiesOfType(expandedType()!); track l.id) {
        @let isAlert = isReminderToday(l);
        @if (editId() === l.id) {
          <div class="bs-edit-form" [class.bs-reminder-alert]="isAlert">
            <div class="broker-form-row">
              <div class="broker-form-group" style="flex:2">
                <div class="modal-label">名稱</div>
                <input class="modal-input" [value]="editF.name" (input)="editF.name=asStr($event)" />
              </div>
              <div class="broker-form-group" style="flex:1">
                <div class="modal-label">類型</div>
                <select class="trade-form-select" (change)="editF.type=asStr($event)">
                  @for (t of liabilityTypes; track t) {
                    <option [value]="t" [selected]="editF.type===t">{{ t }}</option>
                  }
                </select>
              </div>
            </div>
            <div class="broker-form-row">
              <div class="broker-form-group" style="flex:1">
                <div class="modal-label">{{ isLoanType(editF.type) ? '未償餘額' : '金額' }}</div>
                <input class="modal-input" type="number" step="1" min="0"
                  [value]="editF.amount" (input)="editF.amount=toNum($event)" />
              </div>
              <div class="broker-form-group" style="flex:2">
                <div class="modal-label">備註</div>
                <input class="modal-input" [value]="editF.note" (input)="editF.note=asStr($event)" />
              </div>
            </div>
            @if (isLoanType(editF.type)) {
              <div class="bs-loan-divider">貸款明細</div>
              <div class="broker-form-row">
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">貸款總額</div>
                  <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
                    [value]="editF.totalAmount ?? ''" (input)="editF.totalAmount=toNumOrNull($event)" />
                </div>
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">年利率 (%)</div>
                  <input class="modal-input" type="number" step="0.01" min="0" placeholder="選填"
                    [value]="editF.interestRate ?? ''" (input)="editF.interestRate=toNumOrNull($event)" />
                </div>
              </div>
              <div class="broker-form-row">
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">總期數 (月)</div>
                  <input class="modal-input" type="number" step="1" min="1" placeholder="選填"
                    [value]="editF.periods ?? ''" (input)="editF.periods=toIntOrNull($event)" />
                </div>
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">已還期數</div>
                  <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
                    [value]="editF.paidPeriods ?? ''" (input)="editF.paidPeriods=toIntOrNull($event)" />
                </div>
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">每月還款</div>
                  <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
                    [value]="editF.monthlyPayment ?? ''" (input)="editF.monthlyPayment=toNumOrNull($event)" />
                </div>
              </div>
            }
            <div class="broker-form-row" style="align-items:flex-end;margin-top:4px">
              <div class="broker-form-group" style="flex:0 0 auto">
                <div class="modal-label">提醒</div>
                <label class="bs-toggle">
                  <input type="checkbox" [checked]="editF.reminderEnabled"
                    (change)="editF.reminderEnabled=asChecked($event)" />
                  <span class="bs-toggle-label">開啟提醒</span>
                </label>
              </div>
              @if (editF.reminderEnabled) {
                <div class="broker-form-group" style="flex:1">
                  <div class="modal-label">每月幾號 (1–31)</div>
                  <input class="modal-input" type="number" min="1" max="31" step="1"
                    [value]="editF.reminderDay" (input)="editF.reminderDay=toInt($event)" />
                </div>
              }
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-primary" style="flex:1" (click)="saveEdit(l.id)">儲存</button>
              <button class="btn-cancel" (click)="editId.set(null)">取消</button>
            </div>
          </div>
        } @else {
          <div class="bs-detail-row" [class.bs-reminder-alert]="isAlert">
            <div class="bs-detail-info">
              <div class="bs-detail-name">
                @if (isAlert) { <span class="bs-alert-badge">🔔</span> }
                {{ l.name }}
                @if (l.reminderEnabled && l.reminderDay) {
                  <span class="bs-reminder-tag" [class.bs-reminder-tag-due]="isAlert">每月{{ l.reminderDay }}號</span>
                }
              </div>
              @if (l.note) { <div class="bs-detail-note">{{ l.note }}</div> }
              @if (isLoanType(l.type) && l.periods && l.paidPeriods != null) {
                <div class="bs-progress-bar" style="margin-top:6px">
                  <div class="bs-progress-fill" [style.width.%]="progressPct(l.paidPeriods, l.periods)"></div>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">{{ l.paidPeriods }}/{{ l.periods }} 期</div>
              }
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <span class="bs-detail-amount text-danger">{{ fmtNT(l.amount) }}</span>
              <button class="sig-action-btn" (click)="startEdit(l)">編輯</button>
              <button class="sig-action-btn danger" (click)="deleteLiability(l.id)">刪除</button>
            </div>
          </div>
        }
      }
    </div>
  }
}

<!-- ── Add form ─────────────────────────────────────── -->
@if (showAddForm()) {
  <div class="bs-edit-form" style="margin-top:12px">
    <div class="broker-form-row">
      <div class="broker-form-group" style="flex:2">
        <div class="modal-label">名稱</div>
        <input class="modal-input" placeholder="如：玉山房貸、信用卡帳單"
          [value]="newF.name" (input)="newF.name=asStr($event)" autofocus />
      </div>
      <div class="broker-form-group" style="flex:1">
        <div class="modal-label">類型</div>
        <select class="trade-form-select" (change)="newF.type=asStr($event)">
          @for (t of liabilityTypes; track t) {
            <option [value]="t" [selected]="newF.type===t">{{ t }}</option>
          }
        </select>
      </div>
    </div>
    <div class="broker-form-row">
      <div class="broker-form-group" style="flex:1">
        <div class="modal-label">{{ isLoanType(newF.type) ? '未償餘額' : '金額' }}</div>
        <input class="modal-input" type="number" step="1" min="0" placeholder="如：5000000"
          [value]="newF.amount" (input)="newF.amount=toNum($event)" />
      </div>
      <div class="broker-form-group" style="flex:2">
        <div class="modal-label">備註 (選填)</div>
        <input class="modal-input" placeholder="如：玉山銀行"
          [value]="newF.note" (input)="newF.note=asStr($event)" />
      </div>
    </div>
    @if (isLoanType(newF.type)) {
      <div class="bs-loan-divider">貸款明細</div>
      <div class="broker-form-row">
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">貸款總額</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
            [value]="newF.totalAmount ?? ''" (input)="newF.totalAmount=toNumOrNull($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">年利率 (%)</div>
          <input class="modal-input" type="number" step="0.01" min="0" placeholder="選填"
            [value]="newF.interestRate ?? ''" (input)="newF.interestRate=toNumOrNull($event)" />
        </div>
      </div>
      <div class="broker-form-row">
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">總期數 (月)</div>
          <input class="modal-input" type="number" step="1" min="1" placeholder="選填"
            [value]="newF.periods ?? ''" (input)="newF.periods=toIntOrNull($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">已還期數</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
            [value]="newF.paidPeriods ?? ''" (input)="newF.paidPeriods=toIntOrNull($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">每月還款</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="選填"
            [value]="newF.monthlyPayment ?? ''" (input)="newF.monthlyPayment=toNumOrNull($event)" />
        </div>
      </div>
    }
    <div class="broker-form-row" style="align-items:flex-end;margin-top:4px">
      <div class="broker-form-group" style="flex:0 0 auto">
        <div class="modal-label">提醒</div>
        <label class="bs-toggle">
          <input type="checkbox" [checked]="newF.reminderEnabled"
            (change)="newF.reminderEnabled=asChecked($event)" />
          <span class="bs-toggle-label">開啟提醒</span>
        </label>
      </div>
      @if (newF.reminderEnabled) {
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">每月幾號 (1–31)</div>
          <input class="modal-input" type="number" min="1" max="31" step="1"
            [value]="newF.reminderDay" (input)="newF.reminderDay=toInt($event)" />
        </div>
      }
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-primary" style="flex:1" (click)="saveNew()">新增</button>
      <button class="btn-cancel" (click)="showAddForm.set(false)">取消</button>
    </div>
  </div>
}
  `,
  styles: [`
    /* summary */
    .bs-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:24px; }
    .bs-summary-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px 16px; }
    .bs-liab-card { border-color:rgba(192,57,43,.25); }
    .bs-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
    .bs-value { font-size:20px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    /* group title */
    .bs-group-title { font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
    .bs-group-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; margin-top:24px; }
    .bs-group-header .bs-group-title { margin-bottom:0; }
    /* cards */
    .bs-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; margin-bottom:20px; }
    .bs-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:4px; }
    .bs-card-liab { border-color:rgba(192,57,43,.15); }
    .bs-card-alert { border-color:rgba(192,57,43,.5); background:rgba(192,57,43,.04); }
    .bs-card-icon { font-size:22px; margin-bottom:4px; }
    .bs-card-name { font-size:13px; font-weight:700; color:var(--text); display:flex; align-items:center; gap:5px; }
    .bs-card-amount { font-size:17px; font-weight:700; font-family:'JetBrains Mono',monospace; margin-top:4px; }
    .bs-card-sub { font-size:12px; color:var(--text-muted); }
    .bs-card-warn { font-size:11px; color:var(--text-muted); font-style:italic; }
    .bs-card-btn { margin-top:10px; font-size:12px; color:var(--gold); background:none; border:none; padding:0; cursor:pointer; text-align:left; }
    .bs-card-btn:hover { text-decoration:underline; }
    .bs-alert-dot { font-size:13px; }
    /* detail panel */
    .bs-detail-panel { background:var(--sidebar-bg); border:1px solid var(--border); border-radius:8px; padding:4px 0; margin-bottom:16px; }
    .bs-detail-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border); }
    .bs-detail-row:last-of-type { border-bottom:none; }
    .bs-detail-info { flex:1; min-width:0; }
    .bs-detail-name { font-size:14px; font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .bs-detail-note { font-size:12px; color:var(--text-muted); margin-top:3px; }
    .bs-detail-amount { font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700; white-space:nowrap; }
    /* misc */
    .bs-empty { text-align:center; color:var(--text-muted); font-size:14px; padding:20px 0; }
    .bs-edit-form { background:var(--sidebar-bg); border:1px solid var(--border); border-radius:8px; padding:14px; margin:8px 0; }
    .bs-reminder-tag { font-size:11px; background:var(--tracking-bg); color:var(--text-muted); border:1px solid var(--border); border-radius:4px; padding:1px 6px; font-family:'JetBrains Mono',monospace; }
    .bs-reminder-tag-due { background:rgba(192,57,43,.12); color:var(--red); border-color:rgba(192,57,43,.3); }
    .bs-reminder-alert { border-left:3px solid var(--red,#c0392b); }
    .bs-alert-badge { font-size:12px; font-weight:700; color:var(--red,#c0392b); }
    .bs-loan-divider { font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin:10px 0 6px; padding-top:8px; border-top:1px solid var(--border); }
    .bs-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; margin-top:6px; }
    .bs-toggle input { width:16px; height:16px; cursor:pointer; accent-color:var(--gold); }
    .bs-toggle-label { font-size:14px; }
    .bs-progress-bar { height:4px; background:var(--border); border-radius:2px; overflow:hidden; }
    .bs-progress-fill { height:100%; background:var(--gold); border-radius:2px; }
    .text-danger { color:var(--red,#c0392b); }
    @media (max-width:600px) {
      .bs-summary { grid-template-columns:1fr 1fr; }
      .bs-summary-card:last-child { grid-column:1/-1; }
      .bs-card-grid { grid-template-columns:1fr 1fr; }
    }
  `],
})
export class BalanceSheetViewComponent {
  liabilityTypes  = LIABILITY_TYPES;
  isLoanType      = (t: string) => LOAN_TYPES.has(t);
  typeIcon        = (t: string) => TYPE_ICON[t] ?? '📋';
  isReminderToday = isReminderToday;

  showAddForm  = signal(false);
  editId       = signal<string | null>(null);
  expandedType = signal<string | null>(null);
  newF  = this.blankForm();
  editF = this.blankForm();

  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  blankForm() {
    return {
      name: '', type: '其他', amount: 0, note: '',
      reminderEnabled: false, reminderDay: 1,
      totalAmount: null as number | null,
      periods: null as number | null,
      paidPeriods: null as number | null,
      interestRate: null as number | null,
      monthlyPayment: null as number | null,
    };
  }

  asStr(e: Event)       { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  toNum(e: Event)       { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  toInt(e: Event)       { return parseInt((e.target as HTMLInputElement).value, 10) || 1; }
  toNumOrNull(e: Event) { const v = parseFloat((e.target as HTMLInputElement).value); return isNaN(v) || v === 0 ? null : v; }
  toIntOrNull(e: Event) { const v = parseInt((e.target as HTMLInputElement).value, 10); return isNaN(v) || v === 0 ? null : v; }
  asChecked(e: Event)   { return (e.target as HTMLInputElement).checked; }

  fmtNT(n: number) {
    return `NT$${Math.round(Math.abs(n)).toLocaleString()}`;
  }

  progressPct(paid: number, total: number) {
    return Math.min(100, Math.round((paid / total) * 100));
  }

  holdingRows = computed(() => {
    const trades = this.state.trades();
    const markets = this.state.tradeMarkets();
    const closeMap = this.stock.closeMap();
    const nameMap = this.stock.codeToName();
    return Object.entries(trades)
      .map(([code, ts]) => {
        const mkt = markets[code] ?? 'tw';
        const fifo = calcFIFO(ts, mkt);
        if (fifo.holdingShares <= 0) return null;
        const price = closeMap[code]?.close ?? null;
        return { code, name: nameMap[code] ?? '', shares: fifo.holdingShares, price, mv: price !== null ? price * fifo.holdingShares : null };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  });

  cashTotal  = computed(() => this.state.accounts().reduce((s, a) => s + a.balance, 0));
  stockTotal = computed(() => this.holdingRows().reduce((s, h) => s + (h.mv ?? 0), 0));
  assetTotal = computed(() => this.cashTotal() + this.stockTotal());
  liabilityTotal = computed(() => this.state.liabilities().reduce((s, l) => s + l.amount, 0));

  liabilityGroups = computed(() => {
    const map = new Map<string, { total: number; count: number; hasAlert: boolean }>();
    for (const l of this.state.liabilities()) {
      const g = map.get(l.type) ?? { total: 0, count: 0, hasAlert: false };
      g.total += l.amount;
      g.count += 1;
      if (isReminderToday(l)) g.hasAlert = true;
      map.set(l.type, g);
    }
    return Array.from(map.entries()).map(([type, g]) => ({ type, ...g }));
  });

  liabilitiesOfType(type: string) {
    return this.state.liabilities().filter(l => l.type === type);
  }

  toggleType(type: string) {
    this.expandedType.update(t => t === type ? null : type);
    this.editId.set(null);
  }

  goAccounts() { this.state.view.set('accounts'); }

  startNew() { this.newF = this.blankForm(); this.showAddForm.set(true); this.editId.set(null); }

  async saveNew() {
    if (!this.newF.name.trim()) return;
    const l: Liability = {
      id: uid(), name: this.newF.name.trim(), type: this.newF.type,
      amount: this.newF.amount,
      reminderEnabled: this.newF.reminderEnabled,
      reminderDay: this.newF.reminderEnabled ? this.newF.reminderDay : null,
      note: this.newF.note.trim(),
      totalAmount: this.newF.totalAmount, periods: this.newF.periods,
      paidPeriods: this.newF.paidPeriods, interestRate: this.newF.interestRate,
      monthlyPayment: this.newF.monthlyPayment,
    };
    const saved = await this.api.createLiability(l);
    this.state.addLiability(saved);
    this.showAddForm.set(false);
    this.expandedType.set(saved.type);
  }

  startEdit(l: Liability) {
    this.editF = {
      name: l.name, type: l.type, amount: l.amount, note: l.note,
      reminderEnabled: l.reminderEnabled, reminderDay: l.reminderDay ?? 1,
      totalAmount: l.totalAmount, periods: l.periods,
      paidPeriods: l.paidPeriods, interestRate: l.interestRate,
      monthlyPayment: l.monthlyPayment,
    };
    this.editId.set(l.id);
    this.showAddForm.set(false);
  }

  async saveEdit(id: string) {
    const updated = await this.api.patchLiability(id, {
      name: this.editF.name.trim(), type: this.editF.type,
      amount: this.editF.amount,
      reminderEnabled: this.editF.reminderEnabled,
      reminderDay: this.editF.reminderEnabled ? this.editF.reminderDay : null,
      note: this.editF.note.trim(),
      totalAmount: this.editF.totalAmount, periods: this.editF.periods,
      paidPeriods: this.editF.paidPeriods, interestRate: this.editF.interestRate,
      monthlyPayment: this.editF.monthlyPayment,
    });
    this.state.updateLiability(updated);
    this.editId.set(null);
  }

  async deleteLiability(id: string) {
    await this.api.deleteLiability(id);
    this.state.removeLiability(id);
  }
}
