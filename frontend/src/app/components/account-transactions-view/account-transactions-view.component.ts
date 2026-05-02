import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { AccountTransaction, TxnType } from '../../models/types';
import { uid } from '../../utils';

const TYPE_LABEL: Record<TxnType, string> = {
  deposit: '入金', withdrawal: '出金', transfer: '轉帳',
};
const TYPE_CLASS: Record<TxnType, string> = {
  deposit: 'txn-deposit', withdrawal: 'txn-withdrawal', transfer: 'txn-transfer',
};

@Component({
  selector: 'app-account-transactions-view',
  template: `
<div class="index-search-wrap">
  <span class="index-search-icon">🔍</span>
  <input class="index-search" placeholder="搜尋備註…"
    [value]="search()" (input)="search.set(asStr($event))" />
</div>

<!-- Filter bar -->
<div class="index-filter-bar">
  <div style="display:flex;gap:4px;align-items:center">
    <span style="font-size:12px;color:var(--text-muted);margin-right:2px">類型</span>
    @for (f of typeFilters; track f.v) {
      <button class="sov-filter-btn" [class.active]="filterType()===f.v"
        (click)="filterType.set(f.v)">{{ f.l }}</button>
    }
  </div>
  @if (state.accounts().length > 0) {
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-size:12px;color:var(--text-muted);margin-right:2px">帳戶</span>
      <select class="note-filter-select" [value]="filterAccount()"
        (change)="filterAccount.set(asStr($event))">
        <option value="">全部</option>
        @for (a of state.accounts(); track a.id) {
          <option [value]="a.id">{{ a.name }}</option>
        }
      </select>
    </div>
  }
  <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">
    {{ filtered().length }} 筆
  </span>
</div>

@if (state.transactions().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">📒</div>
    <div class="empty-title">尚無資金記錄</div>
    <div class="empty-sub">記錄每次入金、出金或帳戶間的轉帳</div>
    <button class="empty-btn" (click)="openNew()">＋ 新增記錄</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">
      {{ filtered().length }} 筆記錄
      @if (netFlow() !== 0) {
        &nbsp;·&nbsp;淨流入
        <span [style.color]="netFlow() >= 0 ? 'var(--green,#27ae60)' : 'var(--red,#c0392b)'"
              style="font-weight:600">
          {{ netFlow() >= 0 ? '+' : '' }}{{ fmtNT(netFlow()) }}
        </span>
      }
    </span>
    <button class="idx-add-btn" (click)="openNew()">＋ 新增記錄</button>
  </div>

  <table class="index-table">
    <thead><tr>
      <th style="width:100px">日期</th>
      <th style="width:80px">類型</th>
      <th style="text-align:right;width:130px">金額</th>
      <th>帳戶</th>
      <th>備註</th>
    </tr></thead>
    <tbody>
      @for (t of filtered(); track t.id) {
        <tr (click)="openView(t)">
          <td style="font-family:'JetBrains Mono',monospace;font-size:13px">{{ t.date }}</td>
          <td>
            <span class="txn-badge {{ typeClass(t.type) }}">{{ typeLabel(t.type) }}</span>
          </td>
          <td class="txn-amount {{ typeClass(t.type) }}">
            {{ t.type === 'deposit' ? '+' : t.type === 'withdrawal' ? '-' : '' }}{{ fmtNT(t.amount) }}
          </td>
          <td style="font-size:13px">{{ accountLabel(t) }}</td>
          <td style="font-size:13px;color:var(--text-muted)">{{ t.note || '—' }}</td>
        </tr>
      }
    </tbody>
  </table>
}

<!-- Modal -->
@if (openModal()) {
  <div class="modal-overlay" (click)="closeModal()">
    <div class="modal-box" (click)="$event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:17px;font-weight:700">
          {{ isNew() ? '新增記錄' : '交易記錄' }}
        </div>
        <button class="sidebar-close-btn" (click)="closeModal()">×</button>
      </div>

      @if (isNew()) {
        <!-- New form -->
        <div style="display:flex;gap:8px;margin-bottom:14px">
          @for (f of txnTypes; track f.v) {
            <button [class]="newF.type === f.v ? 'txn-type-btn txn-type-btn--active ' + typeClass(f.v) : 'txn-type-btn'"
              (click)="newF.type=f.v">{{ f.l }}</button>
          }
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">日期</div>
            <input class="modal-input" type="date" [value]="newF.date"
              (input)="newF.date=asStr($event)" />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">金額</div>
            <input class="modal-input" type="number" min="0" step="1" placeholder="如：100000"
              [value]="newF.amount || ''" (input)="newF.amount=toNum($event)" />
          </div>
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">{{ newF.type === 'transfer' ? '轉出帳戶' : '帳戶' }}</div>
            <select class="trade-form-select" (change)="newF.accountId=asStr($event)">
              <option value="">請選擇</option>
              @for (a of state.accounts(); track a.id) {
                <option [value]="a.id" [selected]="newF.accountId===a.id">{{ a.name }}</option>
              }
            </select>
          </div>
          @if (newF.type === 'transfer') {
            <div class="broker-form-group" style="flex:1">
              <div class="modal-label">轉入帳戶</div>
              <select class="trade-form-select" (change)="newF.toAccountId=asStr($event)">
                <option value="">請選擇</option>
                @for (a of state.accounts(); track a.id) {
                  <option [value]="a.id" [selected]="newF.toAccountId===a.id">{{ a.name }}</option>
                }
              </select>
            </div>
          }
        </div>
        <div class="broker-form-group">
          <div class="modal-label">備註 (選填)</div>
          <input class="modal-input" placeholder="如：5月補充資金"
            [value]="newF.note" (input)="newF.note=asStr($event)" />
        </div>
        <div style="display:flex;gap:8px;margin-top:18px">
          <button class="btn-primary" style="flex:1" (click)="saveNew()"
            [disabled]="!newF.amount || !newF.accountId">新增</button>
          <button class="btn-cancel" (click)="closeModal()">取消</button>
        </div>
      } @else {
        <!-- View existing -->
        @let t = viewTarget()!;
        <div class="txn-detail-grid">
          <span class="txn-detail-label">類型</span>
          <span class="txn-badge {{ typeClass(t.type) }}">{{ typeLabel(t.type) }}</span>
          <span class="txn-detail-label">日期</span>
          <span style="font-family:'JetBrains Mono',monospace">{{ t.date }}</span>
          <span class="txn-detail-label">金額</span>
          <span class="txn-amount {{ typeClass(t.type) }}" style="font-size:16px;font-weight:700">
            {{ t.type === 'deposit' ? '+' : t.type === 'withdrawal' ? '-' : '' }}{{ fmtNT(t.amount) }}
          </span>
          <span class="txn-detail-label">帳戶</span>
          <span>{{ accountLabel(t) }}</span>
          @if (t.note) {
            <span class="txn-detail-label">備註</span>
            <span>{{ t.note }}</span>
          }
        </div>
        <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="sig-action-btn danger" style="width:100%" (click)="deleteTxn(t.id)">
            刪除此記錄
          </button>
        </div>
      }
    </div>
  </div>
}
  `,
  styles: [`
    .txn-badge { display:inline-block; padding:2px 9px; border-radius:10px; font-size:12px; font-weight:700; }
    .txn-deposit    { color:var(--green,#27ae60); }
    .txn-withdrawal { color:var(--red,#c0392b); }
    .txn-transfer   { color:var(--gold,#b5851b); }
    .txn-badge.txn-deposit    { background:rgba(39,174,96,.12); }
    .txn-badge.txn-withdrawal { background:rgba(192,57,43,.10); }
    .txn-badge.txn-transfer   { background:rgba(181,133,27,.12); }
    .txn-amount { text-align:right; font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; white-space:nowrap; }
    .txn-type-btn {
      flex:1; padding:8px; border:1.5px solid var(--border); border-radius:8px;
      background:none; font-family:inherit; font-size:14px; font-weight:600;
      cursor:pointer; transition:all 0.15s; color:var(--text-muted);
    }
    .txn-type-btn--active.txn-deposit    { border-color:var(--green,#27ae60); color:var(--green,#27ae60); background:rgba(39,174,96,.08); }
    .txn-type-btn--active.txn-withdrawal { border-color:var(--red,#c0392b);   color:var(--red,#c0392b);   background:rgba(192,57,43,.08); }
    .txn-type-btn--active.txn-transfer   { border-color:var(--gold,#b5851b);  color:var(--gold,#b5851b);  background:rgba(181,133,27,.08); }
    .txn-detail-grid { display:grid; grid-template-columns:max-content 1fr; gap:10px 16px; align-items:center; }
    .txn-detail-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; }
  `],
})
export class AccountTransactionsViewComponent {
  search        = signal('');
  filterType    = signal<'all' | TxnType>('all');
  filterAccount = signal('');
  openModal     = signal<'new' | AccountTransaction | null>(null);

