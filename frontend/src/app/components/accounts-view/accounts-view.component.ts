import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { Account } from '../../models/types';
import { uid, pendingSettlements } from '../../utils';

@Component({
  selector: 'app-accounts-view',
  template: `
<div class="index-search-wrap">
  <span class="index-search-icon">🔍</span>
  <input class="index-search" placeholder="搜尋帳戶名稱、備註…"
    [value]="search()" (input)="search.set(asStr($event))" />
</div>

@if (state.accounts().length === 0 && !showForm()) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">💰</div>
    <div class="empty-title">尚無帳戶</div>
    <div class="empty-sub">點右上角「新增帳戶」開始管理資金</div>
    <button class="empty-btn" (click)="startNew()">＋ 新增帳戶</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">
      {{ state.accounts().length }} 個帳戶 · 點擊列編輯
      @if (totalPending() > 0) {
        &nbsp;·&nbsp;待交割
        <span style="color:var(--red,#c0392b);font-weight:600">{{ fmtNT(totalPending()) }}</span>
        &nbsp;·&nbsp;可用
        <span style="color:var(--green,#27ae60);font-weight:600">{{ fmtNT(totalBalance() - totalPending()) }}</span>
      }
    </span>
    <button class="idx-add-btn" (click)="startNew()">＋ 新增帳戶</button>
  </div>

  <table class="index-table">
    <thead><tr>
      <th>帳戶名稱</th>
      <th style="text-align:right">餘額</th>
      <th style="text-align:right">待交割</th>
      <th style="text-align:right">可用</th>
      <th style="text-align:right">年利率</th>
      <th>備註</th>
    </tr></thead>
    <tbody>
      @for (a of filtered(); track a.id) {
        @let pending = getPending(a.id);
        @let available = a.balance - pending;
        @let hasWarning = pending > 0 && available < 0;
        <tr (click)="openEdit(a)" [class.acv-warn-row]="hasWarning">
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              @if (hasWarning) { <span title="可用餘額不足以支付待交割款項">⚠️</span> }
              <span class="idx-name">{{ a.name }}</span>
            </div>
          </td>
          <td class="acv-num">{{ fmtNT(a.balance) }}</td>
          <td class="acv-num" [class.acv-red]="pending > 0">
            {{ pending > 0 ? fmtNT(pending) : '—' }}
          </td>
          <td class="acv-num"
            [class.acv-green]="pending > 0 && !hasWarning"
            [class.acv-red]="hasWarning">
            {{ pending > 0 ? fmtNT(available) : '—' }}
          </td>
          <td class="acv-num" style="color:var(--text-muted)">
            {{ a.interestRate > 0 ? a.interestRate + '%' : '—' }}
          </td>
          <td style="font-size:13px;color:var(--text-muted)">{{ a.note || '—' }}</td>
        </tr>
      }
    </tbody>
  </table>

  <div class="acv-total-row">
    總餘額 <strong>{{ fmtNT(totalBalance()) }}</strong>
  </div>
}

@if (showForm()) {
  <div class="acv-form-card">
    <div class="broker-form-row">
      <div class="broker-form-group" style="flex:2">
        <div class="modal-label">帳戶名稱</div>
        <input class="modal-input" placeholder="如：富果、永豐證券帳戶"
          [value]="newF.name" (input)="newF.name=asStr($event)" autofocus />
      </div>
      <div class="broker-form-group" style="flex:1">
        <div class="modal-label">年利率 (%)</div>
        <input class="modal-input" type="number" min="0" step="0.01" placeholder="如：1.5"
          [value]="newF.interestRate" (input)="newF.interestRate=toNum($event)" />
      </div>
    </div>
    <div class="broker-form-row">
      <div class="broker-form-group" style="flex:1">
        <div class="modal-label">帳戶餘額</div>
        <input class="modal-input" type="number" step="1" placeholder="如：500000"
          [value]="newF.balance" (input)="newF.balance=toNum($event)" />
      </div>
      <div class="broker-form-group" style="flex:2">
        <div class="modal-label">備註 (選填)</div>
        <input class="modal-input" placeholder="如：玉山永豐銀行"
          [value]="newF.note" (input)="newF.note=asStr($event)" />
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-primary" style="flex:1" (click)="saveNew()">新增</button>
      <button class="btn-cancel" (click)="showForm.set(false)">取消</button>
    </div>
  </div>
}

<div class="acv-hint">
  待交割：買入股票在台股 T+2 交割日前尚未扣款的金額。可用餘額 = 帳戶餘額 − 待交割。
</div>

<!-- Edit modal -->
@if (editTarget()) {
  <div class="modal-overlay" (click)="closeEdit()">
    <div class="modal-box" (click)="$event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:17px;font-weight:700">編輯帳戶</div>
        <button class="sidebar-close-btn" (click)="closeEdit()">×</button>
      </div>
      <div class="broker-form-row">
        <div class="broker-form-group" style="flex:2">
          <div class="modal-label">帳戶名稱</div>
          <input class="modal-input" [value]="editF.name" (input)="editF.name=asStr($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">年利率 (%)</div>
          <input class="modal-input" type="number" min="0" step="0.01"
            [value]="editF.interestRate" (input)="editF.interestRate=toNum($event)" />
        </div>
      </div>
      <div class="broker-form-row">
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">帳戶餘額</div>
          <input class="modal-input" type="number" step="1"
            [value]="editF.balance" (input)="editF.balance=toNum($event)" />
        </div>
        <div class="broker-form-group" style="flex:2">
          <div class="modal-label">備註</div>
          <input class="modal-input" [value]="editF.note" (input)="editF.note=asStr($event)" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:18px">
        <button class="btn-primary" style="flex:1" (click)="saveEdit()">儲存</button>
        <button class="btn-cancel" (click)="closeEdit()">取消</button>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <button class="sig-action-btn danger" style="width:100%" (click)="deleteAccount()">
          刪除此帳戶
        </button>
      </div>
    </div>
  </div>
}
  `,
  styles: [`
    .acv-num   { text-align:right; font-family:'JetBrains Mono',monospace; font-size:13px; white-space:nowrap; }
    .acv-red   { color:var(--red,#c0392b) !important; font-weight:600; }
    .acv-green { color:var(--green,#27ae60) !important; font-weight:600; }
    .acv-warn-row td:first-child { border-left:3px solid var(--red,#c0392b); }
    .acv-form-card {
      background:var(--sidebar-bg); border:1px solid var(--border);
      border-radius:8px; padding:14px 16px; margin-top:12px;
    }
    .acv-total-row { font-size:13px; color:var(--text-muted); margin-top:12px; text-align:right; }
    .acv-total-row strong { color:var(--text); font-size:15px; margin-left:6px; }
    .acv-hint { font-size:12px; color:var(--text-muted); margin-top:20px; line-height:1.6; }
  `],
})
export class AccountsViewComponent {
  search     = signal('');
  showForm   = signal(false);
  editTarget = signal<Account | null>(null);
  newF  = this.blank();
  editF = this.blank();

