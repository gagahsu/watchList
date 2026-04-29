import { Component, signal, inject, computed } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { CompanyChipComponent } from './company-chip/company-chip.component';
import { STATUS_LABELS, uid } from '../../utils';
import { marked } from 'marked';

@Component({
  selector: 'app-notes-view',
  imports: [CompanyChipComponent],
  template: `
@if (!state.activeNote()) {
  <div class="empty-state">
    <div class="empty-icon">📊</div>
    <div class="empty-title">開始你的研究筆記</div>
    <div class="empty-sub">整理供應鏈、產業主題，<br>追蹤心儲的股票。</div>
    <button class="empty-btn" (click)="addNote()">＋ 新增筆記</button>
  </div>
} @else {
  <!-- Tabs -->
  <div class="note-tabs">
    <button class="note-tab" [class.active]="noteTab()==='desc'" (click)="noteTab.set('desc')">📝 描述</button>
    <button class="note-tab" [class.active]="noteTab()==='stocks'" (click)="noteTab.set('stocks')">
      🏢 相關個股
      @if (allEntries().length > 0) {
        <span class="badge badge-gray">{{ allEntries().length }}</span>
      }
    </button>
  </div>

  <!-- Tab: 描述 -->
  @if (noteTab() === 'desc') {
    @if (descEditing()) {
      <textarea class="note-description" rows="12"
        [value]="state.activeNote()!.description"
        placeholder="加入描述… (支援 Markdown 格式)"
        (input)="onDescriptionInput($event)"
        (blur)="descEditing.set(false)"></textarea>
    } @else {
      @if (state.activeNote()!.description) {
        <div class="note-description-preview" (click)="startEditDesc()" [innerHTML]="renderedDescription()"></div>
      } @else {
        <div class="note-description-empty" (click)="startEditDesc()">加入描述… (支援 Markdown 格式)</div>
      }
    }
  }

  <!-- Tab: 相關個股 -->
  @if (noteTab() === 'stocks') {
    <div class="legend">
      @for (s of statuses; track s) {
        <div class="legend-item">
          <div class="legend-dot" [style.background]="dotColor(s)"></div>
          <span>{{ label(s) }}</span>
        </div>
      }
      <span class="legend-hint">點擊標籤可循環切換狀態</span>
    </div>

    @if (state.activeNote()!.rows.length > 0) {
      <table class="supply-table">
        <thead><tr><th>產業別／類別</th><th>公司名稱</th><th></th></tr></thead>
        <tbody>
          @for (row of state.activeNote()!.rows; track row.id) {
            <tr>
              <td class="td-category">
                <input class="category-input" [value]="row.category"
                  (input)="onCategoryInput(row.id, $event)" />
              </td>
              <td class="td-companies">
                <div class="companies-wrap">
                  @for (entry of row.entries; track entry.id) {
                    <app-company-chip [entry]="entry"
                      (cycled)="cycleEntry(row.id, entry.id, $event)"
                      (deleted)="deleteEntry(row.id, entry.id)"
                      (edit)="state.editTarget.set({kind:'entry', rowId: row.id, entry})" />
                  }
                  <button class="add-company-btn" (click)="state.addToRowId.set(row.id)">＋ 新增</button>
                </div>
              </td>
              <td class="td-actions">
                <button class="row-del-btn" (click)="deleteRow(row.id)" title="刪除此列">✕</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <div style="text-align:center;padding:48px 24px;background:white;border-radius:12px;border:1.5px dashed var(--border);color:var(--text-muted);font-size:15px;line-height:1.7">
        <div style="font-size:28px;margin-bottom:12px;opacity:0.5">＋</div>
        點擊下方「新增產業別」開始整理
      </div>
    }

    <button class="add-row-btn" (click)="addRow()">＋ 新增產業別</button>
  }
}
  `,
})
export class NotesViewComponent {
  statuses = ['holding', 'tracking', 'watching'];
  private catTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private descTimer: ReturnType<typeof setTimeout> | null = null;
  descEditing = signal(false);
  noteTab = signal<'desc' | 'stocks'>('desc');
  private sanitizer = inject(DomSanitizer);

  constructor(public state: AppStateService, private api: ApiService) {}

  allEntries = computed(() => {
    const note = this.state.activeNote();
    if (!note) return [];
    return note.rows.flatMap(row => row.entries.map(e => ({ entry: e, rowId: row.id })));
  });

  renderedDescription(): SafeHtml {
    const desc = this.state.activeNote()?.description ?? '';
    const html = marked.parse(desc, { breaks: true }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  startEditDesc() {
    this.descEditing.set(true);
    setTimeout(() => (document.querySelector('.note-description') as HTMLTextAreaElement)?.focus(), 0);
  }

  label(s: string) { return STATUS_LABELS[s]; }
  dotColor(s: string) {
    return s === 'holding' ? 'var(--holding)' : s === 'tracking' ? 'var(--tracking)' : 'var(--watching)';
  }

  async addNote() {
    const note = { id: uid(), title: '新筆記', description: '', createdAt: Date.now(), rows: [] };
    await this.api.createNote(note);
    this.state.addNote(note as any);
  }

  async addRow() {
    const noteId = this.state.activeNoteId()!;
    const row = { id: uid(), category: '新產業別', entries: [] };
    await this.api.createRow(noteId, row);
    this.state.addRow(noteId, row as any);
  }

  async deleteRow(rowId: string) {
    const noteId = this.state.activeNoteId()!;
    await this.api.deleteRow(rowId);
    this.state.removeRow(noteId, rowId);
  }

  onDescriptionInput(e: Event) {
    const description = (e.target as HTMLTextAreaElement).value;
    const noteId = this.state.activeNoteId()!;
    this.state.updateNoteDescription(noteId, description);
    if (this.descTimer) clearTimeout(this.descTimer);
    this.descTimer = setTimeout(() => this.api.patchNote(noteId, { description }), 500);
  }

  onCategoryInput(rowId: string, e: Event) {
    const category = (e.target as HTMLInputElement).value;
    const noteId = this.state.activeNoteId()!;
    this.state.updateCategory(noteId, rowId, category);
    clearTimeout(this.catTimers[rowId]);
    this.catTimers[rowId] = setTimeout(() => this.api.patchRow(rowId, { category }), 300);
  }

  async cycleEntry(rowId: string, entryId: string, status: string) {
    const noteId = this.state.activeNoteId()!;
    await this.api.patchEntry(entryId, { status: status as any });
    this.state.cycleEntry(noteId, rowId, entryId, status as any);
  }

  async deleteEntry(rowId: string, entryId: string) {
    const noteId = this.state.activeNoteId()!;
    await this.api.deleteEntry(entryId);
    this.state.removeEntry(noteId, rowId, entryId);
  }
}
