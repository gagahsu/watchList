import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { FundHolding } from '../../models/types';
import { uid } from '../../utils';

@Component({
  selector: 'app-fund-holdings-view',
  template: `
<!-- Summary bar -->
@if (state.funds().length > 0) {
  <div class="fv-summary-bar">
    <div class="fv-summary-item">
      <span class="fv-summary-label">總投入成本</span>
      <span class="fv-summary-value">{{ fmtNT(totalCost()) }}</span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">總市值</span>
      <span class="fv-summary-value">{{ fmtNT(totalMV()) }}</span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">未實現損益</span>
      <span class="fv-summary-value" [class.fv-pos]="totalPnL() >= 0" [class.fv-neg]="totalPnL() < 0">
        {{ totalPnL() >= 0 ? '+' : '' }}{{ fmtNT(totalPnL()) }}
      </span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">報酬率</span>
      <span class="fv-summary-value" [class.fv-pos]="totalPnL() >= 0" [class.fv-neg]="totalPnL() < 0">
        {{ totalCost() > 0 ? (totalPnL() >= 0 ? '+' : '') + (totalPnL() / totalCost() * 100).toFixed(2) + '%' : '—' }}
      </span>
    </div>
  </div>
}

@if (state.funds().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:.4">🏦</div>
    <div class="empty-title">尚無基金持倉</div>
    <div class="empty-sub">新增基金，追蹤投入成本與目前市值</div>
    <button class="empty-btn" (click)="openNew()">＋ 新增基金</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">{{ state.funds().length }} 筆 · 點擊列編輯</span>
    <button class="idx-add-btn" (click)="openNew()">＋ 新增基金</button>
  </div>

  <table class="index-table">
    <thead><tr>
      <th>基金名稱</th>
      <th style="text-align:right">投入成本</th>
      <th style="text-align:right">目前市值</th>
      <th style="text-align:right">損益</th>
      <th style="text-align:right">報酬率</th>
      <th>備註</th>
    </tr></thead>
    <tbody>
      @for (f of state.funds(); track f.id) {
        @let pnl = f.marketValue - f.cost;
        @let pct = f.cost > 0 ? pnl / f.cost * 100 : null;
        <tr (click)="openEdit(f)">
          <td style="font-weight:600">{{ f.name }}</td>
          <td class="fv-num">{{ fmtNT(f.cost) }}</td>
          <td class="fv-num">{{ fmtNT(f.marketValue) }}</td>
          <td class="fv-num" [class.fv-pos]="pnl >= 0" [class.fv-neg]="pnl < 0">
            {{ (pnl >= 0 ? '+' : '') + fmtNT(pnl) }}
          </td>
          <td class="fv-num" [class.fv-pos]="pnl >= 0" [class.fv-neg]="pnl < 0">
            {{ pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—' }}
          </td>
          <td style="font-size:13px;color:var(--text-muted)">{{ f.note || '—' }}</td>
        </tr>
      }
    </tbody>
  </table>
}

<!-- Modal -->
@if (openModal()) {
  <div class="modal-overlay" (click)="close()">
    <div class="modal-box" (click)="$event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:17px;font-weight:700">{{ isNew() ? '新增基金' : '編輯基金' }}</div>
        <button class="sidebar-close-btn" (click)="close()">×</button>
      </div>

      <div class="broker-form-group">
        <div class="modal-label">基金名稱</div>
        <input class="modal-input" placeholder="如：統一奔騰基金"
          [value]="f.name" (input)="f.name=asStr($event)" />
      </div>
      <div class="broker-form-row" style="margin-top:12px">
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">投入成本 (TWD)</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="如：250000"
            [value]="f.cost || ''" (input)="f.cost=toNum($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">目前市值 (TWD)</div>
          <input class="modal-input" type="number" step="1" min="0" placeholder="如：513982"
            [value]="f.marketValue || ''" (input)="f.marketValue=toNum($event)" />
        </div>
      </div>
      @if (f.cost > 0 && f.marketValue > 0) {
        @let pnl = f.marketValue - f.cost;
        <div style="font-size:12px;margin-top:8px;color:var(--text-muted);text-align:right">
          損益預覽：
          <span [style.color]="pnl >= 0 ? 'var(--green,#27ae60)' : 'var(--red,#c0392b)'">
            {{ (pnl >= 0 ? '+' : '') + fmtNT(pnl) }}
            （{{ (pnl >= 0 ? '+' : '') + (pnl / f.cost * 100).toFixed(2) }}%）
          </span>
        </div>
      }
      <div class="broker-form-group" style="margin-top:12px">
        <div class="modal-label">備註 (選填)</div>
        <input class="modal-input" placeholder="如：含低檔智動投"
          [value]="f.note" (input)="f.note=asStr($event)" />
      </div>

      <div style="display:flex;gap:8px;margin-top:18px">
        <button class="btn-primary" style="flex:1" (click)="save()" [disabled]="!f.name.trim()">
          {{ isNew() ? '新增' : '儲存' }}
        </button>
        <button class="btn-cancel" (click)="close()">取消</button>
      </div>
      @if (!isNew()) {
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="sig-action-btn danger" style="width:100%" (click)="deleteFund()">
            刪除此基金
          </button>
        </div>
      }
    </div>
  </div>
}
  `,
  styles: [`
    .fv-summary-bar {
      display:flex; flex-wrap:wrap; gap:12px 24px;
      background:var(--panel-bg); border:1.5px solid var(--border);
      border-radius:10px; padding:14px 18px; margin-bottom:16px;
    }
    .fv-summary-item { display:flex; flex-direction:column; gap:4px; }
    .fv-summary-label { font-size:12px; color:var(--text-muted); font-weight:700; }
    .fv-summary-value { font-size:18px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .fv-num { text-align:right; font-family:'JetBrains Mono',monospace; font-size:13px; white-space:nowrap; }
    .fv-pos { color:var(--green,#27ae60) !important; }
    .fv-neg { color:var(--red,#c0392b) !important; }
  `],
})
export class FundHoldingsViewComponent {
  openModal = signal<'new' | FundHolding | null>(null);
  f = this.blank();

