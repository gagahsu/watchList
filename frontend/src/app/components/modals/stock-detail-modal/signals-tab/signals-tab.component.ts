import { Component, Input, signal } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { Signal } from '../../../../models/types';
import { SIG_DIR_CLASS, SIG_DIR_LABELS, SIG_STATUS_CLASS, SIG_STATUS_LABELS, fmtDate, uid } from '../../../../utils';

@Component({
  selector: 'app-signals-tab',
  template: `
@let code = entry().code;
@let sigs = state.signals()[code] ?? [];
@let active = sigs.filter(s => s.status === 'active');
@let inactive = sigs.filter(s => s.status !== 'active');

@if (active.length === 0 && !showForm()) {
  <div class="sig-empty">尚無有效訊號<br>點擊下方新增第一筆</div>
}

@if (active.length > 0) {
  <div class="signals-list" style="margin-bottom:12px">
    @for (sig of active; track sig.id) {
      <ng-container *ngTemplateOutlet="sigItem; context:{sig, code}"></ng-container>
    }
  </div>
}

@if (showForm()) {
  <div class="sig-add-form">
    <div class="sig-form-row">
      <select class="sig-form-select" [value]="form.direction" (change)="form.direction=asStr($event)">
        <option value="enter">📈 進場</option>
        <option value="exit">📉 出場</option>
        <option value="watch">👀 觀察</option>
      </select>
      <select class="sig-form-select" [value]="form.source" (change)="onSourceChange($event)">
        @for (s of state.sources(); track s) { <option [value]="s">{{ s }}</option> }
        <option value="__new__">＋ 新增來源…</option>
      </select>
      <input class="sig-form-input" placeholder="價格條件（選填）" style="max-width:160px"
        [value]="form.price" (input)="form.price=asStr($event)" />
    </div>
    @if (addingSrc()) {
      <div class="sig-form-row" style="margin-bottom:10px">
        <input class="sig-form-input" placeholder="新來源名稱" [value]="newSrc()"
          (input)="newSrc.set(asStr($event))" (keydown.enter)="confirmSrc()" autofocus />
        <button class="sig-add-btn" style="font-size:12px;padding:7px 12px" (click)="confirmSrc()">新增</button>
        <button class="sig-action-btn" (click)="addingSrc.set(false)">取消</button>
      </div>
    }
    <textarea class="sig-form-textarea" placeholder="訊號描述（如：回測5日線有守可進場）"
      [value]="form.condition" (input)="form.condition=asStr($event)"></textarea>
    <div style="display:flex;gap:8px">
      <button class="sig-add-btn" (click)="addSignal(code)">新增訊號</button>
      <button class="sig-action-btn" (click)="showForm.set(false)">取消</button>
    </div>
  </div>
} @else {
  <button class="sig-open-add" (click)="showForm.set(true)">＋ 新增訊號</button>
}

@if (inactive.length > 0) {
  <details style="margin-top:16px">
    <summary style="font-size:12px;color:var(--text-muted);cursor:pointer;padding:4px 0;user-select:none">
      歷史訊號（{{ inactive.length }}）
    </summary>
    <div class="signals-list" style="margin-top:8px">
      @for (sig of inactive; track sig.id) {
        <ng-container *ngTemplateOutlet="sigItem; context:{sig, code}"></ng-container>
      }
    </div>
  </details>
}

<ng-template #sigItem let-sig="sig" let-code="code">
  <div class="signal-item sig-{{ sig.status }}">
    <div class="signal-header">
      <span class="sig-dir {{ dirClass(sig.direction) }}">{{ dirLabel(sig.direction) }}</span>
      <span class="sig-source">{{ sig.source }}</span>
      <span class="sig-date">{{ fmtDate(sig.date) }}</span>
    </div>
    <div class="signal-body">
      <div class="sig-condition">{{ sig.condition }}</div>
      @if (sig.price) { <span class="sig-price">{{ sig.price }}</span> }
    </div>
    <div class="signal-footer">
      <span class="sig-status {{ sigStatusClass(sig.status) }}">{{ sigStatusLabel(sig.status) }}</span>
      @if (sig.invalidReason) { <span class="sig-invalid-reason">→ {{ sig.invalidReason }}</span> }
      <div class="sig-actions">
        @if (sig.status === 'active') {
          <button class="sig-action-btn" (click)="updateSig(code, sig, 'triggered', '')">已實現</button>
          <button class="sig-action-btn" (click)="updateSig(code, sig, 'expired', '')">已過期</button>
          <button class="sig-action-btn" (click)="markInvalid(sig)">已失效</button>
        }
        <button class="sig-action-btn danger" (click)="deleteSig(code, sig.id)">刪除</button>
      </div>
    </div>
    @if (invalidPending()===sig.id) {
      <div style="padding:8px 12px;border-top:1px solid var(--border);background:var(--bg);display:flex;gap:6px">
        <input class="sig-form-input" placeholder="失效原因（如：跌破5日線）"
          [value]="invalidReason()" (input)="invalidReason.set(asStr($event))"
          (keydown.enter)="confirmInvalid(code, sig)" style="font-size:12px" />
        <button class="sig-add-btn" style="font-size:12px;padding:6px 12px"
          (click)="confirmInvalid(code, sig)">確認</button>
      </div>
    }
  </div>
</ng-template>
  `,
  imports: [],
})
export class SignalsTabComponent {
  @Input() entry!: () => { code: string };

