import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { Signal } from '../../models/types';
import { SIG_DIR_CLASS, SIG_DIR_LABELS, SIG_STATUS_CLASS, SIG_STATUS_LABELS, STATUS_CLASS, STATUS_LABELS, fmtDate } from '../../utils';

@Component({
  selector: 'app-signals-view',
  template: `
@if (allEntries().length === 0) {
  <div class="sov-empty">尚無訊號記錄<br>點擊任一股票標籤 → 訊號記錄 → 新增訊號</div>
} @else {
  <div class="sov-filters">
    <div style="display:flex;gap:4px">
      @for (d of dirs; track d.v) {
        <button class="sov-filter-btn" [class.active]="filterDir()===d.v" (click)="filterDir.set(d.v)">{{ d.l }}</button>
      }
    </div>
    <div style="display:flex;gap:4px">
      @for (s of statuses; track s.v) {
        <button class="sov-filter-btn" [class.active]="filterStatus()===s.v" (click)="filterStatus.set(s.v)">{{ s.l }}</button>
      }
    </div>
    <div style="margin-left:auto;font-size:12px;color:var(--text-muted)">{{ filtered().length }} 筆訊號</div>
  </div>

  @if (groups().length === 0) {
    <div class="sov-empty">沒有符合篩選條件的訊號</div>
  }

  @for (g of groups(); track g.code) {
    <div class="sov-stock-group">
      <div class="sov-stock-header">
        <span class="sov-stock-code">{{ g.code }}</span>
        <span class="sov-stock-name">{{ g.name }}</span>
        <div class="sov-stock-status">
          <span class="company-chip {{ statusClass(g.status) }}" style="font-size:11px;padding:2px 8px">
            <span class="chip-dot"></span>{{ statusLabel(g.status) }}
          </span>
        </div>
      </div>
      <div class="signals-list">
        @for (sig of g.sigs; track sig.id) {
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
                  <button class="sig-action-btn" (click)="updateSig(g.code, sig, 'triggered','')">已實現</button>
                  <button class="sig-action-btn" (click)="updateSig(g.code, sig, 'expired','')">已過期</button>
                  <button class="sig-action-btn" (click)="updateSig(g.code, sig, 'invalid','')">已失效</button>
                }
                <button class="sig-action-btn danger" (click)="deleteSig(g.code, sig.id)">刪除</button>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  }
}
  `,
})
export class SignalsViewComponent {
  filterDir   = signal('all');
  filterStatus = signal('active');
  fmtDate = fmtDate;

  dirs = [
    { v: 'all', l: '全部方向' }, { v: 'enter', l: '進場' },
    { v: 'exit', l: '出場' }, { v: 'watch', l: '觀察' },
  ];
  statuses = [
    { v: 'all', l: '全部狀態' }, { v: 'active', l: '有效' },
    { v: 'triggered', l: '已實現' }, { v: 'invalid', l: '已失效' }, { v: 'expired', l: '已過期' },
  ];

  constructor(public state: AppStateService, private api: ApiService) {}

  stockMap = computed(() => {
    const m: Record<string, { name: string; status: string }> = {};
    this.state.notes().forEach(n => n.rows.forEach(r => r.entries.forEach(e => {
      if (!m[e.code]) m[e.code] = { name: e.name, status: e.status };
    })));
    return m;
  });

  allEntries = computed(() => {
    const list: (Signal & { code: string })[] = [];
    Object.entries(this.state.signals()).forEach(([code, sigs]) =>
      sigs.forEach(s => list.push({ ...s, code })),
    );
    return list.sort((a, b) => b.date - a.date);
  });

  filtered = computed(() =>
    this.allEntries().filter(s =>
      (this.filterDir() === 'all' || s.direction === this.filterDir()) &&
      (this.filterStatus() === 'all' || s.status === this.filterStatus()),
    ),
  );

  groups = computed(() => {
    const m = new Map<string, { code: string; name: string; status: string; sigs: (Signal & { code: string })[] }>();
    this.filtered().forEach(s => {
      if (!m.has(s.code)) {
        const stock = this.stockMap()[s.code] ?? { name: s.code, status: 'watching' };
        m.set(s.code, { code: s.code, ...stock, sigs: [] });
      }
      m.get(s.code)!.sigs.push(s);
    });
    return [...m.values()];
  });

  dirLabel(d: string) { return SIG_DIR_LABELS[d]; }
  dirClass(d: string) { return SIG_DIR_CLASS[d]; }
  sigStatusLabel(s: string) { return SIG_STATUS_LABELS[s]; }
  sigStatusClass(s: string) { return SIG_STATUS_CLASS[s]; }
  statusClass(s: string) { return STATUS_CLASS[s]; }
  statusLabel(s: string) { return STATUS_LABELS[s]; }

  async updateSig(code: string, sig: Signal, status: Signal['status'], invalidReason: string) {
    const updated = { ...sig, status, invalidReason };
    await this.api.patchSignal(sig.id, { status, invalidReason });
    this.state.updateSignal(code, sig.id, updated);
  }

  async deleteSig(code: string, id: string) {
    await this.api.deleteSignal(id);
    this.state.deleteSignal(code, id);
  }
}
