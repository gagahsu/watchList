import { Component, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { StockService } from '../../../services/stock.service';
import { STATUS_LABELS, uid } from '../../../utils';
import { TrackingStatus } from '../../../models/types';

@Component({
  selector: 'app-add-company-modal',
  template: `
<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
  <div class="modal-box">
    <div class="modal-title">新增股票</div>

    <div class="modal-field">
      <label class="modal-label">股票代碼</label>
      <input #codeEl class="modal-input" placeholder="如：2330 或 台積電"
        [value]="code()" (input)="onCode($event)" (keydown.enter)="submit()" autofocus />
      @if (sugg().length > 0) {
        <div class="autocomplete-list">
          @for (item of sugg(); track item[0]) {
            <div class="autocomplete-item" (click)="pick(item[0], item[1])">
              <span class="ac-code">{{ item[0] }}</span>
              <span>{{ item[1] }}</span>
              @if (item[2]) { <span class="ac-industry">{{ item[2] }}</span> }
            </div>
          }
        </div>
      }
    </div>

    <div class="modal-field">
      <label class="modal-label">公司名稱</label>
      <input class="modal-input modal-input-text" placeholder="自動帶入或手動填寫"
        [value]="name()" (input)="name.set(asStr($event))" (keydown.enter)="submit()" />
    </div>

    <div class="modal-field">
      <label class="modal-label">追蹤狀態</label>
      <div class="status-selector">
        @for (s of statuses; track s) {
          <button class="status-btn status-btn-{{ s }}" [class.active]="status()===s"
            (click)="setStatus(s)">{{ label(s) }}</button>
        }
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-cancel" (click)="close()">取消</button>
      <button class="btn-primary" (click)="submit()">新增</button>
    </div>
  </div>
</div>
  `,
})
export class AddCompanyModalComponent {
  code   = signal('');
  name   = signal('');
  status = signal<TrackingStatus>('tracking');
  sugg   = signal<[string, string, string][]>([]);
  statuses = ['tracking', 'holding'];

  constructor(
    private state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  label(s: string) { return STATUS_LABELS[s]; }
  setStatus(s: string) { this.status.set(s as TrackingStatus); }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }

  onCode(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.code.set(v);
    if (v.length >= 1) {
      this.sugg.set(this.stock.search(v, 8));
      // code → name (exact code match)
      const byCode = this.stock.codeToName()[v];
      if (byCode) {
        this.name.set(byCode);
      } else {
        // name → code (exact name match, e.g. user typed "聯發科")
        const byName = this.stock.nameToEntry(v);
        if (byName) { this.code.set(byName.code); this.name.set(byName.name); this.sugg.set([]); }
      }
    } else {
      this.sugg.set([]);
      if (!v) this.name.set('');
    }
  }

  pick(c: string, n: string) { this.code.set(c); this.name.set(n); this.sugg.set([]); }

  async submit() {
    const code = this.code().trim();
    if (!code) return;
    const name = this.name().trim() || code;
    const rowId = this.state.addToRowId();

    if (rowId) {
      const entry = { id: uid(), code, name, status: this.status(), thesis: '', memo: '' };
      await this.api.createEntry(rowId, entry);
      this.state.addEntry(this.state.activeNoteId()!, rowId, entry);
      this.close();
      this.state.editTarget.set({ kind: 'entry', rowId, entry });
    } else {
      const t = await this.api.addTracked({ code, status: this.status(), thesis: '', memo: '', addedAt: Date.now() });
      this.state.addTracked(t);
      this.close();
      this.state.editTarget.set({ kind: 'tracked', code });
    }
  }

  private mdOnOverlay = false;
  trackMd(e: MouseEvent) { this.mdOnOverlay = e.target === e.currentTarget; }
  closeIfBg(e: MouseEvent) {
    if (this.mdOnOverlay && e.target === e.currentTarget) this.close();
    this.mdOnOverlay = false;
  }
  close() { this.state.addToRowId.set(null); this.state.addingDirect.set(false); }
}
