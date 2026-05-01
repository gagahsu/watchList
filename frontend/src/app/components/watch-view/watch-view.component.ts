import { Component, OnInit, signal, computed } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { OhlcBar } from '../../models/types';
import { STATUS_CLASS, STATUS_LABELS, calcFIFO } from '../../utils';

// ── MA calculation ──────────────────────────────────────────────────────────
function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    return sum / period;
  });
}

// ── SVG chart builder ───────────────────────────────────────────────────────
const CHART_W = 600;
const CHART_H = 220;
const PAD_L   = 44;
const PAD_R   = 8;
const PAD_T   = 12;
const PAD_B   = 20;
const PLOT_W  = CHART_W - PAD_L - PAD_R;
const PLOT_H  = CHART_H - PAD_T - PAD_B;

const MA_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#EC4899']; // 5/10/20/60

interface ChartData {
  candlesticks: { x: number; bodyY: number; bodyH: number; wickY1: number; wickY2: number; up: boolean }[];
  maLines: { period: number; color: string; points: string }[];
  yLabels: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
}

export function buildChart(bars: OhlcBar[]): ChartData {
  if (bars.length === 0) return { candlesticks: [], maLines: [], yLabels: [], xLabels: [] };

  const closes = bars.map(b => b.close);
  const allLow  = Math.min(...bars.map(b => b.low));
  const allHigh = Math.max(...bars.map(b => b.high));
  const pad = (allHigh - allLow) * 0.05 || 1;
  const yMin = allLow  - pad;
  const yMax = allHigh + pad;

  const scaleY = (v: number) => PAD_T + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;
  const n = bars.length;
  const barW = PLOT_W / n;
  const scaleX = (i: number) => PAD_L + (i + 0.5) * barW;

  // Candlesticks
  const candlesticks = bars.map((b, i) => {
    const x = scaleX(i);
    const up = b.close >= b.open;
    const bodyTop = scaleY(Math.max(b.open, b.close));
    const bodyBot = scaleY(Math.min(b.open, b.close));
    return {
      x, up,
      bodyY: bodyTop,
      bodyH: Math.max(bodyBot - bodyTop, 1),
      wickY1: scaleY(b.high),
      wickY2: scaleY(b.low),
    };
  });

  // MA lines (5/10/20/60)
  const maPeriods = [5, 10, 20, 60];
  const maLines = maPeriods.map((period, pi) => {
    const mas = calcMA(closes, period);
    const pts: string[] = [];
    mas.forEach((v, i) => {
      if (v === null) return;
      pts.push(`${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`);
    });
    return { period, color: MA_COLORS[pi], points: pts.join(' ') };
  }).filter(l => l.points.length > 0);

  // Y-axis labels (5 ticks)
  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const v = yMin + (yMax - yMin) * (i / 4);
    return { y: scaleY(v), label: v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2) };
  }).reverse();

  // X-axis labels: show ~5 evenly spaced dates
  const step = Math.max(1, Math.floor(n / 5));
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < n; i += step) {
    const d = bars[i].date.slice(5); // MM-DD
    xLabels.push({ x: scaleX(i), label: d });
  }

  return { candlesticks, maLines, yLabels, xLabels };
}