  constructor(public state: AppStateService, private api: ApiService) {}

  blank() { return { name: '', cost: 0, marketValue: 0, note: '' }; }
  isNew()  { return this.openModal() === 'new'; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  toNum(e: Event) { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `${n < 0 ? '-' : ''}NT$${Math.round(abs).toLocaleString()}`;
  }

  totalCost = computed(() => this.state.funds().reduce((s, f) => s + f.cost, 0));
  totalMV   = computed(() => this.state.funds().reduce((s, f) => s + f.marketValue, 0));
  totalPnL  = computed(() => this.totalMV() - this.totalCost());

  openNew()  { this.f = this.blank(); this.openModal.set('new'); }
  openEdit(fund: FundHolding) {
    this.f = { name: fund.name, cost: fund.cost, marketValue: fund.marketValue, note: fund.note };
    this.openModal.set(fund);
  }
  close() { this.openModal.set(null); }

  async save() {
    if (!this.f.name.trim()) return;
    if (this.isNew()) {
      const fund: FundHolding = { id: uid(), ...this.f, name: this.f.name.trim(), note: this.f.note.trim() };
      const saved = await this.api.createFund(fund);
      this.state.addFund(saved);
    } else {
      const id = (this.openModal() as FundHolding).id;
      const saved = await this.api.patchFund(id, { ...this.f, name: this.f.name.trim(), note: this.f.note.trim() });
      this.state.updateFund(saved);
    }
    this.close();
  }

  async deleteFund() {
    const id = (this.openModal() as FundHolding).id;
    await this.api.deleteFund(id);
    this.state.removeFund(id);
    this.close();
  }
}
