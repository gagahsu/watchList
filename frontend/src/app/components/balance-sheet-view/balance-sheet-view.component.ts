import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { Liability } from '../../models/types';
import { calcFIFO, uid } from '../../utils';

const LIABILITY_TYPES = ['房貸', '車貸', '信用貸款', '信用卡', '學貸', '其他'];

const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isReminderToday(l: Liability): boolean {
  if (!l.reminderEnabled || !l.reminderDate) return false;
  return l.reminderDate <= todayStr();
}

@Component({
  selector: 'app-balance-sheet-view',
  template: `
@let totalAssets     = assetTotal();
@let totalLiab       = liabilityTotal();
@let netWorth        = totalAssets - totalLiab;

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

  <!-- Accounts -->
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

  <!-- Holdings -->
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
            <div class="modal-label">金額 (NT$)</div>
            <input class="modal-input" type="number" step="1" min="0"
              [value]="editF.amount" (input)="editF.amount=toNum($event)" />
          </div>
          <div class="broker-form-group" style="flex:2">
            <div class="modal-label">備註</div>
            <input class="modal-input" [value]="editF.note" (input)="editF.note=asStr($event)" />
          </div>
        </div>
        <div class="broker-form-row" style="align-items:flex-end">
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
              <div class="modal-label">提醒日</div>
              <input class="modal-input" type="date" [value]="editF.reminderDate"
                (input)="editF.reminderDate=asStr($event)" />
            </div>
          }
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-primary" style="flex:1" (click)="saveEdit(l.id)">儲存</button>
          <button class="btn-cancel" (click)="editId.set(null)">取消</button>
        </div>
      </div>
    } @else {
      <div class="bs-row bs-liab-row" [class.bs-reminder-alert]="isAlert">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            @if (isAlert) { <span class="bs-alert-badge">🔔 提醒日</span> }
            <span class="bs-row-name">{{ l.name }}</span>
            <span class="bs-row-tag">{{ l.type }}</span>
            @if (l.reminderEnabled && l.reminderDate) {
              <span class="bs-reminder-tag" [class.bs-reminder-tag-due]="isAlert">
                {{ l.reminderDate }}
              </span>
            }
          </div>
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

  <!-- Add form -->
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
          <div class="modal-label">金額 (NT$)</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="如：5000000"
            [value]="newF.amount" (input)="newF.amount=toNum($event)" />
        </div>
        <div class="broker-form-group" style="flex:2">
          <div class="modal-label">備註 (選填)</div>
          <input class="modal-input" placeholder="如：每月繳款日15日"
            [value]="newF.note" (input)="newF.note=asStr($event)" />
        </div>
      </div>
      <div class="broker-form-row" style="align-items:flex-end">
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
            <div class="modal-label">提醒日</div>
            <input class="modal-input" type="date" [value]="newF.reminderDate"
              (input)="newF.reminderDate=asStr($event)" />
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
    .bs-liab-row { flex-wrap:wrap; }
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
    return { name: '', type: '其他', amount: 0, reminderEnabled: false, reminderDate: todayStr(), note: '' };
  }

  asStr(e: Event)     { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  toNum(e: Event)     { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  asChecked(e: Event) { return (e.target as HTMLInputElement).checked; }

  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `NT$${Math.round(abs).toLocaleString()}`;
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
      reminderDate: this.newF.reminderEnabled ? this.newF.reminderDate : null,
      note: this.newF.note.trim(),
    };
    const saved = await this.api.createLiability(l);
    this.state.addLiability(saved);
    this.showAddForm.set(false);
  }

  startEdit(l: Liability) {
    this.editF = {
      name: l.name, type: l.type, amount: l.amount,
      reminderEnabled: l.reminderEnabled,
      reminderDate: l.reminderDate ?? todayStr(),
      note: l.note,
    };
    this.editId.set(l.id);
    this.showAddForm.set(false);
  }

  async saveEdit(id: string) {
    const updated = await this.api.patchLiability(id, {
      name: this.editF.name.trim(), type: this.editF.type,
      amount: this.editF.amount,
      reminderEnabled: this.editF.reminderEnabled,
      reminderDate: this.editF.reminderEnabled ? this.editF.reminderDate : null,
      note: this.editF.note.trim(),
    });
    this.state.updateLiability(updated);
    this.editId.set(null);
  }

  async deleteLiability(id: string) {
    await this.api.deleteLiability(id);
    this.state.removeLiability(id);
  }
}
