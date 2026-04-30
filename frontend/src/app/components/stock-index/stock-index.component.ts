import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { STATUS_CLASS, STATUS_LABELS } from '../../utils';

interface IndexRow {
  code: string; name: string; bestStatus: string;
  refs: { noteId: string; noteTitle: string; category: string }[];
}

@Component({
  selector: 'app-stock-index',
  template: `
<div class="index-search-wrap">
  <span class="index-search-icon">🔍</span>
  <input class="index-search" placeholder="搜尋股票代碼、名稱、產業別…"
    [value]="search()" (input)="search.set(asStr($event))" />
</div>

@if (index().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">🔍</div>
    <div class="empty-title">尚無個股資料</div>
    <div class="empty-sub">直接新增個股開始追蹤，<br>或在筆記中整理供應鏈主題。</div>
    <button class="empty-btn" (click)="quickAddStock()">＋ 新增個股</button>
  </div>
} @else {
  <div class="index-summary">
    共 {{ filtered().length }} 支股票，跨 {{ state.notes().length }} 份筆記
    <span style="opacity:0.6"> · 點擊任一列開啟個股詳情</span>
  </div>
  <div class="index-toolbar">
    <button class="idx-add-btn" (click)="quickAddStock()">＋ 新增個股</button>
  </div>
  <table class="index-table">
    <thead><tr>
      <th style="width:80px">代碼</th>
      <th style="width:120px">名稱</th>
      <th style="width:110px">產業別</th>
      <th style="width:80px">狀態</th>
      <th style="width:90px">收盤價</th>
      <th>出現在</th>
    </tr></thead>
    <tbody>
      @for (row of filtered(); track row.code) {
        <tr (click)="openStock(row.code)">
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="idx-code">{{ row.code }}</span>
              @if (sigCount(row.code) > 0) {
                <span class="badge">{{ sigCount(row.code) }}</span>
              }
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:5px">
              <span class="idx-name">{{ row.name }}</span>
            </div>
          </td>
          <td>
            <span class="idx-industry">{{ stock.industryMap()[row.code] || '—' }}</span>
          </td>
          <td>
            <span class="company-chip {{ statusClass(row.bestStatus) }}"
              style="display:inline-flex;font-size:11px;padding:3px 8px">
              <span class="chip-dot"></span>
              {{ statusLabel(row.bestStatus) }}
            </span>
          </td>
          <td>
            @let ci = stock.closeMap()[row.code];
            @if (ci?.close != null) {
              <div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text)">
                {{ ci!.close!.toLocaleString() }}
              </div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
                {{ ci!.updatedAt }}
              </div>
            } @else {
              <span style="color:var(--border)">—</span>
            }
          </td>
          <td (click)="$event.stopPropagation()">
            <div class="idx-refs">
              @for (ref of row.refs; track ref.noteId + ref.category) {
                <span class="idx-ref-tag" (click)="goToNote(ref.noteId)" [title]="'前往：' + ref.noteTitle">
                  <span>{{ ref.noteTitle }}</span>
                  <span class="idx-ref-sep">›</span>
                  <span>{{ ref.category }}</span>
                </span>
              }
            </div>
          </td>
        </tr>
      }
    </tbody>
  </table>
}
  `,
})
export class StockIndexComponent {
  search = signal('');

  constructor(public state: AppStateService, public stock: StockService, private api: ApiService) {}

  index = computed<IndexRow[]>(() => {
    const rank: Record<string, number> = { holding: 1, tracking: 0 };
    const map: Record<string, IndexRow> = {};

    // Primary: tracked stocks
    this.state.tracked().forEach(t => {
      const name = this.stock.codeToName()[t.code] || t.code;
      map[t.code] = { code: t.code, name, bestStatus: t.status, refs: [] };
    });

    // Supplement with note entries (add refs, may override status if higher)
    this.state.notes().forEach(note =>
      note.rows.forEach(row =>
        row.entries.forEach(e => {
          if (!map[e.code]) {
            map[e.code] = { code: e.code, name: e.name, bestStatus: e.status, refs: [] };
          }
          map[e.code].refs.push({ noteId: note.id, noteTitle: note.title, category: row.category });
          if (rank[e.status] > rank[map[e.code].bestStatus]) map[e.code].bestStatus = e.status;
        }),
      ),
    );
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  });

  filtered = computed(() => {
    const q = this.search().trim();
    if (!q) return this.index();
    return this.index().filter(s =>
      s.code.includes(q) || s.name.includes(q) ||
      s.refs.some(r => r.noteTitle.includes(q) || r.category.includes(q)),
    );
  });

  statusClass(s: string) { return STATUS_CLASS[s]; }
  statusLabel(s: string) { return STATUS_LABELS[s]; }
  sigCount(code: string) { return (this.state.signals()[code] ?? []).filter(s => s.status === 'active').length; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }

  quickAddStock() { this.state.addingDirect.set(true); }

  goToNote(noteId: string) {
    this.state.activeNoteId.set(noteId);
    this.state.view.set('notes');
  }

  openStock(code: string) {
    this.state.editTarget.set({ kind: 'tracked', code });
  }
}
