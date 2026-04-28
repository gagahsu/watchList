import { Component, Input, signal, computed } from '@angular/core';
import { AppStateService } from '../../../../services/app-state.service';
import { ApiService } from '../../../../services/api.service';
import { Trade, Market } from '../../../../models/types';
import { calcFIFO, fmtMoney, uid } from '../../../../utils';

@Component({
  selector: 'app-trades-tab',
  template: `
@let code = entry().code;
@let market = state.tradeMarkets()[code] ?? 'tw';
@let trades = state.trades()[code] ?? [];
@let fifo = calcFIFO(trades, market);
@let curr = market === 'tw' ? 'NT$' : '$';

<div class="market-toggle">
  <button class="market-btn" [class.active]="market==='tw'" (click)="setMarket(code,'tw')">🇹🇼 台股</button>
  <button class="market-btn" [class.active]="market==='us'" (click)="setMarket(code,'us')">🇺🇸 美股</button>
</div>

@if (trades.length > 0) {
  <div class="trade-summary">
    <div class="trade-summary-card">
      <div class="tsc-label">持有股數 / 均攤成本</div>
      <div class="tsc-value">{{ fifo.holdingShares.toLocaleString() }} 股</div>
      <div class="tsc-sub">均攤 {{ curr }}{{ fmtAvg(fifo.avgCost, market) }}</div>
    </div>
    <div class="trade-summary-card" [class.pnl-pos]="fifo.realizedPnL>0" [class.pnl-neg]="fifo.realizedPnL<0">
      <div class="tsc-label">已實現損益</div>
      <div class="tsc-value" [class.pos]="fifo.realizedPnL>0" [class.neg]="fifo.realizedPnL<0">
        {{ fmtMoney(fifo.realizedPnL, market) }}
      </div>
      <div class="tsc-sub">{{ market==='tw' ? '含手續費與證交稅' : '含手續費' }}</div>
    </div>
  </div>

  <div class="trade-header-row">
    <span>日期</span><span>方向</span><span>股數</span>
    <span>成交價</span><span>手續費{{ market==='tw' ? ' / 稅' : '' }}</span><span>損益</span>
  </div>
  <div class="trade-list">
    @for (t of sorted(trades); track t.id) {
      @let r = resultFor(fifo, t.id);
      <div class="trade-item">
        <span class="trade-date">{{ t.date.slice(5) }}</span>
        <span class="trade-type trade-type-{{ t.type }}">{{ t.type==='buy' ? '買入' : '賣出' }}</span>
        <span class="trade-num">{{ t.shares.toLocaleString() }}</span>
        <span class="trade-num">{{ curr }}{{ fmtNum(t.price, market) }}</span>
        <span class="trade-num" style="font-size:11px">
          {{ t.fee ? curr + fmtNum(t.fee, market) : '—' }}
          @if (r?.tax) { <span style="color:var(--text-muted)"> / {{ r.tax.toLocaleString() }}</span> }
        </span>
        <span class="trade-pnl" [class.pos]="(r?.realized??0)>=0" [class.neg]="(r?.realized??1)<0">
          {{ r?.realized != null ? fmtMoney(r.realized, market) : '—' }}
        </span>
        <button class="trade-del-btn" (click)="deleteTrade(code, t.id)">✕</button>
      </div>
    }
  </div>
}

@if (showForm()) {
  <div class="trade-form">
    <div class="trade-form-row">
      <div class="trade-form-group" style="width:80px">
        <div class="trade-form-label">方向</div>
        <select class="trade-form-select" [value]="f.type" (change)="f.type=asStr($event)">
          <option value="buy">買入</option><option value="sell">賣出</option>
        </select>
      </div>
      <div class="trade-form-group" style="flex:1">
        <div class="trade-form-label">日期</div>
        <input type="date" class="trade-form-input" [value]="f.date" (input)="f.date=asStr($event)" />
      </div>
    </div>
    <div class="trade-form-row">
      <div class="trade-form-group" style="flex:1">
        <div class="trade-form-label">股數</div>
        <input class="trade-form-input" inputmode="decimal" [placeholder]="market==='tw'?'如：1000':'如：10'"
          [value]="f.shares" (input)="f.shares=asStr($event)" />
      </div>
      <div class="trade-form-group" style="flex:1">
        <div class="trade-form-label">成交價（{{ curr }}）</div>
        <input class="trade-form-input" inputmode="decimal" [placeholder]="market==='tw'?'如：500':'如：185.5'"
          [value]="f.price" (input)="f.price=asStr($event)" />
      </div>
      <div class="trade-form-group" style="flex:1">
        <div class="trade-form-label">手續費（{{ curr }}）</div>
        <input class="trade-form-input" inputmode="decimal" placeholder="如：71"
          [value]="f.fee" (input)="f.fee=asStr($event)" />
      </div>
    </div>
    @if (market==='tw' && f.type==='sell' && autoTax() > 0) {
      <div class="trade-tax-hint">📋 證交稅（自動）：NT${{ autoTax().toLocaleString() }}
        <span style="margin-left:8px;opacity:0.7">= {{ sellAmt().toLocaleString() }} × 0.3%</span>
      </div>
    }
    <div style="display:flex;gap:8px">
      <button class="sig-add-btn" (click)="addTrade(code)">新增交易</button>
      <button class="sig-action-btn" (click)="showForm.set(false)">取消</button>
    </div>
  </div>
} @else {
  <button class="sig-open-add" (click)="showForm.set(true)">＋ 新增交易記錄</button>
}

@if (trades.length === 0 && !showForm()) {
  <div class="sig-empty" style="padding-top:12px">尚無交易記錄<br>點擊上方新增第一筆</div>
}
  `,
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

  fmtAvg(n: number, market: string) {
    return market === 'us' ? n.toFixed(2) : Math.round(n).toLocaleString();
  }
  fmtNum(n: number, market: string) {
    return market === 'us' ? n.toFixed(2) : n.toLocaleString();
  }

  resultFor(fifo: ReturnType<typeof calcFIFO>, id: string) {
    return fifo.results.find(r => r.id === id);
  }

  get sellAmt() {
    return computed(() => (parseFloat(this.f.shares) || 0) * (parseFloat(this.f.price) || 0));
  }
  get autoTax() {
    return computed(() => {
      const code = this.entry().code;
      const market = this.state.tradeMarkets()[code] ?? 'tw';
      return market === 'tw' && this.f.type === 'sell' ? Math.floor(this.sellAmt() * 0.003) : 0;
    });
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
