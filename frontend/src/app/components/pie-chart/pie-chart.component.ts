import { Component, computed, input } from '@angular/core';

export interface PieSlice {
  label: string;
  value: number;
  color: string;
  icon?: string;
}

const TAU = Math.PI * 2;

@Component({
  selector: 'app-pie-chart',
  template: `
<div class="pie-wrap">
  <svg [attr.viewBox]="'0 0 ' + SIZE + ' ' + SIZE" class="pie-svg">
    @for (a of arcs(); track a.label) {
      <path [attr.d]="a.path" [attr.fill]="a.color" class="pie-slice">
        <title>{{ a.label }}：{{ fmtNT(a.value) }}（{{ a.pct.toFixed(1) }}%）</title>
      </path>
    }
    @if (centerTitle()) {
      <text [attr.x]="SIZE/2" [attr.y]="SIZE/2 - 8" text-anchor="middle" class="pie-center-title">{{ centerTitle() }}</text>
      <text [attr.x]="SIZE/2" [attr.y]="SIZE/2 + 14" text-anchor="middle" class="pie-center-value">{{ centerValue() }}</text>
    }
  </svg>
  <div class="pie-legend">
    @for (a of arcs(); track a.label) {
      <div class="pie-legend-row">
        <span class="pie-legend-dot" [style.background]="a.color"></span>
        <span class="pie-legend-label">{{ a.icon }} {{ a.label }}</span>
        <span class="pie-legend-amt">{{ fmtNT(a.value) }}</span>
        <span class="pie-legend-pct">{{ a.pct.toFixed(1) }}%</span>
      </div>
    }
  </div>
</div>
  `,
  styles: [`
    .pie-wrap { display:flex; align-items:center; gap:24px; }
    .pie-svg { width:190px; height:190px; flex-shrink:0; }
    .pie-slice { stroke:var(--panel-bg); stroke-width:1.5; }
    .pie-center-title { font-size:11px; fill:var(--text-muted); font-weight:600; }
    .pie-center-value { font-size:14px; font-weight:700; fill:var(--text); font-family:'JetBrains Mono',monospace; }
    .pie-legend { flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
    .pie-legend-row { display:grid; grid-template-columns:12px 1fr 110px 52px; align-items:center; gap:8px; }
    .pie-legend-dot { width:10px; height:10px; border-radius:3px; }
    .pie-legend-label { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pie-legend-amt { font-size:12px; font-family:'JetBrains Mono',monospace; text-align:right; color:var(--text-muted); }
    .pie-legend-pct { font-size:12px; font-family:'JetBrains Mono',monospace; text-align:right; font-weight:700; }
    @media (max-width:600px) {
      .pie-wrap { flex-direction:column; gap:14px; }
      .pie-legend { width:100%; }
      .pie-legend-row { grid-template-columns:12px 1fr 60px; }
      .pie-legend-amt { display:none; }
    }
  `],
})
export class PieChartComponent {
  slices = input.required<PieSlice[]>();
  centerTitle = input('');
  centerValue = input('');

  readonly SIZE = 190;

  arcs = computed(() => {
    const slices = this.slices().filter(s => s.value > 0);
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return [];
    const cx = this.SIZE / 2, cy = this.SIZE / 2;
    const r1 = this.SIZE / 2 - 2;   // outer
    const r0 = r1 * 0.62;           // inner (donut hole)
    let angle = -Math.PI / 2;       // start at 12 o'clock
    return slices.map(s => {
      const frac = s.value / total;
      const start = angle;
      // cap just under a full turn so a single 100% slice still renders
      const sweep = Math.min(frac * TAU, TAU - 0.0001);
      const end = start + sweep;
      angle = end;
      return {
        label: s.label, icon: s.icon ?? '', color: s.color,
        value: s.value, pct: frac * 100,
        path: this.donutArc(cx, cy, r0, r1, start, end),
      };
    });
  });

  private donutArc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}`
         + ` L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
  }

  fmtNT(n: number) { return `NT$${Math.round(n).toLocaleString()}`; }
}
