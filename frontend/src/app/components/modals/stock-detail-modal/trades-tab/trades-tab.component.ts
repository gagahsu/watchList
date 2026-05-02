import { Component, Input, OnInit, signal } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { StockService } from '../../../../services/stock.service';
import { Trade, Market } from '../../../../models/types';
import { calcFIFO, fmtMoney, uid } from '../../../../utils';
import { pendingSettlements, settlementDate } from '../../../../utils';

@Component({
  selector: 'app-trades-tab',
  templateUrl: './trades-tab.component.html',
})
export class TradesTabComponent implements OnInit {
  @Input() entry!: () => { code: string };

  showForm        = signal(false);
  slVal           = signal('');
  tpVal           = signal('');
  slMode          = signal<'price'|'pct'>('price');
  slPct           = signal('');
  selectedBroker  = signal('');
  selectedAccount = signal('');
  f = { type: 'buy', date: new Date().toISOString().slice(0, 10), shares: '', price: '', fee: '', note: '' };

  fmtMoney = fmtMoney;
  calcFIFO = calcFIFO;

  constructor(public state: AppStateService, private api: ApiService, public stock: StockService) {}

  ngOnInit() { this.initSLTP(this.entry().code); }

  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  sorted(trades: Trade[]) { return [...trades].sort((a, b) => b.date.localeCompare(a.date)); }

  trackedForCode(code: string) { return this.state.tracked().find(t => t.code === code); }

  onBrokerChange(e: Event) {
    this.selectedBroker.set(this.asStr(e));
    this.recalcFee();
  }

  recalcFee() {
    const b = this.state.brokers().find(x => x.id === this.selectedBroker());
    if (!b || !this.f.shares || !this.f.price) return;
    const raw = parseFloat(this.f.shares) * parseFloat(this.f.price) * 0.001425 * b.discount;
    let fee = b.rounding === 'floor' ? Math.floor(raw) : b.rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
    fee = Math.max(fee, b.minFee);
    this.f.fee = String(fee);
  }

  initSLTP(code: string) {
    const t = this.trackedForCode(code);
    this.slVal.set(t?.stopLoss ?? '');
    this.tpVal.set(t?.takeProfit ?? '');
    this.slMode.set('price');
    this.slPct.set('');
  }

  calcSlPrice(avgCost: number): string {
    const pct = parseFloat(this.slPct());
    if (isNaN(pct) || pct <= 0 || avgCost <= 0) return '—';
    return (avgCost * (1 - pct / 100)).toFixed(2) + ' 元';
  }

  async saveSLTP(code: string) {
    let sl = this.slVal().trim();
    if (this.slMode() === 'pct') {
      const pct = parseFloat(this.slPct());
      const trades = this.state.trades()[code] ?? [];
      const mkt = this.state.tradeMarkets()[code] ?? 'tw';
      const fifo = calcFIFO(trades, mkt);
      sl = (!isNaN(pct) && fifo.avgCost > 0)
        ? (fifo.avgCost * (1 - pct / 100)).toFixed(2)
        : '';
    }
    const updated = await this.api.patchTracked(code, {
      stopLoss: sl, takeProfit: this.tpVal().trim(),
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

  calcBuyAmount() {
    if (this.f.type !== 'buy') return 0;
    return (parseFloat(this.f.shares) || 0) * (parseFloat(this.f.price) || 0) + (parseFloat(this.f.fee) || 0);
  }

  accountWarning(): string | null {
    const aid = this.selectedAccount();
    if (!aid || this.f.type !== 'buy') return null;
    const amount = this.calcBuyAmount();
    if (amount <= 0) return null;
    const account = this.state.accounts().find(a => a.id === aid);
    if (!account) return null;
    const sd = settlementDate(this.f.date);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (sd < today) return null; // already settled, no warning needed
    const pending = pendingSettlements(aid, this.state.trades());
    const available = account.balance - pending;
    if (available < amount) {
      const short = amount - available;
      return `帳戶餘額不足：需 NT$${Math.round(amount).toLocaleString()}，可用 NT$${Math.round(available).toLocaleString()}，缺 NT$${Math.round(short).toLocaleString()}（交割日 ${sd.toLocaleDateString('zh-TW')}）`;
    }
    return null;
  }

  async addTrade(code: string) {
    if (!this.f.shares || !this.f.price) return;
    const trade: Trade = {
      id: uid(), date: this.f.date, type: this.f.type as Trade['type'],
      shares: parseFloat(this.f.shares), price: parseFloat(this.f.price),
      fee: parseFloat(this.f.fee) || 0, sigRef: '', note: this.f.note.trim(),
      accountId: this.selectedAccount() || null,
    };
    await this.api.createTrade(code, trade);
    this.state.addTrade(code, trade);
    this.f.shares = ''; this.f.price = ''; this.f.fee = ''; this.f.note = '';
    this.showForm.set(false);
    await this.syncStatus(code);
  }

  async deleteTrade(code: string, id: string) {
    await this.api.deleteTrade(id);
    this.state.deleteTrade(code, id);
    await this.syncStatus(code);
  }

  private async syncStatus(code: string) {
    const tracked = this.trackedForCode(code);
    if (!tracked) return;
    const trades = this.state.trades()[code] ?? [];
    const mkt = this.state.tradeMarkets()[code] ?? 'tw';
    const fifo = calcFIFO(trades, mkt);
    const target = fifo.holdingShares > 0 ? 'holding' : 'tracking';
    if (tracked.status !== target) {
      const updated = await this.api.patchTracked(code, { status: target });
      this.state.updateTracked(updated);
    }
  }
}
