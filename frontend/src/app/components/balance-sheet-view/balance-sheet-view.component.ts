import { Component, computed } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { calcFIFO } from '../../utils';

const CHART_W = 560;
const CHART_H = 180;
const PAD = { l: 64, r: 16, t: 18, b: 32 };
const IW = CHART_W - PAD.l - PAD.r;
const IH = CHART_H - PAD.t - PAD.b;

function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(Math.round(n));
}

@Component({
  selector: 'app-balance-sheet-view',
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

<!-- ── Asset cards ─────────────────────────────────── -->
<div class="bs-group-title">資產</div>
<div class="bs-card-grid">
  <div class="bs-card">
    <div class="bs-card-icon">💰</div>
    <div class="bs-card-name">現金帳戶</div>
    <div class="bs-card-amount">{{ fmtNT(cashTotal()) }}</div>
    <div class="bs-card-sub">{{ state.accounts().length }} 個帳戶</div>
    <button class="bs-card-btn" (click)="goAccounts()">管理帳戶 →</button>
  </div>
  <div class="bs-card">
    <div class="bs-card-icon">📈</div>
    <div class="bs-card-name">持股市值</div>
    <div class="bs-card-amount">{{ fmtNT(stockTotal()) }}</div>
    <div class="bs-card-sub">{{ holdingRows().length }} 支股票</div>
    @if (holdingRows().some(h => h.mv === null)) {
      <div class="bs-card-warn">部分持股市價未知</div>
    }
  </div>
  @if (state.funds().length > 0) {
    <div class="bs-card" style="cursor:pointer" (click)="goFunds()">
      <div class="bs-card-icon">🏦</div>
      <div class="bs-card-name">基金市值</div>
      <div class="bs-card-amount">{{ fmtNT(fundTotal()) }}</div>
      <div class="bs-card-sub">{{ state.funds().length }} 筆基金</div>
      <button class="bs-card-btn" (click)="goFunds()">管理基金 →</button>
    </div>
  }
</div>

<!-- ── Liability summary ────────────────────────────── -->
<div class="bs-group-header">
  <div class="bs-group-title">負債</div>
  <button class="idx-add-btn" (click)="goLiabilities()">管理負債 →</button>
</div>

@if (state.liabilities().length === 0) {
  <div class="bs-empty">尚無負債記錄，
    <button class="bs-text-link" (click)="goLiabilities()">點此管理負債</button>
  </div>
} @else {
  <div class="bs-card-grid">
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

<!-- ── Net Worth History Chart ──────────────────────── -->
<div class="bs-group-title" style="margin-top:28px">資產負債歷史</div>
<div class="bs-chart-hint">每日 23:58 自動擷取快照</div>

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
        <polyline [attr.points]="chart.assetsPoints" class="bs-line-assets" fill="none" />
        <polyline [attr.points]="chart.liabPoints"   class="bs-line-liab"   fill="none" />
        <polyline [attr.points]="chart.netPoints"    class="bs-line-net"    fill="none" />
        @for (pt of chart.dots; track $index) {
          <circle [attr.cx]="pt.x" [attr.cy]="pt.assetsY" r="3"   class="bs-dot-assets" />
          <circle [attr.cx]="pt.x" [attr.cy]="pt.liabY"   r="3"   class="bs-dot-liab" />
          <circle [attr.cx]="pt.x" [attr.cy]="pt.netY"    r="3.5" class="bs-dot-net" />
        }
      </svg>
      <div class="bs-chart-legend">
        <span><span class="bs-legend-dot" style="background:#3498db"></span>資產</span>
        <span><span class="bs-legend-dot" style="background:#e74c3c"></span>負債</span>
        <span><span class="bs-legend-dot" style="background:#d4a017"></span>淨資產</span>
      </div>
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
    </div>
  }
}
  `,
  styles: [`
    /* summary */
    .bs-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:24px; }
    .bs-summary-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px 16px; }
    .bs-liab-card { border-color:rgba(192,57,43,.25); }
    .bs-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
    .bs-value { font-size:20px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    /* group */
    .bs-group-title { font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
    .bs-group-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; margin-top:24px; }
    .bs-group-header .bs-group-title { margin-bottom:0; }
    /* cards */
    .bs-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; margin-bottom:20px; }
    .bs-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:4px; }
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
      .bs-card-grid { grid-template-columns:1fr 1fr; }
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
    return Object.entries(trades)
      .map(([code, ts]) => {
        const mkt = markets[code] ?? 'tw';
        const fifo = calcFIFO(ts, mkt);
        if (fifo.holdingShares <= 0) return null;
        const price = closeMap[code]?.close ?? null;
        return { code, name: nameMap[code] ?? '', shares: fifo.holdingShares, price, mv: price !== null ? price * fifo.holdingShares : null };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  });

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

  chartData = computed(() => {
    const snaps = this.state.netWorthSnapshots().slice(-12);
    if (snaps.length < 2) return null;

    const allVals = snaps.flatMap(s => [s.assets, s.liabilities, s.assets - s.liabilities]);
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
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

    return {
      w: CHART_W, h: CHART_H, pad: PAD,
      assetsPoints: toPoints(snaps.map(s => s.assets)),
      liabPoints:   toPoints(snaps.map(s => s.liabilities)),
      netPoints:    toPoints(snaps.map(s => s.assets - s.liabilities)),
      dots: snaps.map((s, i) => ({
        x: xOf(i),
        assetsY: yOf(s.assets),
        liabY:   yOf(s.liabilities),
        netY:    yOf(s.assets - s.liabilities),
      })),
      xLabels: snaps.map((s, i) => ({
        x: xOf(i),
        label: s.date.slice(5),  // "MM-DD"
      })),
      yAxis,
    };
  });
}