// ── Component ───────────────────────────────────────────────────────────────
interface WatchRow {
  code: string;
  name: string;
  status: string;
  close: number | null;
  bars: OhlcBar[];
  chart: ChartData;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-watch-view',
  template: `
<div class="watch-toolbar">
  <span style="font-size:13px;color:var(--text-muted)">
    鎖定 {{ lockedCount() }} 支 · 已持有 {{ holdingCount() }} 支
  </span>
  <button class="sov-filter-btn" [class.active]="filter()==='all'"    (click)="filter.set('all')">全部</button>
  <button class="sov-filter-btn" [class.active]="filter()==='locked'" (click)="filter.set('locked')">鎖定</button>
  <button class="sov-filter-btn" [class.active]="filter()==='holding'"(click)="filter.set('holding')">已持有</button>
</div>

@if (rows().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">🔒</div>
    <div class="empty-title">尚無鎖定或持有個股</div>
    <div class="empty-sub">在個股索引將股票狀態設為「鎖定」或「已持有」後，<br>將在此顯示 60 天 K 線圖。</div>
  </div>
} @else {
  <div class="watch-grid">
    @for (row of rows(); track row.code) {
      <div class="watch-card">
        <div class="watch-card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="idx-code" style="font-size:16px">{{ row.code }}</span>
            <span class="idx-name" style="font-size:15px">{{ row.name }}</span>
            <span class="company-chip {{ statusClass(row.status) }}" style="font-size:11px;padding:3px 8px;display:inline-flex">
              <span class="chip-dot"></span>{{ statusLabel(row.status) }}
            </span>
          </div>
          @if (row.close !== null) {
            <span style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700">
              {{ row.close.toLocaleString() }}
            </span>
          }
        </div>

        @if (row.loading) {
          <div class="watch-chart-placeholder">載入 K 線中…</div>
        } @else if (row.error || row.bars.length === 0) {
          <div class="watch-chart-placeholder" style="color:var(--text-muted)">無法取得 K 線資料</div>
        } @else {
          <!-- SVG Candlestick chart -->
          <div class="watch-chart-wrap">
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none"
                 style="width:100%;display:block">

              <!-- Y grid lines + labels -->
              @for (yl of row.chart.yLabels; track yl.label) {
                <line [attr.x1]="PAD_L" [attr.x2]="W - PAD_R"
                      [attr.y1]="yl.y" [attr.y2]="yl.y"
                      stroke="#E2D5BC" stroke-width="0.5" />
                <text [attr.x]="PAD_L - 4" [attr.y]="yl.y + 4"
                      text-anchor="end" font-size="9" fill="#7A6A52">{{ yl.label }}</text>
              }

              <!-- X labels -->
              @for (xl of row.chart.xLabels; track xl.label) {
                <text [attr.x]="xl.x" [attr.y]="H - 4"
                      text-anchor="middle" font-size="9" fill="#7A6A52">{{ xl.label }}</text>
              }

              <!-- Candlesticks -->
              @for (c of row.chart.candlesticks; track c.x) {
                <!-- Wick -->
                <line [attr.x1]="c.x" [attr.x2]="c.x"
                      [attr.y1]="c.wickY1" [attr.y2]="c.wickY2"
                      [attr.stroke]="c.up ? '#C0392B' : '#27AE60'" stroke-width="1" />
                <!-- Body -->
                <rect [attr.x]="c.x - candleHalfW" [attr.y]="c.bodyY"
                      [attr.width]="candleBodyW" [attr.height]="c.bodyH"
                      [attr.fill]="c.up ? '#C0392B' : '#27AE60'" />
              }

              <!-- MA lines -->
              @for (ma of row.chart.maLines; track ma.period) {
                <polyline [attr.points]="ma.points"
                          [attr.stroke]="ma.color"
                          fill="none" stroke-width="1.2" stroke-linejoin="round" />
              }
            </svg>

            <!-- MA legend -->
            <div class="watch-ma-legend">
              @for (ma of row.chart.maLines; track ma.period) {
                <span class="watch-ma-item">
                  <span class="watch-ma-dot" [style.background]="ma.color"></span>
                  MA{{ ma.period }}
                </span>
              }
            </div>
          </div>
        }
      </div>
    }
  </div>
}
  `,
  styles: [`
    .watch-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
    .watch-grid { display:flex; flex-direction:column; gap:20px; }
    .watch-card { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:12px; padding:16px; }
    .watch-card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:6px; }
    .watch-chart-wrap { position:relative; }
    .watch-chart-placeholder { height:200px; display:flex; align-items:center; justify-content:center; font-size:14px; color:var(--text-muted); }
    .watch-ma-legend { display:flex; gap:12px; margin-top:6px; flex-wrap:wrap; }
    .watch-ma-item { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--text-muted); font-family:'JetBrains Mono',monospace; }
    .watch-ma-dot { width:12px; height:3px; border-radius:2px; display:inline-block; }
  `],
})
export class WatchViewComponent implements OnInit {
  W = CHART_W;
  H = CHART_H;
  PAD_L = PAD_L;
  PAD_R = CHART_W - PAD_R;
  candleHalfW = 3;
  candleBodyW = 6;

  filter  = signal<'all'|'locked'|'holding'>('all');
  private _rows = signal<WatchRow[]>([]);

  lockedCount  = computed(() => this.state.tracked().filter(t => t.status === 'locked').length);
  holdingCount = computed(() => this.state.tracked().filter(t => t.status === 'holding').length);

  rows = computed(() => {
    const f = this.filter();
    return this._rows().filter(r => f === 'all' || r.status === f);
  });

  constructor(
    public state: AppStateService,
    private api: ApiService,
    public stock: StockService,
  ) {}

  async ngOnInit() {
    const targets = this.state.tracked()
      .filter(t => t.status === 'locked' || t.status === 'holding');

    // Initialise rows immediately so the grid renders
    const initial: WatchRow[] = targets.map(t => ({
      code: t.code,
      name: this.stock.codeToName()[t.code] || t.code,
      status: t.status,
      close: this.stock.closeMap()[t.code]?.close ?? null,
      bars: [], chart: { candlesticks: [], maLines: [], yLabels: [], xLabels: [] },
      loading: true, error: false,
    }));
    this._rows.set(initial);

    // Fetch OHLC for each in parallel (batched to avoid hammering)
    const results = await Promise.allSettled(
      targets.map(t => this.api.getOhlc(t.code))
    );

    this._rows.update(rows => rows.map((row, i) => {
      const res = results[i];
      if (res.status === 'fulfilled' && res.value.length > 0) {
        const bars = res.value;
        const n = bars.length;
        const bw = PLOT_W / n;
        this.candleHalfW = Math.max(1, Math.floor(bw / 2) - 1);
        this.candleBodyW = Math.max(2, this.candleHalfW * 2);
        return { ...row, bars, chart: buildChart(bars), loading: false, error: false };
      }
      return { ...row, loading: false, error: true };
    }));

    // Compute dynamic candle width from first successful result
    const first = this._rows().find(r => r.bars.length > 0);
    if (first) {
      const bw = PLOT_W / first.bars.length;
      this.candleHalfW = Math.max(1.5, bw / 2 - 1);
      this.candleBodyW = Math.max(3, this.candleHalfW * 2);
    }
  }

  statusClass(s: string) { return STATUS_CLASS[s] ?? ''; }
  statusLabel(s: string) { return STATUS_LABELS[s] ?? s; }
}
