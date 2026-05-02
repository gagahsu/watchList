import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { Account } from '../../models/types';
import { uid, pendingSettlements } from '../../utils';

@Component({
  selector: 'app-accounts-view',
  template: `
<div class="acv-toolbar">
  <span class="acv-total">
    總餘額 <strong>{{ fmtNT(totalBalance()) }}</strong>
    @if (totalPending() > 0) {
      <span class="acv-total-pending">待交割 {{ fmtNT(totalPending()) }}</span>
      <span class="acv-total-avail">可用 {{ fmtNT(totalBalance() - totalPending()) }}</span>
    }
  </span>
  <button class="idx-add-btn" (click)="startNew()">＋ 新增帳戶</button>
</div>

@if (state.accounts().length === 0 && !showForm()) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">💰</div>
    <div class="empty-title">尚無帳戶</div>
    <div class="empty-sub">點右上角「新增帳戶」開始管理資金</div>
  </div>
}

@for (a of state.accounts(); track a.id) {
  @let pending = getPending(a.id);
  @let available = a.balance - pending;
  @let hasWarning = pending > 0 && available < 0;

  @if (editId() === a.id) {
    <div class="acv-form-card">
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
          <input class="modal-input" placeholder="如：玉山永豐銀行"
            [value]="editF.note" (input)="editF.note=asStr($event)" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" style="flex:1" (click)="saveEdit(a.id)">儲存</button>
        <button class="btn-cancel" (click)="editId.set(null)">取消</button>
      </div>
    </div>
  } @else {
    <div class="acv-row" [class.acv-row-warning]="hasWarning">
      <div class="acv-row-left">
        @if (hasWarning) {
          <span class="acv-warning-badge" title="可用餘額不足以支付待交割款項">⚠️</span>
        }
        <div>
          <div class="acv-name">{{ a.name }}</div>
          <div class="acv-meta">
            <span>餘額 {{ fmtNT(a.balance) }}</span>
            @if (pending > 0) {
              <span [class.acv-danger]="hasWarning">待交割 {{ fmtNT(pending) }}</span>
              <span [class.acv-danger]="hasWarning" [class.acv-ok]="!hasWarning">
                可用 {{ fmtNT(available) }}
              </span>
            }
            @if (a.interestRate > 0) {
              <span>年利率 {{ a.interestRate }}%</span>
            }
            @if (a.note) {
              <span class="acv-note">{{ a.note }}</span>
            }
          </div>
        </div>
      </div>
      <div class="acv-actions">
        <button class="sig-action-btn" (click)="startEdit(a)">編輯</button>
        <button class="sig-action-btn danger" (click)="deleteAccount(a.id)">刪除</button>
      </div>
    </div>
  }
}

@if (showForm()) {
  <div class="acv-form-card" style="margin-top:12px">
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
  `,
  styles: [`
    .acv-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px;
    }
    .acv-total { font-size: 14px; color: var(--text-muted); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .acv-total strong { color: var(--text); font-size: 16px; }
    .acv-total-pending { color: var(--text-muted); }
    .acv-total-avail { color: var(--green, #27ae60); font-weight: 600; }
    .acv-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 0; border-bottom: 1px solid var(--border); gap: 12px;
    }
    .acv-row-warning { padding-left: 10px; border-left: 3px solid var(--red, #e55); }
    .acv-row-left { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; }
    .acv-warning-badge { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .acv-name { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .acv-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--text-muted); }
    .acv-note { color: var(--text-muted); font-style: italic; }
    .acv-danger { color: var(--red, #e55) !important; font-weight: 600; }
    .acv-ok { color: var(--green, #27ae60); font-weight: 600; }
    .acv-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .acv-form-card {
      background: var(--sidebar-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 14px 16px; margin-bottom: 2px;
    }
    .acv-hint { font-size: 12px; color: var(--text-muted); margin-top: 20px; line-height: 1.6; }
  `],
})
export class AccountsViewComponent {
  showForm = signal(false);
  editId   = signal<string | null>(null);
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

  startNew() { this.newF = this.blank(); this.showForm.set(true); this.editId.set(null); }

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

  startEdit(a: Account) {
    this.editF = { name: a.name, balance: a.balance, interestRate: a.interestRate, note: a.note };
    this.editId.set(a.id);
    this.showForm.set(false);
  }

  async saveEdit(id: string) {
    const saved = await this.api.patchAccount(id, {
      name: this.editF.name.trim(), balance: this.editF.balance,
      interestRate: this.editF.interestRate, note: this.editF.note.trim(),
    });
    this.state.updateAccount(saved);
    this.editId.set(null);
  }

  async deleteAccount(id: string) {
    await this.api.deleteAccount(id);
    this.state.removeAccount(id);
  }
}
