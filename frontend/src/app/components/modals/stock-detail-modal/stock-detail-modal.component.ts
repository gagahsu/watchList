import { Component, ViewChild, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { StockService } from '../../../services/stock.service';
import { SignalsTabComponent } from './signals-tab/signals-tab.component';
import { TradesTabComponent } from './trades-tab/trades-tab.component';
import { Entry, TrackedStock } from '../../../models/types';
import { STATUS_CLASS, STATUS_LABELS } from '../../../utils';

@Component({
  selector: 'app-stock-detail-modal',
  imports: [SignalsTabComponent, TradesTabComponent],
  template: `
@let closeInfo = stock.closeMap()[code()];

<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
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
        @let ac = activeSigCount(code());
        @if (ac > 0) { <span class="badge">{{ ac }}</span> }
      </button>
      <button class="detail-tab" [class.active]="tab()==='trades'" (click)="tab.set('trades')">
        交易記錄
        @let tc = tradeCount(code());
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
                  (click)="setStatus(s)">{{ label(s) }}</button>
              }
            </div>
          </div>
          @if (isEntry()) {
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
          } @else {
            <div style="display:flex;gap:10px;margin-bottom:16px">
              <div style="width:35%">
                <div class="detail-label">股票代碼</div>
                <div class="detail-input" style="background:var(--sidebar-bg);color:var(--text-muted)">{{ code() }}</div>
              </div>
              <div style="flex:1">
                <div class="detail-label">公司名稱</div>
                <div class="detail-input" style="background:var(--sidebar-bg);color:var(--text-muted)">{{ name() }}</div>
              </div>
            </div>
          }
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
        @if (!isEntry()) {
          <button class="btn-cancel" style="color:var(--red);border-color:var(--red)" (click)="removeTracked()">移除追蹤</button>
        }
        <button class="btn-cancel" (click)="close()">取消</button>
        <button class="btn-primary" (click)="save()">儲存</button>
      </div>
    } @else {
      <div class="detail-footer">
        <button class="btn-primary" style="flex:none;padding:10px 20px" (click)="done()">完成</button>
      </div>
    }
  </div>
</div>
  `,
})
export class StockDetailModalComponent {
  @ViewChild(TradesTabComponent) tradesTab?: TradesTabComponent;

  tab        = signal<'info'|'signals'|'trades'>('info');
  code       = signal('');
  name       = signal('');
  status     = signal<Entry['status']>('tracking');
  thesis     = signal('');
  memo       = signal('');
  stopLoss   = signal('');
  takeProfit = signal('');
  statuses = ['tracking', 'holding'];

  entryFn: () => { code: string } = () => ({ code: this.code() });

  constructor(
    public state: AppStateService,
    private api: ApiService,
    public stock: StockService,
  ) {
    const target = state.editTarget()!;
    if (target.kind === 'entry') {
      const e = target.entry;
      this.code.set(e.code); this.name.set(e.name);
      this.status.set(e.status); this.thesis.set(e.thesis); this.memo.set(e.memo);
    } else {
      const t = state.tracked().find(x => x.code === target.code);
      const c = target.code;
      this.code.set(c);
      this.name.set(stock.codeToName()[c] || c);
      if (t) { this.status.set(t.status); this.thesis.set(t.thesis); this.memo.set(t.memo);
               this.stopLoss.set(t.stopLoss ?? ''); this.takeProfit.set(t.takeProfit ?? ''); }
      if (target.tab) this.tab.set(target.tab);
    }
  }

  isEntry() { return this.state.editTarget()?.kind === 'entry'; }

  statusClass() { return STATUS_CLASS[this.status()]; }
  statusLabel() { return STATUS_LABELS[this.status()]; }
  label(s: string) { return STATUS_LABELS[s]; }
  setStatus(s: string) { this.status.set(s as Entry['status']); }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  asTxtStr(e: Event) { return (e.target as HTMLTextAreaElement).value; }
  activeSigCount(code: string) { return (this.state.signals()[code] ?? []).filter(s => s.status === 'active').length; }
  tradeCount(code: string) { return (this.state.trades()[code] ?? []).length; }

  onCode(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.code.set(v);
    const n = this.stock.codeToName()[v];
    if (n) this.name.set(n);
  }

  async save() {
    const target = this.state.editTarget()!;
    if (target.kind === 'entry') {
      const updated: Entry = {
        ...target.entry,
        code: this.code().trim(), name: this.name().trim() || this.code().trim(),
        status: this.status(), thesis: this.thesis().trim(), memo: this.memo().trim(),
      };
      await this.api.patchEntry(updated.id, updated);
      this.state.saveEntry(this.state.activeNoteId()!, target.rowId, updated);
    } else {
      const patch = { status: this.status(), thesis: this.thesis().trim(), memo: this.memo().trim() };
      const updated = await this.api.patchTracked(this.code(), patch);
      this.state.updateTracked(updated);
    }
    this.close();
  }

  async removeTracked() {
    await this.api.deleteTracked(this.code());
    this.state.removeTracked(this.code());
    this.close();
  }

  async done() {
    if (this.tab() === 'trades' && this.tradesTab) {
      await this.tradesTab.saveSLTP(this.code());
    }
    this.close();
  }

  close() { this.state.editTarget.set(null); }
  private mdOnOverlay = false;
  trackMd(e: MouseEvent) { this.mdOnOverlay = e.target === e.currentTarget; }
  closeIfBg(e: MouseEvent) {
    if (this.mdOnOverlay && e.target === e.currentTarget) this.close();
    this.mdOnOverlay = false;
  }
}
