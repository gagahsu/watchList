import { Component, OnInit, OnDestroy, computed, effect, signal, untracked } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { StockService } from '../../services/stock.service';
import { ApiService } from '../../services/api.service';
import { calcFIFO, fmtMoney } from '../../utils';

interface Holding {
  code: string;
  name: string;
  holdingShares: number;
  avgCost: number;
  currentPrice: number | null;
  unrealized: number | null;
  netUnrealized: number | null;
  sellCost: number | null;
  unrealizedPct: number | null;
  market: string;
  stopLoss: string;
  takeProfit: string;
  stopLossHit: boolean;
}

interface ClosedPosition {
  code: string;
  name: string;
  market: string;
  realizedPnL: number;
  tradeCount: number;
  firstDate: string;
  lastDate: string;
}

@Component({
  selector: 'app-portfolio-view',
  template: `
@let s = summary();

<!-- Summary cards -->
@if (tab() === 'holding') {
  <div class="trade-summary trade-summary-3" style="margin-bottom:16px">
    <div class="trade-summary-card">
      <div class="tsc-label">持倉成本</div>
      <div class="tsc-value" style="font-size:18px">
        {{ s.totalCost > 0 ? s.totalCost.toLocaleString() : '—' }}
      </div>
    </div>
    <div class="trade-summary-card">
      <div class="tsc-label">持倉市值</div>
      <div class="tsc-value" style="font-size:18px">
        {{ s.totalMV > 0 ? s.totalMV.toLocaleString() : '—' }}
      </div>
    </div>
    <div class="trade-summary-card" [class.pnl-pos]="s.totalPnL > 0" [class.pnl-neg]="s.totalPnL < 0">
      <div class="tsc-label">未實現損益（含出場費）</div>
      <div class="tsc-value" style="font-size:18px" [class.pos]="s.totalPnL > 0" [class.neg]="s.totalPnL < 0">
        {{ s.hasPnL ? fmtPnL(s.totalPnL) : '—' }}
      </div>
      @if (s.hasPnL && s.totalCost > 0) {
        <div class="tsc-sub" [class.pos]="s.totalPnL > 0" [class.neg]="s.totalPnL < 0">
          {{ s.totalPnL >= 0 ? '+' : '' }}{{ (s.totalPnL / s.totalCost * 100).toFixed(2) }}%
        </div>
      }
    </div>
  </div>
} @else {
  @let cs = closedSummary();
  <div class="trade-summary" style="margin-bottom:16px">
    <div class="trade-summary-card" [class.pnl-pos]="cs > 0" [class.pnl-neg]="cs < 0">
      <div class="tsc-label">累計實現損益（稅後，含手續費）</div>
      <div class="tsc-value" style="font-size:18px" [class.pos]="cs > 0" [class.neg]="cs < 0">
        {{ closedPositions().length > 0 ? fmtPnL(cs) : '—' }}
      </div>
      @if (closedPositions().length > 0) {
        <div class="tsc-sub">共 {{ closedPositions().length }} 支個股平倉</div>
      }
    </div>
  </div>
}

<!-- Tabs -->
<div class="note-tabs" style="margin-bottom:16px">
  <button class="note-tab" [class.active]="tab()==='holding'" (click)="switchTab('holding')">
    持倉中
    @if (holdings().length > 0) {
      <span class="badge">{{ holdings().length }}</span>
    }
  </button>
  <button class="note-tab" [class.active]="tab()==='closed'" (click)="switchTab('closed')">
    已平倉
    @if (closedPositions().length > 0) {
      <span class="badge badge-gray">{{ closedPositions().length }}</span>
    }
  </button>
</div>

<!-- 持倉中 -->
@if (tab() === 'holding') {
  @if (holdings().length === 0) {
    <div class="empty-state">
      <div class="empty-icon">💼</div>
      <div class="empty-title">尚無持倉紀錄</div>
      <div class="empty-sub">在個股詳情中新增交易記錄，<br>買進後即會顯示於此。</div>
    </div>
  } @else {
    <div class="table-scroll-wrap">
    <table class="supply-table portfolio-table">
      <thead>
        <tr>
          <th style="width:80px">代碼</th>
          <th>名稱</th>
          <th style="width:80px;text-align:right">持股</th>
          <th style="width:100px;text-align:right">均成本</th>
          <th style="width:100px;text-align:right">現價</th>
          <th style="width:130px;text-align:right">未實現損益</th>
          <th style="width:50px"></th>
        </tr>
      </thead>
      <tbody>
        @for (h of holdings(); track h.code) {
          <tr class="portfolio-row" [class.expanded]="expanded() === h.code"
            [class.sl-alert]="h.stopLossHit"
            (click)="toggleExpand(h.code)">
            <td>
              <span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--gold)">
                {{ h.code }}
              </span>
            </td>
            <td>
              <span style="font-weight:600">{{ h.name }}</span>
              @if (h.stopLoss || h.takeProfit) {
                <div style="font-size:11px;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">
                  @if (h.stopLoss) {
                    <span style="white-space:nowrap" [style.color]="h.stopLossHit ? 'var(--red)' : 'var(--text-muted)'">
                      {{ h.stopLossHit ? '⚠ ' : '' }}停損 {{ h.stopLoss }}
                    </span>
                  }
                  @if (h.takeProfit) {
                    <span style="white-space:nowrap;color:var(--text-muted)">停利 {{ h.takeProfit }}</span>
                  }
                </div>
              }
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              {{ h.holdingShares.toLocaleString() }}
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              {{ fmtPrice(h.avgCost, h.market) }}
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              {{ h.currentPrice != null ? fmtPrice(h.currentPrice, h.market) : '—' }}
            </td>
            <td style="text-align:right">
              @if (h.netUnrealized != null) {
                <div class="trade-pnl" [class.pos]="h.netUnrealized >= 0" [class.neg]="h.netUnrealized < 0"
                  [title]="'稅前: ' + fmtMoney(h.unrealized!, h.market) + '  預估出場費: -' + Math.round(h.sellCost!).toLocaleString()">
                  {{ fmtMoney(h.netUnrealized, h.market) }}
                </div>
                <div style="font-size:12px;margin-top:2px;color:var(--text-muted)">
                  出場費 −{{ Math.round(h.sellCost!).toLocaleString() }}
                </div>
              } @else {
                <span style="color:var(--border)">—</span>
              }
            </td>
            <td style="text-align:center">
              <span style="color:var(--text-muted);font-size:12px;transition:transform 0.2s"
                [style.transform]="expanded()===h.code ? 'rotate(90deg)' : 'none'">▶</span>
            </td>
          </tr>

          @if (expanded() === h.code) {
            <tr class="portfolio-detail-row">
              <td colspan="7" style="padding:0">
                <div class="portfolio-detail">
                  <div class="portfolio-detail-header">
                    <span style="font-size:13px;font-weight:700;color:var(--text-muted)">交易紀錄</span>
                    <button class="idx-add-btn" style="padding:5px 12px;font-size:13px"
                      (click)="openModal($event, h.code)">管理</button>
                  </div>
                  @let trades = sortedTrades(h.code);
                  @let fifo = calcFIFO(trades, h.market);
                  @if (trades.length === 0) {
                    <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:14px">尚無交易紀錄</div>
                  } @else {
                    <div class="trade-header-row" style="grid-template-columns:90px 52px 80px 90px 80px 1fr">
                      <span>日期</span><span>類型</span><span style="text-align:right">股數</span>
                      <span style="text-align:right">價格</span><span style="text-align:right">手續費</span>
                      <span style="text-align:right">實現損益</span>
                    </div>
                    @for (t of trades; track t.id) {
                      @let res = resultFor(fifo, t.id);
                      <div class="trade-item" style="grid-template-columns:90px 52px 80px 90px 80px 1fr">
                        <span class="trade-date">{{ t.date }}</span>
                        <span class="trade-type" [class.trade-type-buy]="t.type==='buy'" [class.trade-type-sell]="t.type==='sell'">
                          {{ t.type === 'buy' ? '買進' : '賣出' }}
                        </span>
                        <span class="trade-num" style="text-align:right">{{ t.shares.toLocaleString() }}</span>
                        <span class="trade-num" style="text-align:right">{{ fmtPrice(t.price, h.market) }}</span>
                        <span class="trade-num" style="text-align:right;color:var(--text-muted)">
                          {{ t.fee ? t.fee.toLocaleString() : '—' }}
                        </span>
                        <span class="trade-pnl" style="text-align:right"
                          [class.pos]="res && res.realized != null && res.realized >= 0"
                          [class.neg]="res && res.realized != null && res.realized < 0">
                          {{ res?.realized != null ? fmtMoney(res!.realized!, h.market) : '—' }}
                        </span>
                      </div>
                    }
                  }
                </div>
              </td>
            </tr>
          }
        }
      </tbody>
    </table>
    </div>
  }
}

<!-- 已平倉 -->
@if (tab() === 'closed') {
  @if (closedPositions().length === 0) {
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">尚無平倉紀錄</div>
      <div class="empty-sub">買賣股數相等後，個股會自動移至此處。</div>
    </div>
  } @else {
    <div class="table-scroll-wrap">
    <table class="supply-table closed-table">
      <thead>
        <tr>
          <th style="width:80px">代碼</th>
          <th>名稱</th>
          <th style="width:170px">持有期間</th>
          <th style="width:56px;text-align:center">筆數</th>
          <th style="width:130px;text-align:right">實現損益</th>
          <th style="width:50px"></th>
        </tr>
      </thead>
      <tbody>
        @for (h of closedPositions(); track h.code) {
          <tr class="portfolio-row" [class.expanded]="expanded() === h.code"
            (click)="toggleExpand(h.code)">
            <td>
              <span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--gold)">
                {{ h.code }}
              </span>
            </td>
            <td><span style="font-weight:600">{{ h.name }}</span></td>
            <td style="font-size:13px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
              {{ h.firstDate }}
              @if (h.firstDate !== h.lastDate) { <span> ~ {{ h.lastDate }}</span> }
            </td>
            <td style="text-align:center;font-size:13px;color:var(--text-muted)">{{ h.tradeCount }}</td>
            <td style="text-align:right">
              <span class="trade-pnl" [class.pos]="h.realizedPnL >= 0" [class.neg]="h.realizedPnL < 0">
                {{ fmtMoney(h.realizedPnL, h.market) }}
              </span>
            </td>
            <td style="text-align:center">
              <span style="color:var(--text-muted);font-size:12px;transition:transform 0.2s"
                [style.transform]="expanded()===h.code ? 'rotate(90deg)' : 'none'">▶</span>
            </td>
          </tr>

          @if (expanded() === h.code) {
            <tr class="portfolio-detail-row">
              <td colspan="6" style="padding:0">
                <div class="portfolio-detail">
                  <div class="portfolio-detail-header">
                    <span style="font-size:13px;font-weight:700;color:var(--text-muted)">交易紀錄</span>
                    <button class="idx-add-btn" style="padding:5px 12px;font-size:13px"
                      (click)="openModal($event, h.code)">管理</button>
                  </div>
                  @let trades = sortedTrades(h.code);
                  @let fifo = calcFIFO(trades, h.market);
                  <div class="trade-header-row" style="grid-template-columns:90px 52px 80px 90px 80px 1fr">
                    <span>日期</span><span>類型</span><span style="text-align:right">股數</span>
                    <span style="text-align:right">價格</span><span style="text-align:right">手續費</span>
                    <span style="text-align:right">實現損益</span>
                  </div>
                  @for (t of trades; track t.id) {
                    @let res = resultFor(fifo, t.id);
                    <div class="trade-item" style="grid-template-columns:90px 52px 80px 90px 80px 1fr">
                      <span class="trade-date">{{ t.date }}</span>
                      <span class="trade-type" [class.trade-type-buy]="t.type==='buy'" [class.trade-type-sell]="t.type==='sell'">
                        {{ t.type === 'buy' ? '買進' : '賣出' }}
                      </span>
                      <span class="trade-num" style="text-align:right">{{ t.shares.toLocaleString() }}</span>
                      <span class="trade-num" style="text-align:right">{{ fmtPrice(t.price, h.market) }}</span>
                      <span class="trade-num" style="text-align:right;color:var(--text-muted)">
                        {{ t.fee ? t.fee.toLocaleString() : '—' }}
                      </span>
                      <span class="trade-pnl" style="text-align:right"
                        [class.pos]="res && res.realized != null && res.realized >= 0"
                        [class.neg]="res && res.realized != null && res.realized < 0">
                        {{ res?.realized != null ? fmtMoney(res!.realized!, h.market) : '—' }}
                      </span>
                    </div>
                  }
                </div>
              </td>
            </tr>
          }
        }
      </tbody>
    </table>
    </div>
  }
}
  `,
})
export class PortfolioViewComponent implements OnInit, OnDestroy {
  expanded = signal<string | null>(null);
  tab      = signal<'holding' | 'closed'>('holding');
  livePrice = signal<Record<string, number | null>>({});
  fmtMoney = fmtMoney;
  calcFIFO = calcFIFO;
  Math = Math;

  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(public state: AppStateService, public stock: StockService, private api: ApiService) {
    effect(() => {
      this.state.portfolioRefreshTick();
      untracked(() => this.refreshQuotes());
    });
  }

