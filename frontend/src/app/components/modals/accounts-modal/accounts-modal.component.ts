import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { Account, Trade } from '../../../models/types';
import { uid } from '../../../utils';

/** Returns the T+2 settlement date (skip weekends) for a trade date string YYYY-MM-DD */
export function settlementDate(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

/** Sum of pending buy settlement amounts for an account (settlement date >= today) */
export function pendingSettlements(accountId: string, allTrades: Record<string, Trade[]>): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let total = 0;
  for (const trades of Object.values(allTrades)) {
    for (const t of trades) {
      if (t.type !== 'buy' || t.accountId !== accountId) continue;
      const sd = settlementDate(t.date);
      if (sd >= today) {
        total += t.shares * t.price + (t.fee || 0);
      }
    }
  }
  return total;
}

@Component({
  selector: 'app-accounts-modal',
  template: `
<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
  <div class="modal-box" style="max-width:560px;width:92vw">
    <div class="modal-title">帳戶管理</div>

    @if (state.accounts().length === 0 && !showForm()) {
      <div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:14px">
        尚無帳戶，點下方新增
      </div>
    }

    @for (a of state.accounts(); track a.id) {
      @let pending = getPending(a.id);
      @let available = a.balance - pending;
      @let hasWarning = pending > 0 && available < 0;
      @if (editId() === a.id) {
        <div class="broker-form" style="border-left:3px solid var(--accent)">
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
              <div class="modal-label">帳戶餘額 (NT$)</div>
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
        <div class="broker-row" [class.account-row-warning]="hasWarning">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            @if (hasWarning) {
              <span class="account-warning-badge" title="帳戶可用餘額不足以支付待交割款項">⚠️</span>
            }
            <div style="min-width:0">
              <div class="broker-row-name">{{ a.name }}</div>
              <div class="broker-row-meta" style="flex-wrap:wrap;gap:6px 12px">
                <span>餘額 {{ fmtNT(a.balance) }}</span>
                @if (pending > 0) {
                  <span [class.text-danger]="hasWarning">待交割 {{ fmtNT(pending) }}</span>
                  <span [class.text-danger]="hasWarning" [class.text-ok]="!hasWarning">
                    可用 {{ fmtNT(available) }}
                  </span>
                }
                @if (a.interestRate > 0) {
                  <span>年利率 {{ a.interestRate }}%</span>
                }
                @if (a.note) {
                  <span style="color:var(--text-muted)">{{ a.note }}</span>
                }
              </div>
            </div>
          </div>
          <div class="broker-row-actions">
            <button class="sig-action-btn" (click)="startEdit(a)">編輯</button>
            <button class="sig-action-btn danger" (click)="deleteAccount(a.id)">刪除</button>
          </div>
        </div>
      }
    }

    @if (showForm()) {
      <div class="broker-form" style="margin-top:12px">
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
            <div class="modal-label">帳戶餘額 (NT$)</div>
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
    } @else {
      <button class="sig-open-add" style="margin-top:12px" (click)="startNew()">＋ 新增帳戶</button>
    }

    <div style="font-size:12px;color:var(--text-muted);margin-top:12px;padding:0 2px">
      待交割：買入股票在台股 T+2 交割日前尚未扣款的金額。可用餘額 = 帳戶餘額 − 待交割。
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-primary" (click)="close()">完成</button>
    </div>
  </div>
</div>
  `,
  styles: [`
    .account-row-warning { border-left: 3px solid var(--red, #e55); background: rgba(220,50,50,.05); }
    .account-warning-badge { font-size: 16px; flex-shrink: 0; }
    .text-danger { color: var(--red, #e55) !important; }
    .text-ok { color: var(--green, #4c8); }
  `],
})
export class AccountsModalComponent {
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
    const sign = n < 0 ? '-' : '';
    return `${sign}NT$${Math.round(abs).toLocaleString()}`;
  }

  getPending(accountId: string): number {
    return pendingSettlements(accountId, this.state.trades());
  }

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

  close() { this.state.accountsOpen.set(false); }
  private mdOnOverlay = false;
  trackMd(e: MouseEvent) { this.mdOnOverlay = e.target === e.currentTarget; }
  closeIfBg(e: MouseEvent) {
    if (this.mdOnOverlay && e.target === e.currentTarget) this.close();
    this.mdOnOverlay = false;
  }
}
