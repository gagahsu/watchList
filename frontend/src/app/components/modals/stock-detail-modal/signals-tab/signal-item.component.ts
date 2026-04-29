import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { Signal } from '../../../../models/types';
import { SIG_DIR_CLASS, SIG_DIR_LABELS, SIG_STATUS_CLASS, SIG_STATUS_LABELS, fmtDate } from '../../../../utils';

@Component({
  selector: 'app-signal-item',
  template: `
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
    <span class="sig-status {{ statusClass(sig.status) }}">{{ statusLabel(sig.status) }}</span>
    @if (sig.invalidReason) { <span class="sig-invalid-reason">&#x2192; {{ sig.invalidReason }}</span> }
    <div class="sig-actions">
      @if (sig.status === 'active') {
        <button class="sig-action-btn" (click)="statusChange.emit({status:'triggered',reason:''})">已實現</button>
        <button class="sig-action-btn" (click)="statusChange.emit({status:'expired',reason:''})">已過期</button>
        <button class="sig-action-btn" (click)="showInvalid.set(!showInvalid())">已失效</button>
      }
      <button class="sig-action-btn danger" (click)="delete.emit()">刪除</button>
    </div>
  </div>
  @if (showInvalid()) {
    <div style="padding:8px 12px;border-top:1px solid var(--border);background:var(--bg);display:flex;gap:6px">
      <input class="sig-form-input" placeholder="失效原因"
        [value]="reason()" (input)="reason.set(asStr($event))"
        (keydown.enter)="confirmInvalid()" style="font-size:12px" />
      <button class="sig-add-btn" style="font-size:12px;padding:6px 12px" (click)="confirmInvalid()">確認</button>
    </div>
  }
</div>
  `,
})
export class SignalItemComponent {
  @Input() sig!: Signal;
  @Output() statusChange = new EventEmitter<{ status: Signal['status']; reason: string }>();
  @Output() delete = new EventEmitter<void>();

  showInvalid = signal(false);
  reason = signal('');
  fmtDate = fmtDate;

  dirLabel(d: string) { return SIG_DIR_LABELS[d]; }
  dirClass(d: string) { return SIG_DIR_CLASS[d]; }
  statusLabel(s: string) { return SIG_STATUS_LABELS[s]; }
  statusClass(s: string) { return SIG_STATUS_CLASS[s]; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }

  confirmInvalid() {
    this.statusChange.emit({ status: 'invalid', reason: this.reason() });
    this.showInvalid.set(false);
  }
}