  typeFilters: { v: 'all' | TxnType; l: string }[] = [
    { v: 'all',        l: '全部' },
    { v: 'deposit',    l: '入金' },
    { v: 'withdrawal', l: '出金' },
    { v: 'transfer',   l: '轉帳' },
  ];
  txnTypes: { v: TxnType; l: string }[] = [
    { v: 'deposit', l: '入金' }, { v: 'withdrawal', l: '出金' }, { v: 'transfer', l: '轉帳' },
  ];

  newF = this.blankForm();

  constructor(public state: AppStateService, private api: ApiService) {}

  blankForm() {
    return {
      type: 'deposit' as TxnType,
      date: new Date().toISOString().slice(0, 10),
      amount: 0,
      accountId: '',
      toAccountId: '',
      note: '',
    };
  }

  typeLabel = (t: TxnType) => TYPE_LABEL[t];
  typeClass = (t: TxnType) => TYPE_CLASS[t];

  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  toNum(e: Event) { return parseFloat((e.target as HTMLInputElement).value) || 0; }

  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `NT$${Math.round(abs).toLocaleString()}`;
  }

  accountName(id: string) {
    return this.state.accounts().find(a => a.id === id)?.name ?? id;
  }

  accountLabel(t: AccountTransaction) {
    if (t.type === 'transfer' && t.toAccountId) {
      return `${this.accountName(t.accountId)} → ${this.accountName(t.toAccountId)}`;
    }
    return this.accountName(t.accountId);
  }

  filtered = computed(() => {
    const q    = this.search().trim().toLowerCase();
    const type = this.filterType();
    const acc  = this.filterAccount();
    return this.state.transactions().filter(t => {
      if (type !== 'all' && t.type !== type) return false;
      if (acc && t.accountId !== acc && t.toAccountId !== acc) return false;
      if (q && !t.note.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  netFlow = computed(() =>
    this.filtered().reduce((s, t) => {
      if (t.type === 'deposit')    return s + t.amount;
      if (t.type === 'withdrawal') return s - t.amount;
      return s;
    }, 0)
  );

  isNew()       { return this.openModal() === 'new'; }
  viewTarget()  { const m = this.openModal(); return m !== 'new' ? m : null; }

  openNew()  { this.newF = this.blankForm(); this.openModal.set('new'); }
  openView(t: AccountTransaction) { this.openModal.set(t); }
  closeModal() { this.openModal.set(null); }

  async saveNew() {
    if (!this.newF.amount || !this.newF.accountId) return;
    const txn: AccountTransaction = {
      id: uid(), date: this.newF.date, type: this.newF.type,
      amount: this.newF.amount, accountId: this.newF.accountId,
      toAccountId: this.newF.type === 'transfer' && this.newF.toAccountId
        ? this.newF.toAccountId : null,
      note: this.newF.note.trim(),
    };
    const saved = await this.api.createTransaction(txn);
    this.state.addTransaction(saved);
    // reflect balance change: reload accounts from state (backend already updated)
    const updatedAccounts = await this.api.getAccounts();
    this.state.accounts.set(updatedAccounts);
    this.closeModal();
  }

  async deleteTxn(id: string) {
    await this.api.deleteTransaction(id);
    this.state.removeTransaction(id);
    const updatedAccounts = await this.api.getAccounts();
    this.state.accounts.set(updatedAccounts);
    this.closeModal();
  }
}