  constructor(public state: AppStateService, private api: ApiService) {}

  blank() { return { name: '', balance: 0, interestRate: 0, note: '' }; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  toNum(e: Event) { return parseFloat((e.target as HTMLInputElement).value) || 0; }

  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `${n < 0 ? '-' : ''}NT$${Math.round(abs).toLocaleString()}`;
  }

  getPending(accountId: string) {
    return pendingSettlements(accountId, this.state.trades());
  }

  totalBalance = computed(() => this.state.accounts().reduce((s, a) => s + a.balance, 0));
  totalPending = computed(() =>
    this.state.accounts().reduce((s, a) => s + pendingSettlements(a.id, this.state.trades()), 0)
  );

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.state.accounts();
    return this.state.accounts().filter(a =>
      a.name.toLowerCase().includes(q) || a.note.toLowerCase().includes(q)
    );
  });

  openEdit(a: Account) {
    this.editF = { name: a.name, balance: a.balance, interestRate: a.interestRate, note: a.note };
    this.editTarget.set(a);
    this.showForm.set(false);
  }

  closeEdit() { this.editTarget.set(null); }

  async saveEdit() {
    const id = this.editTarget()!.id;
    const saved = await this.api.patchAccount(id, {
      name: this.editF.name.trim(), balance: this.editF.balance,
      interestRate: this.editF.interestRate, note: this.editF.note.trim(),
    });
    this.state.updateAccount(saved);
    this.closeEdit();
  }

  async deleteAccount() {
    const id = this.editTarget()!.id;
    await this.api.deleteAccount(id);
    this.state.removeAccount(id);
    this.closeEdit();
  }

  startNew() { this.newF = this.blank(); this.showForm.set(true); this.closeEdit(); }

  async saveNew() {
    if (!this.newF.name.trim()) return;
    const a: Account = {
      id: uid(), name: this.newF.name.trim(),
      balance: this.newF.balance, interestRate: this.newF.interestRate,
      note: this.newF.note.trim(),
    };
    const saved = await this.api.createAccount(a);
    this.state.addAccount(saved);
    this.showForm.set(false);
  }
}