  ngOnInit() {
    this.intervalId = setInterval(() => this.refreshQuotes(), 60_000);
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async refreshQuotes() {
    const items = this.holdings().map(h => ({ code: h.code, market: h.market }));
    if (!items.length) return;
    this.state.portfolioRefreshing.set(true);
    try {
      const data = await this.api.getQuotes(items);
      this.livePrice.set(data);
      this.state.portfolioLastUpdated.set(new Date());
    } catch { /* fall back to FinMind close price */ } finally {
      this.state.portfolioRefreshing.set(false);
    }
  }

  holdings = computed<Holding[]>(() => {
    const codes = new Set<string>([
      ...Object.keys(this.state.trades()),
      ...this.state.tracked().filter(t => t.status === 'holding').map(t => t.code),
    ]);

    const result: Holding[] = [];
    for (const code of codes) {
      const trades = this.state.trades()[code] ?? [];
      const market = this.state.tradeMarkets()[code] ?? 'tw';
      const fifo = calcFIFO(trades, market);
      if (fifo.holdingShares <= 0) continue;

      const name = this.stock.codeToName()[code] || code;
      const tracked = this.state.tracked().find(t => t.code === code);
      const stopLoss   = tracked?.stopLoss   ?? '';
      const takeProfit = tracked?.takeProfit ?? '';
      const ci = this.stock.closeMap()[code];
      const lp = this.livePrice();
      const currentPrice = lp[code] ?? ci?.close ?? null;
      const cost = fifo.avgCost * fifo.holdingShares;
      const unrealized = currentPrice != null ? (currentPrice - fifo.avgCost) * fifo.holdingShares : null;
      const unrealizedPct = unrealized != null && cost > 0 ? (unrealized / cost) * 100 : null;

      const taxRate = code.startsWith('00') ? 0.001 : 0.003;
      const feeRate = 0.001425 * this.state.feeDiscount();
      const sellCost = currentPrice != null ? currentPrice * fifo.holdingShares * (feeRate + taxRate) : null;
      const netUnrealized = unrealized != null && sellCost != null ? unrealized - sellCost : null;

      const slNum = parseFloat(stopLoss);
      const stopLossHit = !isNaN(slNum) && slNum > 0 && currentPrice !== null && currentPrice < slNum;
      result.push({ code, name, holdingShares: fifo.holdingShares, avgCost: fifo.avgCost, currentPrice, unrealized, netUnrealized, sellCost, unrealizedPct, market, stopLoss, takeProfit, stopLossHit });
    }

    return result.sort((a, b) => a.code.localeCompare(b.code));
  });

  closedPositions = computed<ClosedPosition[]>(() => {
    const result: ClosedPosition[] = [];
    for (const [code, trades] of Object.entries(this.state.trades())) {
      if (!trades.length) continue;
      const market = this.state.tradeMarkets()[code] ?? 'tw';
      const fifo = calcFIFO(trades, market);
      if (fifo.holdingShares > 0) continue;

      const name = this.stock.codeToName()[code] || code;
      const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
      result.push({
        code, name, market,
        realizedPnL: fifo.realizedPnL,
        tradeCount: trades.length,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date,
      });
    }
    return result.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  });

  summary = computed(() => {
    let totalCost = 0, totalMV = 0, totalPnL = 0, hasPnL = false;
    for (const h of this.holdings()) {
      totalCost += h.avgCost * h.holdingShares;
      if (h.currentPrice != null) {
        totalMV += h.currentPrice * h.holdingShares;
        totalPnL += h.netUnrealized ?? 0;
        hasPnL = true;
      }
    }
    return { totalCost, totalMV, totalPnL, hasPnL };
  });

  closedSummary = computed(() =>
    this.closedPositions().reduce((s, p) => s + p.realizedPnL, 0)
  );

  switchTab(t: 'holding' | 'closed') {
    this.tab.set(t);
    this.expanded.set(null);
  }

  toggleExpand(code: string) {
    this.expanded.update(c => c === code ? null : code);
  }

  openModal(e: Event, code: string) {
    e.stopPropagation();
    this.state.editTarget.set({ kind: 'tracked', code });
  }

  sortedTrades(code: string) {
    return [...(this.state.trades()[code] ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  }

  resultFor(fifo: ReturnType<typeof calcFIFO>, id: string) {
    return fifo.results.find(r => r.id === id) ?? null;
  }

  fmtPrice(n: number, market: string) {
    if (market === 'us') return n.toFixed(2);
    return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
  }

  fmtPnL(n: number) {
    const abs = Math.round(Math.abs(n)).toLocaleString();
    return (n >= 0 ? '+' : '-') + abs;
  }
}
