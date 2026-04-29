import { Component } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { fmtD, uid } from '../../utils';
import { Note } from '../../models/types';

@Component({
  selector: 'app-notes-list-view',
  template: `
<div class="notes-list-header">
  <button class="idx-add-btn" (click)="addNote()">＋ 新增筆記</button>
</div>

@if (state.notes().length === 0) {
  <div class="empty-state">
    <div class="empty-icon">📋</div>
    <div class="empty-title">還沒有筆記</div>
    <div class="empty-sub">點擊右上角新增你的第一篇研究筆記</div>
  </div>
} @else {
  <div class="notes-list-grid">
    @for (note of state.notes(); track note.id) {
      <div class="note-card" (click)="openNote(note.id)">
        <button class="note-card-del" (click)="deleteNote($event, note.id)" title="刪除">✕</button>
        <div class="note-card-icon">📋</div>
        <div class="note-card-title">{{ note.title || '未命名筆記' }}</div>
        @if (note.description) {
          <div class="note-card-desc">{{ plainText(note.description) }}</div>
        }
        <div class="note-card-meta">{{ fmtD(note.createdAt) }} · {{ note.rows.length }} 個產業</div>
      </div>
    }
  </div>
}
  `,
})
export class NotesListViewComponent {
  fmtD = fmtD;
  constructor(public state: AppStateService, private api: ApiService) {}

  openNote(id: string) {
    this.state.activeNoteId.set(id);
    this.state.view.set('notes');
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

  plainText(md: string) {
    return md.replace(/[#*_`~>\[\]]/g, '').replace(/\n+/g, ' ').trim();
  }
}
