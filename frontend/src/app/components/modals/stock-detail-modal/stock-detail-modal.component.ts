import { Component, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { StockService } from '../../../services/stock.service';
import { SignalsTabComponent } from './signals-tab/signals-tab.component';
import { TradesTabComponent } from './trades-tab/trades-tab.component';
import { Entry } from '../../../models/types';
import { STATUS_CLASS, STATUS_LABELS } from '../../../utils';

@Component({
  selector: 'app-stock-detail-modal',
  imports: [SignalsTabComponent, TradesTabComponent],
  template: `
@let target = state.editTarget()!;
@let e = target.entry;
@let closeInfo = stock.closeMap()[e.code];

<div class="modal-overlay" (click)="closeIfBg($event)">
  <div class="detail-modal-box">
    <!-- Header -->
    <div class="detail-header">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:10px">
          <div class="detail-header-code">{{ code() || '----' }}</div>
          @if (closeInfo?.close != null) {
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:white">
              {{ closeInfo!.close!.toLocaleString() }}
            </div>
          }
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="detail-header-name">{{ name() || '公司名稱' }}</div>
          @if (closeInfo?.updatedAt) {
            <div style="font-size:11px;color:rgba(255,255,255,0.55)">{{ closeInfo!.updatedAt }} 收盤</div>
          }
        </div>
      </div>
      <div class="detail-header-right">
        <span class="company-chip {{ statusClass() }}" style="font-size:12px;padding:4px 10px">
          <span class="chip-dot"></span>{{ statusLabel() }}
        </span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="detail-tabs">
      <button class="detail-tab" [class.active]="tab()==='info'" (click)="tab.set('info')">基本資料</button>
      <button class="detail-tab" [class.active]="tab()==='signals'" (click)="tab.set('signals')">
        訊號記錄
        @let ac = activeSigCount(e.code);
        @if (ac > 0) { <span class="badge">{{ ac }}</span> }
      </button>
      <button class="detail-tab" [class.active]="tab()==='trades'" (click)="tab.set('trades')">
        交易記錄
        @let tc = tradeCount(e.code);
        @if (tc > 0) { <span class="badge badge-gray">{{ tc }}</span> }
      </button>
    </div>

    <!-- Body -->
    <div class="detail-body">
      @switch (tab()) {
        @case ('info') {
          <div class="detail-field">
            <div class="detail-label">追蹤狀態</div>
            <div class="detail-status-row">
              @for (s of statuses; track s) {
                <button class="status-btn status-btn-{{ s }}" [class.active]="status()===s"
                  (click)="status.set(s)">{{ label(s) }}</button>
              }
            </div>
          </div>
          <div style="display:flex;gap:10px">
            <div class="detail-field" style="width:35%">
              <div class="detail-label">股票代碼</div>
              <input class="detail-input" style="font-family:'JetBrains Mono',monospace"
                [value]="code()" (input)="onCode($event)" />
            </div>
            <div class="detail-field" style="flex:1">
              <div class="detail-label">公司名稱</div>
              <input class="detail-input" [value]="name()" (input)="name.set(asStr($event))" />
            </div>
          </div>
          <div class="detail-field">
            <div class="detail-label">投資主題 <span class="detail-label-hint">一句話描述核心邏輯</span></div>
            <input class="detail-input" placeholder="如：全球 BMC 供應龍頭，AI 伺服器升級受惠"
              [value]="thesis()" (input)="thesis.set(asStr($event))" />
          </div>
          <div class="detail-field" style="margin-bottom:0">
            <div class="detail-label">研究摘要 <span class="detail-label-hint">詳細筆記、財報重點、風險…</span></div>
            <textarea class="detail-textarea" placeholder="貼上公司介紹、研究心得…"
              [value]="memo()" (input)="memo.set(asTxtStr($event))"></textarea>
          </div>
        }
        @case ('signals') {
          <app-signals-tab [entry]="entryFn" />
        }
        @case ('trades') {
          <app-trades-tab [entry]="entryFn" />
        }
      }
    </div>

    <!-- Footer -->
    @if (tab() === 'info') {
      <div class="detail-footer">
        <button class="btn-cancel" (click)="close()">取消</button>
        <button class="btn-primary" (click)="save()">儲存</button>
      </div>
    } @else {
      <div class="detail-footer">
        <button class="btn-primary" style="flex:none;padding:10px 20px" (click)="close()">完成</button>
      </div>
    }
  </div>
</div>
  `,
})
export class StockDetailModalComponent {
  tab    = signal<'info'|'signals'|'trades'>('info');
  code   = signal('');
  name   = signal('');
  status = signal<Entry['status']>('watching');
  thesis = signal('');
  memo   = signal('');
  statuses = ['watching', 'tracking', 'holding'];

  entryFn: () => { code: string } = () => this.state.editTarget()!.entry;

  constructor(
    public state: AppStateService,
    private api: ApiService,
    public stock: StockService,
  ) {
    const e = state.editTarget()!.entry;
    this.code.set(e.code); this.name.set(e.name);
    this.status.set(e.status); this.thesis.set(e.thesis);
    this.memo.set(e.memo);
  }

  statusClass() { return STATUS_CLASS[this.status()]; }
  statusLabel() { return STATUS_LABELS[this.status()]; }
  label(s: string) { return STATUS_LABELS[s]; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  asTxtStr(e: Event) { return (e.target as HTMLTextAreaElement).value; }
  activeSigCount(code: string) { return (this.state.signals()[code] ?? []).filter(s => s.status === 'active').length; }
  tradeCount(code: string) { return (this.state.trades()[code] ?? []).length; }

  onCode(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.code.set(v);
    const name = this.stock.codeToName()[v];
    if (name) this.name.set(name);
  }

  async save() {
    const target = this.state.editTarget()!;
    const updated: Entry = {
      ...target.entry,
      code: this.code().trim(), name: this.name().trim() || this.code().trim(),
      status: this.status(), thesis: this.thesis().trim(), memo: this.memo().trim(),
    };
    await this.api.patchEntry(updated.id, updated);
    this.state.saveEntry(this.state.activeNoteId()!, target.rowId, updated);
    this.close();
  }

  close() { this.state.editTarget.set(null); }
  closeIfBg(e: MouseEvent) { if (e.target === e.currentTarget) this.close(); }
}
