import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { Liability } from '../../models/types';
import { calcFIFO, uid } from '../../utils';

const LIABILITY_TYPES = ['房貸', '車貸', '信用貸款', '信用卡', '學貸', '其他'];
const LOAN_TYPES = new Set(['房貸', '車貸', '信用貸款', '學貸']);

function isReminderToday(l: Liability): boolean {
  if (!l.reminderEnabled || !l.reminderDay) return false;
  const now = new Date();
  const todayDay = now.getDate();
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return todayDay === Math.min(l.reminderDay, lastDay);
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

<!-- ── Assets ─────────────────────────────────────── -->
<div class="bs-section">
  <div class="bs-section-title">
    <span>資產</span>
    <span class="bs-section-total">{{ fmtNT(totalAssets) }}</span>
  </div>

  @if (state.accounts().length > 0) {
    <div class="bs-sub-title">現金 / 帳戶</div>
    @for (a of state.accounts(); track a.id) {
      <div class="bs-row">
        <span class="bs-row-name">{{ a.name }}</span>
        @if (a.interestRate > 0) {
          <span class="bs-row-tag">年利率 {{ a.interestRate }}%</span>
        }
        <span class="bs-row-amount">{{ fmtNT(a.balance) }}</span>
      </div>
    }
  }

  @if (holdingRows().length > 0) {
    <div class="bs-sub-title">持股市值</div>
    @for (h of holdingRows(); track h.code) {
      <div class="bs-row">
        <span class="bs-row-name">
          <span class="bs-code">{{ h.code }}</span> {{ h.name }}
        </span>
        <span class="bs-row-meta">{{ h.shares.toLocaleString() }} 股
          @if (h.price !== null) { × {{ h.price.toLocaleString() }} }
        </span>
        <span class="bs-row-amount" [class.text-muted-val]="h.mv === null">
          {{ h.mv !== null ? fmtNT(h.mv) : '未知市價' }}
        </span>
      </div>
    }
    @if (holdingRows().some(h => h.mv === null)) {
      <div style="font-size:12px;color:var(--text-muted);padding:4px 0 0 2px">
        * 未知市價的持股未計入總資產
      </div>
    }
  }

  @if (state.accounts().length === 0 && holdingRows().length === 0) {
    <div class="bs-empty">尚無資產資料，請先新增帳戶或交易記錄</div>
  }
</div>

<!-- ── Liabilities ─────────────────────────────────── -->
<div class="bs-section">
  <div class="bs-section-title">
    <span>負債</span>
    <span class="bs-section-total text-danger">{{ fmtNT(totalLiab) }}</span>
  </div>

  @for (l of state.liabilities(); track l.id) {
    @let isAlert = isReminderToday(l);
    @let isLoan  = isLoanType(l.type);
    @if (editId() === l.id) {

      <!-- ── Edit form ── -->
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

        <!-- Loan detail fields -->
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

      <!-- ── Display row ── -->
      <div class="bs-row bs-liab-row" [class.bs-reminder-alert]="isAlert">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            @if (isAlert) { <span class="bs-alert-badge">🔔 提醒日</span> }
            <span class="bs-row-name">{{ l.name }}</span>
            <span class="bs-row-tag">{{ l.type }}</span>
            @if (l.reminderEnabled && l.reminderDay) {
              <span class="bs-reminder-tag" [class.bs-reminder-tag-due]="isAlert">
                每月{{ l.reminderDay }}號
              </span>
            }
          </div>
          <!-- Loan details summary -->
          @if (isLoan && (l.totalAmount || l.periods || l.monthlyPayment || l.interestRate)) {
            <div class="bs-loan-meta">
              @if (l.totalAmount) { <span>總額 {{ fmtNT(l.totalAmount) }}</span> }
              @if (l.interestRate) { <span>年利率 {{ l.interestRate }}%</span> }
              @if (l.monthlyPayment) { <span>每月還款 {{ fmtNT(l.monthlyPayment) }}</span> }
              @if (l.periods) {
                <span>{{ l.paidPeriods ?? 0 }}/{{ l.periods }} 期</span>
              }
            </div>
            @if (l.periods && l.paidPeriods != null) {
              <div class="bs-progress-bar">
                <div class="bs-progress-fill"
                  [style.width.%]="progressPct(l.paidPeriods, l.periods)"></div>
              </div>
            }
          }
          @if (l.note) {
            <div class="bs-row-note">{{ l.note }}</div>
          }
        </div>
        <span class="bs-row-amount text-danger">{{ fmtNT(l.amount) }}</span>
        <div class="broker-row-actions">
          <button class="sig-action-btn" (click)="startEdit(l)">編輯</button>
          <button class="sig-action-btn danger" (click)="deleteLiability(l.id)">刪除</button>
        </div>
      </div>
    }
  }

  <!-- ── Add form ── -->
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

      <!-- Loan detail fields -->
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
  } @else {
    <button class="sig-open-add" style="margin-top:12px" (click)="startNew()">＋ 新增負債</button>
  }

  @if (state.liabilities().length === 0 && !showAddForm()) {
    <div class="bs-empty">尚無負債記錄</div>
  }
