import { Component, Input, signal } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { Trade, Market } from '../../../../models/types';
import { calcFIFO, fmtMoney, uid } from '../../../../utils';

@Component({
  selector: 'app-trades-tab',
  templateUrl: './trades-tab.component.html',
})
export class TradesTabComponent {
  @Input() entry!: () => { code: string };

  showForm = signal(false);
  f = { type: 'buy', date: new Date().toISOString().slice(0, 10), shares: '', price: '', fee: '' };

  fmtMoney = fmtMoney;
  calcFIFO = calcFIFO;

  constructor(public state: AppStateService, private api: ApiService) {}

  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  sorted(trades: Trade[]) { return [...trades].sort((a, b) => b.date.localeCompare(a.date)); }
  fmtAvg(n: number, mkt: string) { return mkt === 'us' ? n.toFixed(2) : Math.round(n).toLocaleString(); }
  fmtNum(n: number, mkt: string) { return mkt === 'us' ? n.toFixed(2) : n.toLocaleString(); }
  resultFor(fifo: ReturnType<typeof calcFIFO>, id: string) { return fifo.results.find(r => r.id === id) ?? null; }

  calcSellAmt() { return (parseFloat(this.f.shares) || 0) * (parseFloat(this.f.price) || 0); }
  calcTax() {
    const mkt = this.state.tradeMarkets()[this.entry().code] ?? 'tw';
    return mkt === 'tw' && this.f.type === 'sell' ? Math.floor(this.calcSellAmt() * 0.003) : 0;
  }
  taxHint() {
    const tax = this.calcTax().toLocaleString();
    const amt = this.calcSellAmt().toLocaleString();
    return `証交稅 (自動): NT$${tax}  =  ${amt} x 0.3%`;
  }

  async setMarket(code: string, market: Market) {
    await this.api.setMarket(code, market);
    this.state.setMarket(code, market);
  }

  async addTrade(code: string) {
    if (!this.f.shares || !this.f.price) return;
    const trade: Trade = {
      id: uid(), date: this.f.date, type: this.f.type as Trade['type'],
      shares: parseFloat(this.f.shares), price: parseFloat(this.f.price),
      fee: parseFloat(this.f.fee) || 0, sigRef: '',
    };
    await this.api.createTrade(code, trade);
    this.state.addTrade(code, trade);
    this.f.shares = ''; this.f.price = ''; this.f.fee = '';
    this.showForm.set(false);
  }

  async deleteTrade(code: string, id: string) {
    await this.api.deleteTrade(id);
    this.state.deleteTrade(code, id);
  }
}
