import { Component, Input, OnInit, signal } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { ChipData } from '../../../../models/types';

const W = 560, H = 110, PAD_L = 8, PAD_R = 8, PAD_T = 8, PAD_B = 20;
const CW = W - PAD_L - PAD_R;
const CH = H - PAD_T - PAD_B;

function buildBars(
  groups: number[][], colors: string[],
): { x: number; y: number; h: number; bw: number; fill: string }[] {
  const n = groups.length;
  if (!n) return [];
  const max = Math.max(...groups.flat().map(Math.abs), 1);
  const slotW = CW / n;
  const bw = Math.max(1, slotW / groups[0].length - 1);
  const zeroY = PAD_T + CH / 2;
  const bars: { x: number; y: number; h: number; bw: number; fill: string }[] = [];
  groups.forEach((grp, i) => {
    grp.forEach((v, j) => {
      const bh = Math.max(1, (Math.abs(v) / max) * (CH / 2));
      bars.push({
        x:    PAD_L + i * slotW + j * (bw + 1),
        y:    v >= 0 ? zeroY - bh : zeroY,
        h:    bh,
        bw,
        fill: colors[j] + (v < 0 ? '99' : ''),
      });
    });
  });
  return bars;
}

function buildLine(values: number[]): string {
  const n = values.length;
  if (n < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values, min + 0.001);
  return values.map((v, i) => {
    const x = PAD_L + (i / (n - 1)) * CW;
    const y = PAD_T + CH - ((v - min) / (max - min)) * CH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
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
    <div class="chip-section-title">三大法人買賣超（張）</div>
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
    @let ibars = instBars();
    @if (ibars.length) {
      <div class="chip-chart-wrap">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" style="width:100%;display:block">
          <line [attr.x1]="0" [attr.y1]="PAD_T + CH/2" [attr.x2]="W" [attr.y2]="PAD_T + CH/2"
            stroke="var(--border)" stroke-width="1" />
          @for (b of ibars; track $index) {
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
    @if (!inst.length) { <div class="chip-empty">此股票暫無三大法人資料</div> }
  </div>

  <!-- ── 融資融券 ── -->
  <div class="chip-section">
    <div class="chip-section-title">融資融券</div>
    @let margins = data()!.margin;
    @let mLast = margins[margins.length - 1];
    @if (mLast) {
      <div class="chip-summary-row">
        <div class="chip-summary-cell">
          <div class="chip-label">融資餘額</div>
          <div class="chip-val">{{ mLast.marginBalance.toLocaleString() }}</div>
        </div>
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
          <div class="chip-label">融券餘額</div>
          <div class="chip-val">{{ mLast.shortBalance.toLocaleString() }}</div>
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
      <!-- 融資用率 line chart -->
      @let mLine = marginLine();
      @if (mLine) {
        <div class="chip-chart-wrap" style="margin-top:10px">
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" style="width:100%;display:block">
            <polyline [attr.points]="mLine" stroke="#3B82F6"
              fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        </div>
        <div class="chip-legend">
          <span class="chip-legend-dot" style="background:#3B82F6"></span>融資用率 (%)
        </div>
      }
    }
    @if (!margins.length) { <div class="chip-empty">此股票暫無融資融券資料</div> }
  </div>

}
  `,
  styles: [`
    :host { display:block; padding:12px 0; }
    .chip-loading, .chip-error, .chip-empty { text-align:center; color:var(--text-muted); font-size:13px; padding:20px 0; }
    .chip-error { color:var(--red,#c0392b); }
    .chip-section { margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border); }
    .chip-section:last-child { border-bottom:none; margin-bottom:0; }
    .chip-section-title { font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
    .chip-summary-row { display:flex; gap:6px; flex-wrap:wrap; }
    .chip-summary-cell { flex:1; min-width:60px; background:var(--sidebar-bg); border:1px solid var(--border); border-radius:6px; padding:7px 9px; }
    .chip-total { border-color:var(--gold-light); }
    .chip-label { font-size:10px; color:var(--text-muted); margin-bottom:3px; white-space:nowrap; }
    .chip-val { font-size:13px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .chip-streak { font-size:10px; font-weight:600; margin-top:2px; }
    .chip-date { font-size:11px; color:var(--text-muted); margin-top:6px; text-align:right; }
    .chip-chart-wrap { border:1px solid var(--border); border-radius:6px; overflow:hidden; background:var(--sidebar-bg); }
    .chip-legend { display:flex; align-items:center; gap:12px; font-size:11px; color:var(--text-muted); margin-top:6px; flex-wrap:wrap; }
    .chip-legend-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:3px; vertical-align:middle; }
    .pos { color:var(--red,#c0392b); }
    .neg { color:var(--green,#27ae60); }
  `],
})
export class ChipsTabComponent implements OnInit {
  @Input() code!: () => string;

  readonly W = W;
  readonly H = H;
  readonly PAD_T = PAD_T;
  readonly CH = CH;

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

  instBars() {
    const inst = this.data()?.institutional ?? [];
    const groups = inst.map(d => [d.foreign, d.trust, d.dealer + d.dealerHedge]);
    return buildBars(groups, ['#3B82F6', '#F59E0B', '#8B5CF6']);
  }

  marginLine() {
    const m = this.data()?.margin ?? [];
    return buildLine(m.map(d => d.marginUsage));
  }
}