</div>
  `,
  styles: [`
    .bs-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:20px; }
    .bs-summary-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px 16px; }
    .bs-liab-card { border-color:rgba(192,57,43,.25); }
    .bs-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
    .bs-value { font-size:20px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .bs-section { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px; }
    .bs-section-title { display:flex; justify-content:space-between; align-items:center; font-size:16px; font-weight:700; color:var(--text); margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); }
    .bs-section-total { font-family:'JetBrains Mono',monospace; font-size:15px; }
    .bs-sub-title { font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin:10px 0 6px; }
    .bs-row { display:flex; align-items:center; gap:8px; padding:7px 4px; border-bottom:1px solid var(--border); }
    .bs-row:last-of-type { border-bottom:none; }
    .bs-liab-row { flex-wrap:wrap; align-items:flex-start; }
    .bs-row-name { font-weight:600; font-size:14px; flex:1; min-width:0; }
    .bs-row-meta { font-size:12px; color:var(--text-muted); white-space:nowrap; }
    .bs-row-amount { font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700; white-space:nowrap; }
    .bs-row-tag { font-size:11px; background:var(--tracking-bg); color:var(--gold); border:1px solid var(--gold-light); border-radius:4px; padding:1px 6px; white-space:nowrap; }
    .bs-row-note { font-size:12px; color:var(--text-muted); margin-top:3px; }
    .bs-code { color:var(--gold); font-family:'JetBrains Mono',monospace; font-size:13px; }
    .bs-empty { text-align:center; color:var(--text-muted); font-size:14px; padding:12px 0; }
    .bs-edit-form { background:var(--sidebar-bg); border:1px solid var(--border); border-radius:8px; padding:14px; margin:8px 0; }
    .bs-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; margin-top:6px; }
    .bs-toggle input { width:16px; height:16px; cursor:pointer; accent-color:var(--gold); }
    .bs-toggle-label { font-size:14px; }
    .bs-reminder-tag { font-size:11px; background:var(--tracking-bg); color:var(--text-muted); border:1px solid var(--border); border-radius:4px; padding:1px 6px; font-family:'JetBrains Mono',monospace; }
    .bs-reminder-tag-due { background:rgba(192,57,43,.12); color:var(--red); border-color:rgba(192,57,43,.3); }
    .bs-reminder-alert { border-left:3px solid var(--red,#c0392b); background:rgba(192,57,43,.04) !important; }
    .bs-alert-badge { font-size:12px; font-weight:700; color:var(--red,#c0392b); }
    .bs-loan-divider { font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin:10px 0 6px; padding-top:8px; border-top:1px solid var(--border); }
    .bs-loan-meta { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:12px; color:var(--text-muted); margin-top:4px; }
    .bs-loan-meta span { white-space:nowrap; }
    .bs-progress-bar { height:4px; background:var(--border); border-radius:2px; margin-top:5px; overflow:hidden; }
    .bs-progress-fill { height:100%; background:var(--gold); border-radius:2px; transition:width .3s; }
    .text-danger { color:var(--red,#c0392b); }
    .text-muted-val { color:var(--text-muted); }
    @media (max-width:600px) {
      .bs-summary { grid-template-columns:1fr 1fr; }
      .bs-summary-card:last-child { grid-column:1/-1; }
    }
  `],
})
export class BalanceSheetViewComponent {
  liabilityTypes = LIABILITY_TYPES;
  isReminderToday = isReminderToday;
  isLoanType = (t: string) => LOAN_TYPES.has(t);

  showAddForm = signal(false);
  editId      = signal<string | null>(null);
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

  asStr(e: Event)         { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  toNum(e: Event)         { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  toInt(e: Event)         { return parseInt((e.target as HTMLInputElement).value, 10) || 1; }
  toNumOrNull(e: Event)   { const v = parseFloat((e.target as HTMLInputElement).value); return isNaN(v) || v === 0 ? null : v; }
  toIntOrNull(e: Event)   { const v = parseInt((e.target as HTMLInputElement).value, 10); return isNaN(v) || v === 0 ? null : v; }
  asChecked(e: Event)     { return (e.target as HTMLInputElement).checked; }

  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `NT$${Math.round(abs).toLocaleString()}`;
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
        return {
          code,
          name: nameMap[code] ?? '',
          shares: fifo.holdingShares,
          price,
          mv: price !== null ? price * fifo.holdingShares : null,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => (b.mv ?? 0) - (a.mv ?? 0));
  });

  assetTotal = computed(() => {
    const cashTotal = this.state.accounts().reduce((s, a) => s + a.balance, 0);
    const holdTotal = this.holdingRows().reduce((s, h) => s + (h.mv ?? 0), 0);
    return cashTotal + holdTotal;
  });

  liabilityTotal = computed(() =>
    this.state.liabilities().reduce((s, l) => s + l.amount, 0),
  );

  startNew() { this.newF = this.blankForm(); this.showAddForm.set(true); this.editId.set(null); }

  async saveNew() {
    if (!this.newF.name.trim()) return;
    const l: Liability = {
      id: uid(), name: this.newF.name.trim(), type: this.newF.type,
      amount: this.newF.amount,
      reminderEnabled: this.newF.reminderEnabled,
      reminderDay: this.newF.reminderEnabled ? this.newF.reminderDay : null,
      note: this.newF.note.trim(),
      totalAmount: this.newF.totalAmount,
      periods: this.newF.periods,
      paidPeriods: this.newF.paidPeriods,
      interestRate: this.newF.interestRate,
      monthlyPayment: this.newF.monthlyPayment,
    };
    const saved = await this.api.createLiability(l);
    this.state.addLiability(saved);
    this.showAddForm.set(false);
  }

  startEdit(l: Liability) {
    this.editF = {
      name: l.name, type: l.type, amount: l.amount, note: l.note,
      reminderEnabled: l.reminderEnabled,
      reminderDay: l.reminderDay ?? 1,
      totalAmount: l.totalAmount,
      periods: l.periods,
      paidPeriods: l.paidPeriods,
      interestRate: l.interestRate,
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
      totalAmount: this.editF.totalAmount,
      periods: this.editF.periods,
      paidPeriods: this.editF.paidPeriods,
      interestRate: this.editF.interestRate,
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
