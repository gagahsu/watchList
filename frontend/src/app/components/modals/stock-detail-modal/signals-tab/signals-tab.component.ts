import { Component, Input, signal } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { Signal } from '../../../../models/types';
import { uid } from '../../../../utils';
import { SignalItemComponent } from './signal-item.component';

@Component({
  selector: 'app-signals-tab',
  templateUrl: './signals-tab.component.html',
  imports: [SignalItemComponent],
})
export class SignalsTabComponent {
  @Input() entry!: () => { code: string };

  showForm  = signal(false);
  addingSrc = signal(false);
  newSrc    = signal('');

  form = { direction: 'enter', source: '', price: '', condition: '' };

  constructor(public state: AppStateService, private api: ApiService) {
    this.form.source = state.sources()[0] ?? '';
  }

  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }

  onSourceChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (v === '__new__') { this.addingSrc.set(true); }
    else { this.form.source = v; }
  }

  async confirmSrc() {
    const name = this.newSrc().trim();
    if (!name) return;
    await this.api.addSource(name);
    this.state.addSource(name);
    this.form.source = name;
    this.newSrc.set('');
    this.addingSrc.set(false);
  }

  async addSignal(code: string) {
    if (!this.form.condition.trim()) return;
    const sig: Signal = {
      id: uid(), date: Date.now(),
      direction: this.form.direction as Signal['direction'],
      source: this.form.source || '未知來源',
      condition: this.form.condition.trim(),
      price: this.form.price.trim(),
      status: 'active', invalidReason: '',
    };
    await this.api.createSignal(code, sig);
    this.state.addSignal(code, sig);
    this.form.condition = ''; this.form.price = '';
    this.showForm.set(false);
  }

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
