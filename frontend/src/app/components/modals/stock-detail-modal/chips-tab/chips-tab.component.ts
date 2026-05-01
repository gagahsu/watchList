import { Component, Input, OnInit, signal } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { ChipData, InstitutionalDay, MarginDay, LendingDay, ShareholdingWeek } from '../../../../models/types';

const W = 560, H = 110, PAD = { l: 8, r: 8, t: 8, b: 20 };
const CHART_W = W - PAD.l - PAD.r;
const CHART_H = H - PAD.t - PAD.b;

function barChart(
  values: number[],
  colors: { pos: string; neg: string },
): { bars: { x: number; y: number; h: number; fill: string; v: number }[]; zeroY: number; w: number; h: number } {
  const n = values.length;
  if (!n) return { bars: [], zeroY: CHART_H / 2, w: W, h: H };
  const max = Math.max(...values.map(Math.abs), 1);
  const bw  = Math.max(1, (CHART_W / n) - 1);
  const zeroY = PAD.t + CHART_H / 2;
  const bars = values.map((v, i) => {
    const pct = Math.abs(v) / max;
    const bh  = Math.max(1, pct * (CHART_H / 2));
    const x   = PAD.l + i * (CHART_W / n);
    const y   = v >= 0 ? zeroY - bh : zeroY;
    return { x, y, h: bh, fill: v >= 0 ? colors.pos : colors.neg, v };
  });
  return { bars, zeroY, w: W, h: H };
}

function lineChart(
  series: { values: number[]; color: string }[],
): { lines: { points: string; color: string }[]; w: number; h: number } {
  const allVals = series.flatMap(s => s.values);
  if (!allVals.length) return { lines: [], w: W, h: H };
  const min = Math.min(...allVals);
  const max = Math.max(...allVals, min + 0.001);
  const n   = series[0].values.length;
  const lines = series.map(s => {
    const pts = s.values.map((v, i) => {
      const x = PAD.l + (i / (n - 1)) * CHART_W;
      const y = PAD.t + CHART_H - ((v - min) / (max - min)) * CHART_H;
      return `${x},${y}`;
    }).join(' ');
    return { points: pts, color: s.color };
  });
  return { lines, w: W, h: H };
}

