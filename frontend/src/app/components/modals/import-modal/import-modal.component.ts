import { Component, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { StockService } from '../../../services/stock.service';
import { parseCSV, uid } from '../../../utils';
import { Note, Row } from '../../../models/types';

@Component({
  selector: 'app-import-modal',
  template: `
<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
  <div class="modal-box" style="width:480px;max-height:90vh;overflow-y:auto">
    <div class="modal-title">📥 匯入 CSV 筆記</div>

    <div class="import-format-hint">
      支援格式：<code>產業別,公司名稱</code>，公司名稱請含代碼，如<br>
      <code>ASIC 設計服務,"世芯-KY(3661)"</code><br>
      同一產業多家公司可用頓號分隔：<code>"緯穎(6669)、廣達(2382)"</code>
    </div>

    @if (!rows()) {
      <div class="import-drop" [class.drag-over]="drag()"
        (dragover)="onDragOver($event)" (dragleave)="drag.set(false)"
        (drop)="onDrop($event)" (click)="fileInput.click()">
        <div class="import-drop-icon">📂</div>
        <div class="import-drop-text">
          <strong>點擊選擇</strong>或拖曳 CSV 檔案到此處<br>
          <span style="font-size:11px;opacity:0.7">支援 UTF-8 編碼</span>
        </div>
        <input #fileInput type="file" accept=".csv,text/csv" style="display:none"
          (change)="onFileChange($event)" />
      </div>
    }

    @if (error()) { <div class="import-error">{{ error() }}</div> }

    @if (rows()) {
      <div class="modal-field">
        <label class="modal-label">筆記名稱</label>
        <input class="import-note-name" placeholder="輸入筆記名稱…"
          [value]="title()" (input)="title.set(asStr($event))" />
      </div>
      <div class="import-preview">
        <div class="import-preview-title">
          預覽（{{ rows()!.length }} 個產業、{{ entryCount() }} 支股票）
        </div>
        <div class="import-preview-rows">
          @for (row of rows()!; track row.id) {
            <div class="import-preview-row">
              <div class="ipr-cat">{{ row.category }}</div>
              <div class="ipr-chips">
                @for (e of row.entries; track e.id) {
                  <span class="ipr-chip">{{ e.code ? e.name + '(' + e.code + ')' : e.name }}</span>
                }
              </div>
            </div>
          }
        </div>
      </div>
      <div style="margin-top:10px">
        <button style="font-size:12px;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px 0;font-family:inherit"
          (click)="rows.set(null); error.set('')">← 重新選擇檔案</button>
      </div>
    }

    <div class="modal-actions" style="margin-top:18px">
      <button class="btn-cancel" (click)="close()">取消</button>
      <button class="btn-primary" [style.opacity]="rows() ? 1 : 0.4"
        [style.pointer-events]="rows() ? 'auto' : 'none'"
        (click)="submit()">建立筆記</button>
    </div>
  </div>
</div>
  `,
})
export class ImportModalComponent {
  rows  = signal<Row[] | null>(null);
  title = signal('');
  error = signal('');
  drag  = signal(false);

  constructor(
    private state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  get entryCount() { return () => (this.rows() ?? []).reduce((s, r) => s + r.entries.length, 0); }
  asStr(e: Event) { return (e.target as HTMLInputElement).value; }

  onDragOver(e: DragEvent) { e.preventDefault(); this.drag.set(true); }

  onDrop(e: DragEvent) {
    e.preventDefault(); this.drag.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.processFile(file);
  }

  private processFile(file: File) {
    this.title.set(file.name.replace(/\.csv$/i, ''));
    const reader = new FileReader();
    reader.onload = ev => this.parseText((ev.target as FileReader).result as string);
    reader.readAsText(file, 'UTF-8');
  }

  private parseText(text: string) {
    this.error.set('');
    const db = this.stock.codeToName();
    const list = this.stock.list();
    const result = parseCSV(text, db, list);
    if (!result || result.length === 0) {
      this.error.set('無法解析 CSV，請確認格式（第一列為標題列：產業別,公司名稱）');
      this.rows.set(null);
    } else {
      this.rows.set(result as Row[]);
    }
  }

  async submit() {
    const rows = this.rows();
    if (!rows || rows.length === 0) return;
    const note: Note = { id: uid(), title: this.title() || '匯入筆記', createdAt: Date.now(), rows };
    await this.api.createNote(note);
    this.state.addNoteToFront(note);
    this.close();
  }

  private mdOnOverlay = false;
  trackMd(e: MouseEvent) { this.mdOnOverlay = e.target === e.currentTarget; }
  closeIfBg(e: MouseEvent) {
    if (this.mdOnOverlay && e.target === e.currentTarget) this.close();
    this.mdOnOverlay = false;
  }
  close() { this.state.importing.set(false); }
}
