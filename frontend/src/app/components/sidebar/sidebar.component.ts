import { Component, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { fmtD, uid } from '../../utils';
import { Note } from '../../models/types';

@Component({
  selector: 'app-sidebar',
  template: `
<div id="sidebar" [class.open]="state.sidebarOpen()">
  <div class="sidebar-header">
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">📋</div>
      <div>
        <div>WatchList</div>
        <div class="sidebar-brand-sub">投資研究筆記</div>
      </div>
    </div>
  </div>

  <div class="sidebar-notes">
    @for (note of state.notes(); track note.id) {
      <div class="note-item" [class.active]="state.activeNoteId()===note.id"
        (click)="selectNote(note.id)">
        <div class="note-item-body">
          <div class="note-item-title">{{ note.title || '未命名筆記' }}</div>
          @if (note.description) {
            <div class="note-item-desc">{{ note.description }}</div>
          }
          <div class="note-item-date">{{ fmtD(note.createdAt) }} · {{ note.rows.length }} 個產業</div>
        </div>
        <button class="note-item-del" (click)="deleteNote($event, note.id)" title="刪除">✕</button>
      </div>
    }
    @if (state.notes().length === 0) {
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.6">
        尚無筆記<br>點擊下方新增
      </div>
    }
  </div>

  <div class="sidebar-footer">
    <button class="sidebar-add sidebar-add-primary" (click)="quickAddStock()">＋ 快速新增個股</button>
    <button class="sidebar-add" (click)="addNote()">＋ 新增筆記</button>
    <button class="sidebar-add" style="border-style:solid;opacity:0.8" (click)="state.importing.set(true)">
      📥 匯入 CSV
    </button>
    <button class="sidebar-add" style="border-style:solid;opacity:0.8"
      [disabled]="state.syncing()" (click)="syncStocks(false)">
      {{ state.syncing() ? '⏳ 同步中…' : '🔄 同步股票資料' }}
    </button>
    @if (allUpToDate() && !state.syncing()) {
      <button class="sidebar-add" style="border-style:solid;font-size:11px;opacity:0.65;padding:7px"
        [disabled]="state.syncing()" (click)="syncStocks(true)">
        ↺ 強制重新更新
      </button>
    }
    @if (state.syncMsg()) {
      <div class="sync-msg" style="white-space:pre-line">{{ state.syncMsg() }}</div>
    }
  </div>
</div>
  `,
})
export class SidebarComponent {
  fmtD = fmtD;
  allUpToDate = signal(false);

  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  selectNote(id: string) {
    this.state.activeNoteId.set(id);
    this.state.view.set('notes');
    this.state.sidebarOpen.set(false);
  }

  quickAddStock() {
    this.state.sidebarOpen.set(false);
    this.state.addingDirect.set(true);
  }

  async addNote() {
    const note: Note = { id: uid(), title: '新筆記', description: '', createdAt: Date.now(), rows: [] };
    await this.api.createNote(note);
    this.state.addNote(note);
  }

  async deleteNote(e: Event, id: string) {
    e.stopPropagation();
    await this.api.deleteNote(id);
    this.state.removeNote(id);
  }

  async syncStocks(force = false) {
    this.state.syncing.set(true);
    this.state.syncMsg.set('');
    this.allUpToDate.set(false);
    try {
      const res = await this.api.syncStocks(force) as any;
      const stocks = await this.api.getStocks();
      this.stock.apply(stocks);
      let msg = res.message ?? '同步完成';
      if ((res.prices_synced ?? 0) === 0 && !res.all_up_to_date && res.log?.length) {
        msg += '\n' + (res.log as string[]).join('\n');
      }
      this.state.syncMsg.set(msg);
      this.allUpToDate.set(res.all_up_to_date ?? false);
    } catch (e: any) {
      this.state.syncMsg.set('同步失敗：' + (e.message ?? ''));
    } finally {
      this.state.syncing.set(false);
      setTimeout(() => { this.state.syncMsg.set(''); this.allUpToDate.set(false); }, 30000);
    }
  }
}
