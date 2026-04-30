import { Component, Input, OnInit, signal } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { StockService } from '../../../../services/stock.service';
import { Trade, Market } from '../../../../models/types';
import { calcFIFO, fmtMoney, uid } from '../../../../utils';

@Component({
  selector: 'app-trades-tab',
  templateUrl: './trades-tab.component.html',
})
export class TradesTabComponent implements OnInit {
  @Input() entry!: () => { code: string };

  showForm   = signal(false);
  slVal      = signal('');
  tpVal      = signal('');
  f = { type: 'buy', date: new Date().toISOString().slice(0, 10), shares: '', price: '', fee: '', note: '' };

  fmtMoney = fmtMoney;
  calcFIFO = calcFIFO;

  constructor(public state: AppStateService, private api: ApiService, public stock: StockService) {}

  ngOnInit() { this.initSLTP(this.entry().code); }

  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  sorted(trades: Trade[]) { return [...trades].sort((a, b) => b.date.localeCompare(a.date)); }

  trackedForCode(code: string) { return this.state.tracked().find(t => t.code === code); }

  initSLTP(code: string) {
    const t = this.trackedForCode(code);
    this.slVal.set(t?.stopLoss ?? '');
    this.tpVal.set(t?.takeProfit ?? '');
  }

  async saveSLTP(code: string) {
    const updated = await this.api.patchTracked(code, {
      stopLoss: this.slVal().trim(), takeProfit: this.tpVal().trim(),
    });
    this.state.updateTracked(updated);
  }
  fmtAvg(n: number, mkt: string) { return mkt === 'us' ? n.toFixed(2) : n % 1 === 0 ? n.toLocaleString() : n.toFixed(2); }
  fmtNum(n: number, mkt: string) { return mkt === 'us' ? n.toFixed(2) : n.toLocaleString(); }
  resultFor(fifo: ReturnType<typeof calcFIFO>, id: string) { return fifo.results.find(r => r.id === id) ?? null; }

  unrealizedPnL(fifo: ReturnType<typeof calcFIFO>, code: string): number | null {
    const ci = this.stock.closeMap()[code];
    if (ci?.close == null || fifo.holdingShares === 0) return null;
    return (ci.close - fifo.avgCost) * fifo.holdingShares;
  }

  closeInfo(code: string) { return this.stock.closeMap()[code]; }

  perLotPnL(t: Trade, code: string): number | null {
    if (t.type !== 'buy') return null;
    const ci = this.stock.closeMap()[code];
    if (ci?.close == null) return null;
    const unitCost = (t.shares * t.price + (t.fee || 0)) / t.shares;
    return (ci.close - unitCost) * t.shares;
  }

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
      fee: parseFloat(this.f.fee) || 0, sigRef: '', note: this.f.note.trim(),
    };
    await this.api.createTrade(code, trade);
    this.state.addTrade(code, trade);
    this.f.shares = ''; this.f.price = ''; this.f.fee = ''; this.f.note = '';
    this.showForm.set(false);
  }

  async deleteTrade(code: string, id: string) {
    await this.api.deleteTrade(id);
    this.state.deleteTrade(code, id);
  }
}