@Component({
  selector: 'app-chips-tab',
  template: `
@if (loading()) {
  <div class="chip-loading">載入籌碼資料中…</div>
} @else if (error()) {
  <div class="chip-error">{{ error() }}</div>
} @else if (data()) {

  <!-- ── 三大法人 ── -->
  <div class="chip-section">
    <div class="chip-section-title">三大法人</div>
    @let inst = data()!.institutional;
    @let last = inst[inst.length - 1];
    @if (last) {
      <div class="chip-summary-row">
        <div class="chip-summary-cell">
          <div class="chip-label">外資</div>
          <div class="chip-val" [class.pos]="last.foreign>0" [class.neg]="last.foreign<0">
            {{ fmtNet(last.foreign) }}
          </div>
          @if (last.foreignStreak) {
            <div class="chip-streak" [class.pos]="last.foreignDirection==='buy'" [class.neg]="last.foreignDirection==='sell'">
              連{{ last.foreignStreak }}{{ last.foreignDirection==='buy' ? '買' : '賣' }}
            </div>
          }
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">投信</div>
          <div class="chip-val" [class.pos]="last.trust>0" [class.neg]="last.trust<0">
            {{ fmtNet(last.trust) }}
          </div>
          @if (last.trustStreak) {
            <div class="chip-streak" [class.pos]="last.trustDirection==='buy'" [class.neg]="last.trustDirection==='sell'">
              連{{ last.trustStreak }}{{ last.trustDirection==='buy' ? '買' : '賣' }}
            </div>
          }
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">自營買賣</div>
          <div class="chip-val" [class.pos]="last.dealer>0" [class.neg]="last.dealer<0">
            {{ fmtNet(last.dealer) }}
          </div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">自營避險</div>
          <div class="chip-val" [class.pos]="last.dealerHedge>0" [class.neg]="last.dealerHedge<0">
            {{ fmtNet(last.dealerHedge) }}
          </div>
        </div>
        <div class="chip-summary-cell chip-total">
          <div class="chip-label">合計</div>
          <div class="chip-val" [class.pos]="last.total>0" [class.neg]="last.total<0">
            {{ fmtNet(last.total) }}
          </div>
          @if (last.totalStreak) {
            <div class="chip-streak" [class.pos]="last.totalDirection==='buy'" [class.neg]="last.totalDirection==='sell'">
              連{{ last.totalStreak }}{{ last.totalDirection==='buy' ? '買' : '賣' }}
            </div>
          }
        </div>
      </div>
      <div class="chip-date">{{ last.date }}</div>
    }
    <!-- Bar chart: 外資(blue) + 投信(orange) + 自營(purple) stacked -->
    @let instChart = instBarChart();
    @if (instChart.bars.length) {
      <div class="chip-chart-wrap">
        <svg [attr.viewBox]="'0 0 ' + instChart.w + ' ' + instChart.h" style="width:100%;display:block">
          <line [attr.x1]="0" [attr.y1]="instChart.zeroY" [attr.x2]="instChart.w" [attr.y2]="instChart.zeroY"
            stroke="var(--border)" stroke-width="1" />
          @for (b of instChart.bars; track $index) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.bw" [attr.height]="b.h" [attr.fill]="b.fill" rx="1" />
          }
        </svg>
      </div>
      <div class="chip-legend">
        <span class="chip-legend-dot" style="background:#3B82F6"></span>外資
        <span class="chip-legend-dot" style="background:#F59E0B"></span>投信
        <span class="chip-legend-dot" style="background:#8B5CF6"></span>自營
      </div>
    }
  </div>

  <!-- ── 融資融券 ── -->
  <div class="chip-section">
    <div class="chip-section-title">融資融券</div>
    @let margins = data()!.margin;
    @let mLast = margins[margins.length - 1];
    @if (mLast) {
      <div class="chip-summary-row">
        <div class="chip-summary-cell">
          <div class="chip-label">融資增減</div>
          <div class="chip-val" [class.pos]="mLast.marginChange>0" [class.neg]="mLast.marginChange<0">
            {{ fmtNet(mLast.marginChange) }}
          </div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">融資用率</div>
          <div class="chip-val">{{ mLast.marginUsage }}%</div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">融券增減</div>
          <div class="chip-val" [class.pos]="mLast.shortChange>0" [class.neg]="mLast.shortChange<0">
            {{ fmtNet(mLast.shortChange) }}
          </div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">券資比</div>
          <div class="chip-val">{{ mLast.shortRatio }}%</div>
        </div>
      </div>
      <div class="chip-date">{{ mLast.date }}</div>
    }
    <!-- Line chart: 融資用率 -->
    @let mChart = marginLineChart();
    @if (mChart.lines.length) {
      <div class="chip-chart-wrap">
        <svg [attr.viewBox]="'0 0 ' + mChart.w + ' ' + mChart.h" style="width:100%;display:block">
          @for (l of mChart.lines; track $index) {
            <polyline [attr.points]="l.points" [attr.stroke]="l.color"
              fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          }
        </svg>
      </div>
      <div class="chip-legend">
        <span class="chip-legend-dot" style="background:#3B82F6"></span>融資用率 (%)
      </div>
    }
  </div>

  <!-- ── 借券 ── -->
  @if (data()!.lending.length > 0) {
    <div class="chip-section">
      <div class="chip-section-title">借券</div>
      @let lendings = data()!.lending;
      @let lLast = lendings[lendings.length - 1];
      @if (lLast) {
        <div class="chip-summary-row">
          <div class="chip-summary-cell">
            <div class="chip-label">借券餘額</div>
            <div class="chip-val">{{ lLast.balance.toLocaleString() }}</div>
          </div>
          <div class="chip-summary-cell">
            <div class="chip-label">借券增減</div>
            <div class="chip-val" [class.pos]="lLast.change>0" [class.neg]="lLast.change<0">
              {{ fmtNet(lLast.change) }}
            </div>
          </div>
        </div>
        <div class="chip-date">{{ lLast.date }}</div>
      }
      @let lChart = lendingBarChart();
      @if (lChart.bars.length) {
        <div class="chip-chart-wrap">
          <svg [attr.viewBox]="'0 0 ' + lChart.w + ' ' + lChart.h" style="width:100%;display:block">
            <line [attr.x1]="0" [attr.y1]="lChart.zeroY" [attr.x2]="lChart.w" [attr.y2]="lChart.zeroY"
              stroke="var(--border)" stroke-width="1" />
            @for (b of lChart.bars; track $index) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.bw" [attr.height]="b.h" [attr.fill]="b.fill" rx="1" />
            }
          </svg>
        </div>
      }
    </div>
  }

  <!-- ── 股權分散 ── -->
  <div class="chip-section">
    <div class="chip-section-title">股權分散</div>
    @let shares = data()!.shareholding;
    @let sLast = shares[shares.length - 1];
    @if (sLast) {
      <div class="chip-summary-row">
        <div class="chip-summary-cell">
          <div class="chip-label">大戶持股 (400張↑)</div>
          <div class="chip-val">{{ sLast.bigHolder }}%</div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">散戶持股 (10張↓)</div>
          <div class="chip-val">{{ sLast.retail }}%</div>
        </div>
        <div class="chip-summary-cell">
          <div class="chip-label">總股東人數</div>
          <div class="chip-val">{{ sLast.totalShareholders.toLocaleString() }}</div>
        </div>
      </div>
      <div class="chip-date">{{ sLast.date }}</div>
    }
    @let sChart = shareholdingLineChart();
    @if (sChart.lines.length) {
      <div class="chip-chart-wrap">
        <svg [attr.viewBox]="'0 0 ' + sChart.w + ' ' + sChart.h" style="width:100%;display:block">
          @for (l of sChart.lines; track $index) {
            <polyline [attr.points]="l.points" [attr.stroke]="l.color"
              fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          }
        </svg>
      </div>
      <div class="chip-legend">
        <span class="chip-legend-dot" style="background:#F59E0B"></span>大戶 (400張以上)
        <span class="chip-legend-dot" style="background:#3B82F6"></span>散戶 (10張以下)
      </div>
    }
  </div>

}
  `,
  styles: [`
    :host { display:block; padding:12px 0; }
    .chip-loading, .chip-error { text-align:center; color:var(--text-muted); font-size:14px; padding:40px 0; }
    .chip-error { color:var(--red,#c0392b); }
    .chip-section { margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border); }
    .chip-section:last-child { border-bottom:none; margin-bottom:0; }
    .chip-section-title { font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
    .chip-summary-row { display:flex; gap:8px; flex-wrap:wrap; }
    .chip-summary-cell { flex:1; min-width:70px; background:var(--sidebar-bg); border:1px solid var(--border); border-radius:6px; padding:8px 10px; }
    .chip-total { border-color:var(--gold-light); }
    .chip-label { font-size:10px; color:var(--text-muted); margin-bottom:4px; }
    .chip-val { font-size:14px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .chip-streak { font-size:10px; font-weight:600; margin-top:2px; }
    .chip-date { font-size:11px; color:var(--text-muted); margin-top:6px; text-align:right; }
    .chip-chart-wrap { margin-top:10px; border:1px solid var(--border); border-radius:6px; overflow:hidden; background:var(--sidebar-bg); }
    .chip-legend { display:flex; align-items:center; gap:12px; font-size:11px; color:var(--text-muted); margin-top:6px; flex-wrap:wrap; }
    .chip-legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:3px; vertical-align:middle; }
    .pos { color:var(--red,#c0392b); }
    .neg { color:var(--green,#27ae60); }
  `],
})
export class ChipsTabComponent implements OnInit {
  @Input() code!: () => string;

