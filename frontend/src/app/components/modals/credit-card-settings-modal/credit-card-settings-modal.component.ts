import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { CreditCard } from '../../../models/types';
import { uid } from '../../../utils';

@Component({
  selector: 'app-credit-card-settings-modal',
  imports: [FormsModule],
  template: `
<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
  <div class="modal-box" style="max-width:480px;width:92vw">
    <div class="modal-title">信用卡扣款日設定</div>
    <div class="cc-hint">設定各銀行的信用卡扣款日，新增信用卡負債時可自動帶入</div>

    @if (state.creditCards().length === 0 && !showForm()) {
      <div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:14px">
        尚未設定任何銀行扣款日
      </div>
    }

    @for (c of state.creditCards(); track c.id) {
      <div class="cc-row" [class.cc-today]="isToday(c.paymentDay)">
        <div class="cc-info">
          <span class="cc-bank">{{ c.name }}</span>
          @if (c.note) { <span class="cc-note">{{ c.note }}</span> }
        </div>
        <div class="cc-day" [class.cc-day-today]="isToday(c.paymentDay)">
          每月 {{ c.paymentDay }} 日
          @if (isToday(c.paymentDay)) { <span class="cc-today-badge">今日</span> }
        </div>
        <button class="broker-del-btn" (click)="deleteCard(c.id)">刪除</button>
      </div>
    }

    @if (showForm()) {
      <div class="broker-form" style="margin-top:12px">
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:2">
            <div class="modal-label">銀行名稱</div>
            <input class="modal-input" placeholder="如：台新銀行" [(ngModel)]="newName" autofocus />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">扣款日</div>
            <input class="modal-input" type="number" min="1" max="31" placeholder="如：25" [(ngModel)]="newDay" />
          </div>
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">備註 (選填)</div>
            <input class="modal-input" placeholder="如：現金回饋卡" [(ngModel)]="newNote" />
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-primary" style="flex:1" (click)="saveCard()"
            [disabled]="!newName.trim() || !newDay">新增</button>
          <button class="btn-cancel" (click)="cancelForm()">取消</button>
        </div>
      </div>
    } @else {
      <div style="margin-top:12px">
        <button class="broker-add-btn" (click)="showForm.set(true)">＋ 新增銀行</button>
      </div>
    }

    <div style="margin-top:18px;text-align:right">
      <button class="btn-cancel" (click)="state.creditCardsOpen.set(false)">關閉</button>
    </div>
  </div>
</div>
  `,
  styles: [`
    .cc-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 14px;
    }
    .cc-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 7px;
      margin-bottom: 4px;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--border);
    }
    .cc-today { border-color: rgba(212,160,23,.4); background: rgba(212,160,23,.05); }
    .cc-info { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .cc-bank { font-size: 14px; font-weight: 600; color: var(--text); }
    .cc-note { font-size: 12px; color: var(--text-muted); }
    .cc-day {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cc-day-today { color: var(--gold, #d4a017); }
    .cc-today-badge {
      background: var(--gold, #d4a017);
      color: #000;
      font-size: 10px;
      font-weight: 700;
      border-radius: 4px;
      padding: 1px 5px;
    }
  `],
})
export class CreditCardSettingsModalComponent {
  showForm = signal(false);
  newName  = '';
  newDay: number | null = null;
  newNote  = '';

  private _mdTarget: EventTarget | null = null;

  constructor(public state: AppStateService, private api: ApiService) {}

  isToday(day: number) { return new Date().getDate() === day; }

  trackMd(e: MouseEvent)  { this._mdTarget = e.target; }
  closeIfBg(e: MouseEvent) {
    if (e.target === this._mdTarget && (e.target as Element).classList.contains('modal-overlay')) {
      this.state.creditCardsOpen.set(false);
    }
  }

  cancelForm() {
    this.newName = '';
    this.newDay = null;
    this.newNote = '';
    this.showForm.set(false);
  }

  async saveCard() {
    const name = this.newName.trim();
    if (!name || !this.newDay) return;
    const card: CreditCard = {
      id: uid(), name, bank: name, paymentDay: +this.newDay, note: this.newNote.trim(),
    };
    const saved = await this.api.createCreditCard(card);
    this.state.addCreditCard(saved);
    this.cancelForm();
  }

  async deleteCard(id: string) {
    await this.api.deleteCreditCard(id);
    this.state.removeCreditCard(id);
  }
}
