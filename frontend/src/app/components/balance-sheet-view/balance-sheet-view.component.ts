import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { ASSET_CLASSES, calcFIFO, detectAssetClass } from '../../utils';
import { PieChartComponent, PieSlice } from '../pie-chart/pie-chart.component';

type NwRange = '1w' | '1m' | '3m' | 'ytd' | '1y' | 'all';

const CHART_W = 560;
const CHART_H = 180;
const PAD = { l: 64, r: 16, t: 18, b: 32 };
const IW = CHART_W - PAD.l - PAD.r;
const IH = CHART_H - PAD.t - PAD.b;

function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(Math.round(n));
}

@Component({
  selector: 'app-balance-sheet-view',
  imports: [PieChartComponent],
  template: `
@let totalAssets = assetTotal();
@let totalLiab   = liabilityTotal();
@let netWorth    = totalAssets - totalLiab;

<!-- ── Summary ─────────────────────────────────────── -->
<div class="bs-summary">
  <div class="bs-summary-card">
    <div class="bs-label">總資產</div>
    <div class="bs-value">{{ fmtNT(totalAssets) }}</div>
  </div>
  <div class="bs-summary-card bs-liab-card">
    <div class="bs-label">總負債</div>
    <div class="bs-value text-danger">{{ fmtNT(totalLiab) }}</div>
  </div>
  <div class="bs-summary-card" [class.pnl-pos]="netWorth >= 0" [class.pnl-neg]="netWorth < 0">
    <div class="bs-label">淨資產</div>
    <div class="bs-value" [class.pos]="netWorth >= 0" [class.neg]="netWorth < 0">
      {{ fmtNT(netWorth) }}
    </div>
  </div>
</div>

<!-- ── Assets + Liabilities (same row) ─────────────── -->
<div class="bs-two-col">
  <!-- Assets column -->
  <div class="bs-col">
    <div class="bs-col-label">資產</div>
    <div class="bs-inner-grid">
      <div class="bs-card">
        <div class="bs-card-icon">💰</div>
        <div class="bs-card-name">現金帳戶</div>
        <div class="bs-card-amount">{{ fmtNT(cashTotal()) }}</div>
        <div class="bs-card-sub">{{ state.accounts().length }} 個帳戶</div>
        <button class="bs-card-btn" (click)="goAccounts()">管理 →</button>
      </div>
      <div class="bs-card">
        <div class="bs-card-icon">📈</div>
        <div class="bs-card-name">持股市值</div>
        <div class="bs-card-amount">{{ fmtNT(stockTotal()) }}</div>
        <div class="bs-card-sub">{{ holdingRows().length }} 支股票・以收盤價計</div>
        @if (holdingRows().some(h => h.mv === null)) {
          <div class="bs-card-warn">部分市價未知</div>
        }
      </div>
      @if (state.funds().length > 0) {
        <div class="bs-card">
          <div class="bs-card-icon">🏦</div>
          <div class="bs-card-name">基金市值</div>
          <div class="bs-card-amount">{{ fmtNT(fundTotal()) }}</div>
          <div class="bs-card-sub">{{ state.funds().length }} 筆基金</div>
          <button class="bs-card-btn" (click)="goFunds()">管理 →</button>
        </div>
      }
    </div>
  </div>

  <div class="bs-col-sep"></div>

  <!-- Liabilities column -->
  <div class="bs-col">
    <div class="bs-col-label">負債</div>
    @if (state.liabilities().length === 0) {
      <div class="bs-empty" style="padding:12px 0">尚無負債記錄</div>
    } @else {
      <div class="bs-inner-grid">
        @for (grp of liabilityGroups(); track grp.type) {
          <div class="bs-card bs-card-liab" [class.bs-card-alert]="grp.hasAlert">
            <div class="bs-card-icon">{{ typeIcon(grp.type) }}</div>
            <div class="bs-card-name">
              {{ grp.type }}
              @if (grp.hasAlert) { <span class="bs-alert-dot">🔔</span> }
            </div>
            <div class="bs-card-amount text-danger">{{ fmtNT(grp.total) }}</div>
            <div class="bs-card-sub">{{ grp.count }} 筆</div>
          </div>
        }
      </div>
    }
  </div>
</div>

<!-- ── Asset Allocation ─────────────────────────────── -->
@if (totalAssets > 0) {
  <div class="bs-group-title" style="margin-top:28px">資產配置</div>
  <div class="bs-chart-hint">依資產類別彙總，佔總資產比例。個股分類可於下方調整。</div>
  <div class="bs-alloc-wrap">
    <app-pie-chart [slices]="allocationSlices()"
      centerTitle="總資產" [centerValue]="fmtNT(totalAssets)" />
  </div>

  @if (classedHoldings().length > 0) {
    <details class="bs-alloc-details">
      <summary>個股分類明細（{{ classedHoldings().length }} 檔）</summary>
      <table class="bs-snap-table" style="margin-top:8px">
        <thead><tr>
          <th>代碼</th><th>名稱</th>
          <th style="text-align:right">市值（NTD）</th>
          <th style="text-align:right">佔總資產</th>
          <th>分類</th>
        </tr></thead>
        <tbody>
          @for (h of classedHoldings(); track h.code) {
            <tr>
              <td style="color:var(--gold);font-weight:600">{{ h.code }}</td>
              <td>{{ h.name }}</td>
              <td style="text-align:right">{{ h.mv != null ? fmtNT(h.mv) : '—' }}</td>
              <td style="text-align:right">{{ h.mv != null && totalAssets > 0 ? (h.mv / totalAssets * 100).toFixed(1) + '%' : '—' }}</td>
              <td>
                <select class="bs-alloc-select" (change)="onClassChange(h.code, $event)">
                  @for (c of assetClassOptions; track c) {
                    <option [value]="c" [selected]="c === h.assetClass">{{ c }}</option>
                  }
                </select>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  }
}

<!-- ── Net Worth History Chart ──────────────────────── -->
<div class="bs-nw-head">
  <div>
    <div class="bs-group-title" style="margin-bottom:2px">資產負債歷史</div>
    <div class="bs-chart-hint" style="margin-bottom:0">每日 23:58 自動擷取快照</div>
  </div>
  @if (state.netWorthSnapshots().length >= 2) {
    <div class="bs-range-group">
      @for (r of nwRanges; track r.key) {
        <button class="bs-range-btn" [class.active]="nwRange() === r.key"
          (click)="nwRange.set(r.key)">{{ r.label }}</button>
      }
    </div>
  }
</div>

@if (state.netWorthSnapshots().length < 2) {
  <div class="bs-chart-placeholder">
    <div style="font-size:28px;opacity:.3">📊</div>
    <div>尚無足夠資料繪製趨勢圖</div>
    <div style="font-size:12px;margin-top:4px">系統每日 23:58 自動記錄，幾天後即可看到趨勢</div>
  </div>
} @else {
  @let chart = chartData();
  @if (chart) {
    <div class="bs-chart-wrap">
      <svg [attr.viewBox]="'0 0 ' + chart.w + ' ' + chart.h" class="bs-chart-svg">
        @for (y of chart.yAxis; track y.val) {
          <line [attr.x1]="chart.pad.l" [attr.x2]="chart.w - chart.pad.r"
            [attr.y1]="y.y" [attr.y2]="y.y" class="bs-grid-line" />
          <text [attr.x]="chart.pad.l - 6" [attr.y]="y.y + 4"
            class="bs-axis-label" text-anchor="end">{{ y.label }}</text>
        }
        @for (pt of chart.xLabels; track $index) {
          <text [attr.x]="pt.x" [attr.y]="chart.h - 4"
            class="bs-axis-label" text-anchor="middle">{{ pt.label }}</text>
        }
        <polyline [attr.points]="chart.netPoints" class="bs-line-net" fill="none" />
        @for (pt of chart.dots; track $index) {
          <circle [attr.cx]="pt.x" [attr.cy]="pt.netY" r="3.5" class="bs-dot-net" />
        }
      </svg>
      <div class="bs-chart-legend">
        <span><span class="bs-legend-dot" style="background:#d4a017"></span>淨資產</span>
        <span style="margin-left:auto">{{ chart.count }} 筆快照</span>
      </div>
    </div>
  } @else {
    <div class="bs-chart-placeholder">此區間快照不足，請選擇較長的時間週期</div>
  }
  <details class="bs-alloc-details" style="margin-top:-6px">
    <summary>快照明細（{{ state.netWorthSnapshots().length }} 筆）</summary>
    <table class="bs-snap-table">
      <thead><tr>
        <th>日期</th>
        <th style="text-align:right">資產</th>
        <th style="text-align:right">負債</th>
        <th style="text-align:right">淨資產</th>
        <th></th>
      </tr></thead>
      <tbody>
        @for (s of state.netWorthSnapshots(); track s.id) {
          <tr>
            <td>{{ s.date }}</td>
            <td style="text-align:right" class="pos">{{ fmtNT(s.assets) }}</td>
            <td style="text-align:right" class="neg">{{ fmtNT(s.liabilities) }}</td>
            <td style="text-align:right" [class.pos]="s.assets-s.liabilities>=0" [class.neg]="s.assets-s.liabilities<0">{{ fmtNT(s.assets - s.liabilities) }}</td>
            <td><button class="bs-del-btn" (click)="deleteSnapshot(s.id)" title="刪除">✕</button></td>
          </tr>
        }
      </tbody>
    </table>
  </details>
}
  `,
  styles: [`
    /* summary */
    .bs-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:24px; }
    .bs-summary-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px 16px; }
    .bs-liab-card { border-color:rgba(192,57,43,.25); }
    .bs-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
    .bs-value { font-size:20px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    /* section heading */
    .bs-group-title { font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
    /* two-column assets+liabilities */
    .bs-two-col { display:flex; gap:0; align-items:flex-start; margin-bottom:20px; }
    .bs-col { flex:1; min-width:0; }
    .bs-col-label { font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px; }
    .bs-col-sep { width:1px; background:var(--border); margin:0 14px; align-self:stretch; flex-shrink:0; }
    .bs-inner-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; }
    @media (max-width:600px) {
      .bs-two-col { flex-direction:column; gap:16px; }
      .bs-col-sep { display:none; }
      .bs-inner-grid { grid-template-columns:1fr 1fr; }
    }
    /* cards */
    .bs-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:4px; }
    .bs-card-liab { border-color:rgba(192,57,43,.15); }
    .bs-card-alert { border-color:rgba(192,57,43,.5); background:rgba(192,57,43,.04); }
    .bs-card-icon { font-size:22px; margin-bottom:4px; }
    .bs-card-name { font-size:13px; font-weight:700; color:var(--text); display:flex; align-items:center; gap:5px; }
    .bs-card-amount { font-size:17px; font-weight:700; font-family:'JetBrains Mono',monospace; margin-top:4px; }
    .bs-card-sub { font-size:12px; color:var(--text-muted); }
    .bs-card-warn { font-size:11px; color:var(--text-muted); font-style:italic; }
    .bs-card-btn { margin-top:10px; font-size:12px; color:var(--gold); background:none; border:none; padding:0; cursor:pointer; text-align:left; }
    .bs-card-btn:hover { text-decoration:underline; }
    .bs-alert-dot { font-size:13px; }
    .bs-empty { text-align:center; color:var(--text-muted); font-size:14px; padding:20px 0; }
    .bs-text-link { background:none; border:none; color:var(--gold); cursor:pointer; font-size:14px; text-decoration:underline; padding:0; }
    .bs-chart-hint { font-size:11px; color:var(--text-muted); margin-bottom:10px; }
    /* asset allocation */
    .bs-alloc-wrap { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:18px 20px; margin-bottom:10px; }
    .bs-alloc-details { margin-bottom:16px; }
    .bs-alloc-details summary { font-size:12px; color:var(--text-muted); cursor:pointer; user-select:none; }
    .bs-alloc-select { font-size:12px; padding:2px 6px; border:1px solid var(--border); border-radius:6px; background:var(--panel-bg); color:var(--text); }
    /* net worth history header + range selector */
    .bs-nw-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-top:28px; margin-bottom:10px; flex-wrap:wrap; }
    .bs-range-group { display:flex; gap:2px; background:rgba(127,140,141,.1); border:1px solid var(--border); border-radius:8px; padding:2px; }
    .bs-range-btn { font-size:12px; padding:3px 10px; border:none; background:none; color:var(--text-muted); border-radius:6px; cursor:pointer; font-weight:600; white-space:nowrap; }
    .bs-range-btn:hover { color:var(--text); }
    .bs-range-btn.active { background:var(--panel-bg); color:var(--gold); box-shadow:0 1px 3px rgba(0,0,0,.15); }
    /* chart */
    .bs-chart-placeholder { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:32px 16px; text-align:center; color:var(--text-muted); font-size:13px; margin-bottom:16px; }
    .bs-chart-wrap { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px; }
    .bs-chart-svg { width:100%; display:block; }
    .bs-grid-line { stroke:var(--border); stroke-width:0.5; }
    .bs-axis-label { font-size:9px; fill:var(--text-muted); font-family:'JetBrains Mono',monospace; }
    .bs-line-assets { stroke:#3498db; stroke-width:2; }
    .bs-line-liab   { stroke:#e74c3c; stroke-width:2; stroke-dasharray:4,3; }
    .bs-line-net    { stroke:#d4a017; stroke-width:2.5; }
    .bs-dot-assets  { fill:#3498db; }
    .bs-dot-liab    { fill:#e74c3c; }
    .bs-dot-net     { fill:#d4a017; }
    .bs-chart-legend { display:flex; gap:16px; font-size:11px; color:var(--text-muted); margin-top:6px; flex-wrap:wrap; }
    .bs-legend-dot  { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; vertical-align:middle; }
    /* snapshot table */
    .bs-snap-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:14px; }
    .bs-snap-table th { text-align:left; color:var(--text-muted); font-weight:600; border-bottom:1px solid var(--border); padding:4px 6px; }
    .bs-snap-table td { padding:4px 6px; border-bottom:1px solid rgba(255,255,255,.04); font-family:'JetBrains Mono',monospace; }
    .bs-del-btn { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:11px; padding:2px 5px; border-radius:4px; opacity:.5; }
    .bs-del-btn:hover { opacity:1; color:var(--red,#e74c3c); background:rgba(231,76,60,.1); }
    .pos { color:var(--green,#27ae60); }
    .neg { color:var(--red,#e74c3c); }
    .text-danger { color:var(--red,#c0392b); }
    @media (max-width:600px) {
      .bs-summary { grid-template-columns:1fr 1fr; }
      .bs-summary-card:last-child { grid-column:1/-1; }
    }
  `],
})
export class BalanceSheetViewComponent {
  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  holdingRows = computed(() => {
    const trades = this.state.trades();
    const markets = this.state.tradeMarkets();
    const closeMap = this.stock.closeMap();
    const nameMap = this.stock.codeToName();
    const fx = this.state.usdTwdRate();
    return Object.entries(trades)
      .map(([code, ts]) => {
        const mkt = markets[code] ?? 'tw';
        const fifo = calcFIFO(ts, mkt);
        if (fifo.holdingShares <= 0) return null;
        const price = closeMap[code]?.close ?? null;
        const toNTD = mkt === 'us' ? fx : 1;
        const mv = price !== null ? price * fifo.holdingShares * toNTD : null;
        return { code, name: nameMap[code] ?? '', shares: fifo.holdingShares, price, mv, market: mkt };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  });

  assetClassOptions = ASSET_CLASSES;
  Math = Math;

  /** 持股 + 使用者覆寫/自動判斷的資產分類 */
  classedHoldings = computed(() => {
    const overrides = this.state.assetClasses();
    return this.holdingRows()
      .map(h => ({
        ...h,
        assetClass: overrides[h.code] ?? detectAssetClass(h.code, h.name, h.market),
      }))
      .sort((a, b) => (b.mv ?? 0) - (a.mv ?? 0));
  });

  /** 資產配置彙總：現金 + 各股票分類 + 基金 */
  allocationGroups = computed(() => {
    const total = this.assetTotal();
    if (total <= 0) return [];
    const groups: { label: string; icon: string; total: number; pct: number; color: string }[] = [];
    const colors: Record<string, string> = {
      '現金': '#3498db', '台股個股': '#d4a017', '市場型ETF': '#8e7cc3',
      '高股息ETF': '#e67e22', '債券ETF': '#27ae60', '美股': '#c0392b',
      '基金': '#16a085', '其他': '#7f8c8d',
    };
    const icons: Record<string, string> = {
      '現金': '💰', '台股個股': '📈', '市場型ETF': '📊',
      '高股息ETF': '💵', '債券ETF': '🏛️', '美股': '🇺🇸',
      '基金': '🏦', '其他': '📦',
    };
    const push = (label: string, amount: number) => {
      if (amount <= 0) return;
      groups.push({
        label, total: amount, pct: (amount / total) * 100,
        icon: icons[label] ?? '📦', color: colors[label] ?? '#7f8c8d',
      });
    };

    push('現金', this.cashTotal());
    const byClass = new Map<string, number>();
    for (const h of this.classedHoldings()) {
      if (h.mv == null) continue;
      byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.mv);
    }
    for (const [cls, amt] of byClass.entries()) push(cls, amt);
    push('基金', this.fundTotal());

    return groups.sort((a, b) => b.total - a.total);
  });

  allocationSlices = computed((): PieSlice[] =>
    this.allocationGroups().map(g => ({ label: g.label, value: g.total, color: g.color, icon: g.icon })),
  );

  async onClassChange(code: string, e: Event) {
    const assetClass = (e.target as HTMLSelectElement).value;
    await this.api.setAssetClass(code, assetClass);
    this.state.setAssetClass(code, assetClass);
  }

  cashTotal      = computed(() => this.state.accounts().reduce((s, a) => s + a.balance, 0));
  stockTotal     = computed(() => this.holdingRows().reduce((s, h) => s + (h.mv ?? 0), 0));
  fundTotal      = computed(() => this.state.funds().reduce((s, f) => s + f.marketValue, 0));
  assetTotal     = computed(() => this.cashTotal() + this.stockTotal() + this.fundTotal());
  liabilityTotal = computed(() => this.state.liabilities().reduce((s, l) => s + l.amount, 0));

  liabilityGroups = computed(() => {
    const map = new Map<string, { total: number; count: number; hasAlert: boolean }>();
    for (const l of this.state.liabilities()) {
      const g = map.get(l.type) ?? { total: 0, count: 0, hasAlert: false };
      g.total += l.amount; g.count += 1;
      if (this.isReminderToday(l)) g.hasAlert = true;
      map.set(l.type, g);
    }
    return Array.from(map.entries()).map(([type, g]) => ({ type, ...g }));
  });

  isReminderToday(l: { reminderEnabled: boolean; reminderDay: number | null }) {
    if (!l.reminderEnabled || !l.reminderDay) return false;
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() === Math.min(l.reminderDay, lastDay);
  }

  typeIcon(t: string) {
    const icons: Record<string, string> = { '房貸': '🏠', '車貸': '🚗', '信用貸款': '🏦', '信用卡': '💳', '學貸': '🎓', '其他': '📋' };
    return icons[t] ?? '📋';
  }

  fmtNT(n: number) { return `NT$${Math.round(Math.abs(n)).toLocaleString()}`; }

  goAccounts()    { this.state.view.set('accounts'); }
  goFunds()       { this.state.view.set('funds'); }
  goLiabilities() { this.state.view.set('liabilities'); }

  async deleteSnapshot(id: string) {
    await this.api.deleteNetWorthSnapshot(id);
    this.state.removeNetWorthSnapshot(id);
  }

  // ── Net worth history range selection ──────────────────────────────────────
  nwRange = signal<NwRange>('3m');
  nwRanges: { key: NwRange; label: string }[] = [
    { key: '1w',  label: '1週' },
    { key: '1m',  label: '1月' },
    { key: '3m',  label: '3月' },
    { key: 'ytd', label: '今年' },
    { key: '1y',  label: '1年' },
    { key: 'all', label: '最長' },
  ];

  private rangeCutoff(range: NwRange): string | null {
    const d = new Date();
    switch (range) {
      case '1w':  d.setDate(d.getDate() - 7); break;
      case '1m':  d.setMonth(d.getMonth() - 1); break;
      case '3m':  d.setMonth(d.getMonth() - 3); break;
      case 'ytd': return `${d.getFullYear()}-01-01`;
      case '1y':  d.setFullYear(d.getFullYear() - 1); break;
      case 'all': return null;
    }
    return d.toISOString().slice(0, 10);
  }

  filteredSnaps = computed(() => {
    const sorted = [...this.state.netWorthSnapshots()].sort((a, b) => a.date.localeCompare(b.date));
    const cutoff = this.rangeCutoff(this.nwRange());
    return cutoff ? sorted.filter(s => s.date >= cutoff) : sorted;
  });

  chartData = computed(() => {
    const snaps = this.filteredSnaps();
    if (snaps.length < 2) return null;

    const netVals = snaps.map(s => s.assets - s.liabilities);
    const rawMax = Math.max(...netVals);
    const rawMin = Math.min(...netVals);
    const pad    = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.12 || 1;
    const maxVal = rawMax + pad;
    const minVal = rawMin - pad;
    const range  = maxVal - minVal || 1;

    const xOf = (i: number) => PAD.l + (i / (snaps.length - 1)) * IW;
    const yOf = (v: number) => PAD.t + IH - ((v - minVal) / range) * IH;

    const toPoints = (vals: number[]) =>
      vals.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');

    const STEPS = 4;
    const yAxis = Array.from({ length: STEPS + 1 }, (_, i) => {
      const val = minVal + (range * i / STEPS);
      return { y: yOf(val), val, label: fmtK(val) };
    }).reverse();

    // 點多時：只標 ~6 個日期、不畫圓點，避免擁擠
    const n = snaps.length;
    const labelStep = Math.max(1, Math.ceil(n / 6));
    const longSpan = this.nwRange() === '1y' || this.nwRange() === 'all';
    const xLabels = snaps
      .map((s, i) => ({ i, s }))
      .filter(({ i }) => i % labelStep === 0 || i === n - 1)
      .map(({ i, s }) => ({
        x: xOf(i),
        label: longSpan ? s.date.slice(0, 7) : s.date.slice(5),  // "YYYY-MM" or "MM-DD"
      }));

    return {
      w: CHART_W, h: CHART_H, pad: PAD, count: n,
      netPoints: toPoints(netVals),
      dots: n <= 24
        ? snaps.map((s, i) => ({ x: xOf(i), netY: yOf(s.assets - s.liabilities) }))
        : [],
      xLabels,
      yAxis,
    };
  });
}
