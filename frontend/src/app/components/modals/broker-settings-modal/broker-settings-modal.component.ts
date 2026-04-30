import { Component, signal } from '@angular/core';
import { AppStateService } from '../../../services/app-state.service';
import { ApiService } from '../../../services/api.service';
import { Broker } from '../../../models/types';
import { uid } from '../../../utils';

const ROUNDINGS = [
  { v: 'floor', l: '無條件捨去' },
  { v: 'round', l: '四捨五入' },
  { v: 'ceil',  l: '無條件進位' },
];

@Component({
  selector: 'app-broker-settings-modal',
  template: `
<div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeIfBg($event)">
  <div class="modal-box" style="max-width:520px;width:92vw">
    <div class="modal-title">券商管理</div>

    @if (state.brokers().length === 0 && !showForm()) {
      <div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:14px">
        尚無券商，點下方新增
      </div>
    }

    @for (b of state.brokers(); track b.id) {
      @if (editId() === b.id) {
        <div class="broker-form">
          <div class="broker-form-row">
            <div class="broker-form-group" style="flex:2">
              <div class="modal-label">名稱</div>
              <input class="modal-input" [value]="editF.name" (input)="editF.name=asStr($event)" />
            </div>
            <div class="broker-form-group" style="flex:1">
              <div class="modal-label">折扣</div>
              <div style="display:flex;align-items:center;gap:4px">
                <input class="modal-input" type="number" min="1" max="10" step="0.1" style="width:90px"
                  [value]="disp(editF.discount)" (input)="editF.discount=toDiscount($event)" />
                <span style="font-size:13px;color:var(--text-muted)">折</span>
              </div>
            </div>
          </div>
          <div class="broker-form-row">
            <div class="broker-form-group" style="flex:1">
              <div class="modal-label">最低手續費（元）</div>
              <input class="modal-input" type="number" min="0"
                [value]="editF.minFee" (input)="editF.minFee=toInt($event)" />
            </div>
            <div class="broker-form-group" style="flex:1">
              <div class="modal-label">進位方式</div>
              <select class="sig-form-select" style="width:100%" (change)="editF.rounding=asStr($event)">
                @for (r of roundings; track r.v) {
                  <option [value]="r.v" [selected]="editF.rounding===r.v">{{ r.l }}</option>
                }
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-primary" style="flex:1" (click)="saveEdit(b.id)">儲存</button>
            <button class="btn-cancel" (click)="editId.set(null)">取消</button>
          </div>
        </div>
      } @else {
        <div class="broker-row">
          <div class="broker-row-name">{{ b.name }}</div>
          <div class="broker-row-meta">
            <span>{{ disp(b.discount) }} 折</span>
            <span>最低 {{ b.minFee }} 元</span>
            <span>{{ roundingLabel(b.rounding) }}</span>
          </div>
          <div class="broker-row-actions">
            <button class="sig-action-btn" (click)="startEdit(b)">編輯</button>
            <button class="sig-action-btn danger" (click)="deleteBroker(b.id)">刪除</button>
          </div>
        </div>
      }
    }

    @if (showForm()) {
      <div class="broker-form" style="margin-top:12px">
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:2">
            <div class="modal-label">名稱</div>
            <input class="modal-input" placeholder="如：富果、永豐" [value]="newF.name"
              (input)="newF.name=asStr($event)" autofocus />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">折扣</div>
            <div style="display:flex;align-items:center;gap:4px">
              <input class="modal-input" type="number" min="1" max="10" step="0.1" style="width:90px"
                [value]="disp(newF.discount)" (input)="newF.discount=toDiscount($event)" />
              <span style="font-size:13px;color:var(--text-muted)">折</span>
            </div>
          </div>
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">最低手續費（元）</div>
            <input class="modal-input" type="number" min="0" placeholder="20"
              [value]="newF.minFee" (input)="newF.minFee=toInt($event)" />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">進位方式</div>
            <select class="sig-form-select" style="width:100%" (change)="newF.rounding=asStr($event)">
              @for (r of roundings; track r.v) {
                <option [value]="r.v" [selected]="newF.rounding===r.v">{{ r.l }}</option>
              }
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-primary" style="flex:1" (click)="saveNew()">新增</button>
          <button class="btn-cancel" (click)="showForm.set(false)">取消</button>
        </div>
      </div>
    } @else {
      <button class="sig-open-add" style="margin-top:12px" (click)="startNew()">＋ 新增券商</button>
    }

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-primary" (click)="close()">完成</button>
    </div>
  </div>
</div>
  `,
})
export class BrokerSettingsModalComponent {
  showForm = signal(false);
  editId   = signal<string | null>(null);
  roundings = ROUNDINGS;
  newF  = this.blank();
  editF = this.blank();

  constructor(public state: AppStateService, private api: ApiService) {}

  blank() { return { name: '', discount: 0.6, minFee: 20, rounding: 'floor' }; }
  disp(d: number) { return +(d * 10).toFixed(1); }
  toDiscount(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    return isNaN(v) ? 0.6 : Math.min(10, Math.max(1, v)) / 10;
  }
  toInt(e: Event) { return parseInt((e.target as HTMLInputElement).value) || 0; }
  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  roundingLabel(r: string) { return ROUNDINGS.find(x => x.v === r)?.l ?? r; }

  startNew() { this.newF = this.blank(); this.showForm.set(true); this.editId.set(null); }

  async saveNew() {
    if (!this.newF.name.trim()) return;
    const b: Broker = { id: uid(), name: this.newF.name.trim(),
      discount: this.newF.discount, minFee: this.newF.minFee,
      rounding: this.newF.rounding as Broker['rounding'] };
    const saved = await this.api.createBroker(b);
    this.state.brokers.update(bs => [...bs, saved]);
    this.showForm.set(false);
  }

  startEdit(b: Broker) {
    this.editF = { name: b.name, discount: b.discount, minFee: b.minFee, rounding: b.rounding };
    this.editId.set(b.id);
    this.showForm.set(false);
  }

  async saveEdit(id: string) {
    const b: Broker = { id, name: this.editF.name.trim(),
      discount: this.editF.discount, minFee: this.editF.minFee,
      rounding: this.editF.rounding as Broker['rounding'] };
    const saved = await this.api.updateBroker(id, b);
    this.state.brokers.update(bs => bs.map(x => x.id === id ? saved : x));
    this.editId.set(null);
  }

  async deleteBroker(id: string) {
    await this.api.deleteBroker(id);
    this.state.brokers.update(bs => bs.filter(b => b.id !== id));
  }

  close() { this.state.brokersOpen.set(false); }
  private mdOnOverlay = false;
  trackMd(e: MouseEvent) { this.mdOnOverlay = e.target === e.currentTarget; }
  closeIfBg(e: MouseEvent) {
    if (this.mdOnOverlay && e.target === e.currentTarget) this.close();
    this.mdOnOverlay = false;
  }
}
