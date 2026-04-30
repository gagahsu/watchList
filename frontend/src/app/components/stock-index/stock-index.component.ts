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

<!-- 篩選列 -->
<div class="index-filter-bar">
  <div style="display:flex;gap:4px;align-items:center">
    <span style="font-size:12px;color:var(--text-muted);margin-right:2px">狀態</span>
    @for (f of statusFilters; track f.v) {
      <button class="sov-filter-btn" [class.active]="filterStatus()===f.v"
        (click)="filterStatus.set(f.v)">{{ f.l }}</button>
    }
  </div>
  @if (noteOptions().length > 0) {
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-size:12px;color:var(--text-muted);margin-right:2px">筆記</span>
      <select class="note-filter-select" [value]="filterNote()" (change)="filterNote.set(asStr($event))">
        <option value="">全部</option>
        @for (n of noteOptions(); track n.id) {
          <option [value]="n.id">{{ n.title }}</option>
        }
      </select>
    </div>
  }
  <button class="sov-filter-btn" [class.active]="filterSignal()"
    (click)="filterSignal.update(v => !v)">有效訊號</button>
  <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">
    {{ filtered().length }} 支
  </span>
</div>

@if (index().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">🔍</div>
    <div class="empty-title">尚無個股資料</div>
    <div class="empty-sub">直接新增個股開始追蹤，<br>或在筆記中整理供應鏈主題。</div>
    <button class="empty-btn" (click)="quickAddStock()">＋ 新增個股</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">跨 {{ state.notes().length }} 份筆記 · 點擊列開啟個股詳情</span>
    <button class="idx-add-btn" (click)="quickAddStock()">＋ 新增個股</button>
  </div>
  <table class="index-table">
    <thead><tr>
      <th class="sortable" style="width:80px" (click)="setSort('code')">
        代碼 <span class="sort-ind">{{ sortInd('code') }}</span>
      </th>
      <th class="sortable" style="width:120px" (click)="setSort('name')">
        名稱 <span class="sort-ind">{{ sortInd('name') }}</span>
      </th>
      <th style="width:110px">產業別</th>
      <th class="sortable" style="width:80px" (click)="setSort('status')">
        狀態 <span class="sort-ind">{{ sortInd('status') }}</span>
      </th>
      <th class="sortable" style="width:90px;text-align:right" (click)="setSort('price')">
        收盤價 <span class="sort-ind">{{ sortInd('price') }}</span>
      </th>
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
              @for (ref of uniqueRefs(row.refs); track ref.noteId) {
                <span class="idx-ref-tag" (click)="goToNote(ref.noteId)" [title]="'前往：' + ref.noteTitle">
                  {{ ref.noteTitle }}
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
  search       = signal('');
  filterStatus = signal<'all'|'tracking'|'holding'>('all');
  filterSignal = signal(false);
  filterNote   = signal('');
  sortCol      = signal<'code'|'name'|'status'|'price'>('code');
  sortDir      = signal<'asc'|'desc'>('asc');

  noteOptions = computed(() =>
    this.state.notes().map(n => ({ id: n.id, title: n.title }))
  );

  statusFilters: { v: 'all'|'tracking'|'holding'; l: string }[] = [
    { v: 'all',      l: '全部' },
    { v: 'tracking', l: '追蹤中' },
    { v: 'holding',  l: '已持有' },
  ];

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
    const q    = this.search().trim();
    const fSt  = this.filterStatus();
    const fSig = this.filterSignal();
    const col  = this.sortCol();
    const dir  = this.sortDir();
    const statusRank: Record<string, number> = { holding: 1, tracking: 0 };

    const fNote = this.filterNote();

    let list = this.index().filter(s => {
      if (fSt !== 'all' && s.bestStatus !== fSt) return false;
      if (fSig && this.sigCount(s.code) === 0) return false;
      if (fNote && !s.refs.some(r => r.noteId === fNote)) return false;
      if (q && !s.code.includes(q) && !s.name.includes(q) &&
          !s.refs.some(r => r.noteTitle.includes(q) || r.category.includes(q))) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      let v = 0;
      if (col === 'code')   v = a.code.localeCompare(b.code);
      if (col === 'name')   v = a.name.localeCompare(b.name);
      if (col === 'status') v = (statusRank[b.bestStatus] ?? 0) - (statusRank[a.bestStatus] ?? 0);
      if (col === 'price') {
        const pa = this.stock.closeMap()[a.code]?.close ?? -Infinity;
        const pb = this.stock.closeMap()[b.code]?.close ?? -Infinity;
        v = pa - pb;
      }
      return dir === 'asc' ? v : -v;
    });

    return list;
  });

  setSort(col: 'code'|'name'|'status'|'price') {
    if (this.sortCol() === col) this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    else { this.sortCol.set(col); this.sortDir.set('asc'); }
  }

  sortInd(col: string) {
    if (this.sortCol() !== col) return '';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }

  statusClass(s: string) { return STATUS_CLASS[s]; }
  statusLabel(s: string) { return STATUS_LABELS[s]; }
  sigCount(code: string) { return (this.state.signals()[code] ?? []).filter(s => s.status === 'active').length; }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }

  uniqueRefs(refs: { noteId: string; noteTitle: string; category: string }[]) {
    const seen = new Set<string>();
    return refs.filter(r => seen.has(r.noteId) ? false : (seen.add(r.noteId), true));
  }

  quickAddStock() { this.state.addingDirect.set(true); }

  goToNote(noteId: string) {
    this.state.activeNoteId.set(noteId);
    this.state.view.set('notes');
  }

  openStock(code: string) {
    this.state.editTarget.set({ kind: 'tracked', code });
  }
}