  showForm   = signal(false);
  addingSrc  = signal(false);
  newSrc     = signal('');
  invalidPending = signal('');
  invalidReason  = signal('');
  fmtDate = fmtDate;

  form = { direction: 'enter', source: '', price: '', condition: '' };

  constructor(public state: AppStateService, private api: ApiService) {
    this.form.source = state.sources()[0] ?? '';
  }

  dirLabel(d: string) { return SIG_DIR_LABELS[d]; }
  dirClass(d: string) { return SIG_DIR_CLASS[d]; }
  sigStatusLabel(s: string) { return SIG_STATUS_LABELS[s]; }
  sigStatusClass(s: string) { return SIG_STATUS_CLASS[s]; }
  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }

  onSourceChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (v === '__new__') { this.addingSrc.set(true); }
    else { this.form.source = v; }
  }

  async confirmSrc() {
    const name = this.newSrc().trim();
    if (!name) return;
    await this.api.addSource(name);
    this.state.addSource(name);
    this.form.source = name;
    this.newSrc.set('');
    this.addingSrc.set(false);
  }

  async addSignal(code: string) {
    if (!this.form.condition.trim()) return;
    const sig: Signal = {
      id: uid(), date: Date.now(),
      direction: this.form.direction as Signal['direction'],
      source: this.form.source || '未知來源',
      condition: this.form.condition.trim(),
      price: this.form.price.trim(),
      status: 'active', invalidReason: '',
    };
    await this.api.createSignal(code, sig);
    this.state.addSignal(code, sig);
    this.form.condition = ''; this.form.price = '';
    this.showForm.set(false);
  }

  async updateSig(code: string, sig: Signal, status: Signal['status'], invalidReason: string) {
    const updated = { ...sig, status, invalidReason };
    await this.api.patchSignal(sig.id, { status, invalidReason });
    this.state.updateSignal(code, sig.id, updated);
  }

  markInvalid(sig: Signal) {
    this.invalidPending.set(sig.id);
    this.invalidReason.set(sig.invalidReason || '');
  }

  async confirmInvalid(code: string, sig: Signal) {
    await this.updateSig(code, sig, 'invalid', this.invalidReason());
    this.invalidPending.set('');
  }

  async deleteSig(code: string, id: string) {
    await this.api.deleteSignal(id);
    this.state.deleteSignal(code, id);
  }
}