  loading = signal(true);
  error   = signal('');
  data    = signal<ChipData | null>(null);

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const d = await this.api.getChips(this.code());
      this.data.set(d);
    } catch (e: any) {
      this.error.set('無法載入籌碼資料：' + (e?.message ?? ''));
    } finally {
      this.loading.set(false);
    }
  }

  fmtNet(v: number) {
    return (v > 0 ? '+' : '') + v.toLocaleString();
  }

  instBarChart() {
    const inst = this.data()?.institutional ?? [];
    const SLOT  = W / Math.max(inst.length, 1);
    const bw    = Math.max(1, SLOT / 3 - 1);
    const vals  = inst.map(d => [d.foreign, d.trust, d.dealer + d.dealerHedge]);
    const max   = Math.max(...vals.flat().map(Math.abs), 1);
    const zeroY = PAD.t + CHART_H / 2;
    const COLORS = ['#3B82F6', '#F59E0B', '#8B5CF6'];
    const bars: { x: number; y: number; h: number; bw: number; fill: string }[] = [];
    vals.forEach((group, i) => {
      group.forEach((v, j) => {
        const pct = Math.abs(v) / max;
        const bh  = Math.max(1, pct * (CHART_H / 2));
        bars.push({
          x:    PAD.l + i * SLOT + j * (bw + 1),
          y:    v >= 0 ? zeroY - bh : zeroY,
          h:    bh,
          bw,
          fill: COLORS[j],
        });
      });
    });
    return { bars, zeroY, w: W, h: H };
  }

  marginLineChart() {
    const m = this.data()?.margin ?? [];
    return lineChart([{ values: m.map(d => d.marginUsage), color: '#3B82F6' }]);
  }

  lendingBarChart() {
    const l = this.data()?.lending ?? [];
    return {
      ...barChart(l.map(d => d.change), { pos: '#EC4899', neg: '#10B981' }),
      bars: barChart(l.map(d => d.change), { pos: '#EC4899', neg: '#10B981' }).bars.map((b, i) => ({
        ...b,
        bw: Math.max(1, W / Math.max(l.length, 1) - 1),
      })),
    };
  }

  shareholdingLineChart() {
    const s = this.data()?.shareholding ?? [];
    return lineChart([
      { values: s.map(d => d.bigHolder), color: '#F59E0B' },
      { values: s.map(d => d.retail),    color: '#3B82F6' },
    ]);
  }
}
