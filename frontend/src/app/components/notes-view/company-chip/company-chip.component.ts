import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Entry } from '../../../models/types';
import { STATUS_CLASS, STATUS_LABELS, STATUS_ORDER } from '../../../utils';

@Component({
  selector: 'app-company-chip',
  template: `
<span class="company-chip {{ statusClass }}"
  [title]="entry.thesis || (statusLabel + '　點擊編輯')"
  (click)="edit.emit()">
  <span class="chip-dot" (click)="cycleStatus($event)" title="點擊切換狀態" style="cursor:pointer"></span>
  <span class="chip-code">{{ entry.code }}</span>
  <span class="chip-name">{{ entry.name }}</span>
  @if (hasNote) { <span class="chip-has-note" title="有研究筆記"></span> }
  <span class="chip-del" (click)="onDelete($event)">✕</span>
</span>
  `,
})
export class CompanyChipComponent {
  @Input() entry!: Entry;
  @Output() cycled = new EventEmitter<string>();
  @Output() deleted = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();

  get statusClass() { return STATUS_CLASS[this.entry.status]; }
  get statusLabel() { return STATUS_LABELS[this.entry.status]; }
  get hasNote() { return !!(this.entry.thesis || this.entry.memo); }

  cycleStatus(e: Event) {
    e.stopPropagation();
    const i = STATUS_ORDER.indexOf(this.entry.status);
    this.cycled.emit(STATUS_ORDER[(i + 1) % STATUS_ORDER.length]);
  }

  onDelete(e: Event) {
    e.stopPropagation();
    this.deleted.emit();
  }
}
