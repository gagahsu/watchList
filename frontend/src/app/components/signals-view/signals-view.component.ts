import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { StockService } from '../../services/stock.service';
import { Signal } from '../../models/types';
import { SIG_DIR_CLASS, SIG_DIR_LABELS, STATUS_CLASS, STATUS_LABELS, fmtDate } from '../../utils';

interface SigRow {
  code: string;
  name: string;
  trackStatus: string;
  activeCount: number;
  totalCount: number;
  latestSig: Signal | null;
  latestDate: number;
}

@Component({
  selector: 'app-signals-view',
  template: `
@if (rows().length === 0 && !showAll()) {
  <div class="sov-empty">
    目前沒有有效訊號
    <br>
    <button class="empty-btn" style="margin-top:12px" (click)="showAll.set(true)">顯示全部個股</button>
  </div>
} @else if (rows().length === 0) {
  <div class="sov-empty">尚無訊號記錄</div>
} @else {
  <!-- toolbar -->
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <span style="font-size:13px;color:var(--text-muted)">{{ rows().length }} 支個股</span>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;margin-left:auto">
      <input type="checkbox" [checked]="showAll()" (change)="showAll.set(!showAll())" />
      顯示無有效訊號
    </label>
  </div>

  <table class="supply-table sov-table">
    <thead>
      <tr>
        <th style="width:70px">代碼</th>
        <th>名稱</th>
        <th style="width:76px">狀態</th>
        <th style="width:68px;text-align:center">有效</th>
        <th>最新訊號</th>
        <th style="width:72px;text-align:right">日期</th>
      </tr>
    </thead>
    <tbody>
      @for (r of rows(); track r.code) {
        <tr class="sov-row" (click)="open(r.code)">
          <td>
            <span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--gold)">
              {{ r.code }}
            </span>
          </td>
          <td style="font-weight:600">{{ r.name }}</td>
          <td>
            <span class="company-chip {{ statusClass(r.trackStatus) }}"
              style="font-size:11px;padding:2px 7px">
              <span class="chip-dot"></span>{{ statusLabel(r.trackStatus) }}
            </span>
          </td>
          <td style="text-align:center">
            @if (r.activeCount > 0) {
              <span style="background:var(--gold);color:white;border-radius:10px;padding:1px 8px;font-size:12px;font-weight:600">
                {{ r.activeCount }}
              </span>
            } @else {
              <span style="color:var(--border);font-size:12px">—</span>
            }
          </td>
          <td>
            @if (r.latestSig) {
              <div style="display:flex;align-items:baseline;gap:7px;min-width:0">
                <span class="sig-dir {{ dirClass(r.latestSig.direction) }}"
                  style="font-size:11px;padding:1px 6px;flex-shrink:0">
                  {{ dirLabel(r.latestSig.direction) }}
                </span>
                <span style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  {{ r.latestSig.condition }}
                </span>
              </div>
            } @else {
              <span style="color:var(--border);font-size:12px">—</span>
            }
          </td>
          <td style="text-align:right;font-size:12px;color:var(--text-muted);white-space:nowrap">
            {{ r.latestDate ? fmtDate(r.latestDate) : '—' }}
          </td>
        </tr>
      }
    </tbody>
  </table>
}
  `,
})
export class SignalsViewComponent {
  showAll = signal(false);
  fmtDate = fmtDate;

  constructor(public state: AppStateService, private stock: StockService) {}

  stockMap = computed(() => {
    const m: Record<string, { name: string; status: string }> = {};
    this.state.notes().forEach(n => n.rows.forEach(r => r.entries.forEach(e => {
      if (!m[e.code]) m[e.code] = { name: e.name, status: e.status };
    })));
    return m;
  });

  rows = computed<SigRow[]>(() => {
    const result: SigRow[] = [];
    for (const [code, sigs] of Object.entries(this.state.signals())) {
      if (!sigs.length) continue;
      const activeCount = sigs.filter(s => s.status === 'active').length;
      if (!this.showAll() && activeCount === 0) continue;

      const sorted = [...sigs].sort((a, b) => b.date - a.date);
      const latestSig = sorted[0] ?? null;
      const stockInfo = this.stockMap()[code];
      const tracked = this.state.tracked().find(t => t.code === code);

      result.push({
        code,
        name: stockInfo?.name ?? this.stock.codeToName()[code] ?? code,
        trackStatus: stockInfo?.status ?? tracked?.status ?? 'tracking',
        activeCount,
        totalCount: sigs.length,
        latestSig,
        latestDate: latestSig?.date ?? 0,
      });
    }
    return result.sort((a, b) => b.latestDate - a.latestDate);
  });

  open(code: string) {
    this.state.editTarget.set({ kind: 'tracked', code, tab: 'signals' });
  }

  dirLabel(d: string) { return SIG_DIR_LABELS[d]; }
  dirClass(d: string) { return SIG_DIR_CLASS[d]; }
  statusClass(s: string) { return STATUS_CLASS[s]; }
  statusLabel(s: string) { return STATUS_LABELS[s]; }
}
