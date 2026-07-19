import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { TrancheItem, TranchePlan } from '../../models/types';
import { calcFIFO } from '../../utils';
import { PieChartComponent, PieSlice } from '../pie-chart/pie-chart.component';

interface RiskRow {
  code: string;
  name: string;
  market: string;
  shares: number;
  avgCost: number;
  price: number | null;
  mvNTD: number | null;
  stopLoss: number | null;
  /** 跌到停損價的損失（NTD，正數） */
  riskNTD: number | null;
  /** riskNTD / 總資產 */
  riskPctAssets: number | null;
  /** 佔投組市值 % */
  weightPct: number | null;
  industry: string;
}

@Component({
  selector: 'app-risk-view',
  imports: [PieChartComponent],
  template: `
@let rows = riskRows();
@let dd = drawdown();

@if (rows.length === 0) {
  <div class="empty-state">
    <div class="empty-icon">🛡️</div>
    <div class="empty-title">尚無持倉</div>
    <div class="empty-sub">新增交易記錄後，即可在此檢視風險暴露。</div>
  </div>
} @else {
  <!-- Summary cards -->
  <div class="trade-summary trade-summary-3" style="margin-bottom:16px">
    <div class="trade-summary-card">
      <div class="tsc-label">停損總風險（NTD）</div>
      <div class="tsc-value" style="font-size:18px" [class.neg]="totalRisk() > 0">
        {{ hasAnyStopLoss() ? '-' + Math.round(totalRisk()).toLocaleString() : '—' }}
      </div>
      @if (hasAnyStopLoss() && totalAssets() > 0) {
        <div class="tsc-sub">全部停損同時觸發 = 總資產的 {{ (totalRisk() / totalAssets() * 100).toFixed(2) }}%</div>
      }
    </div>
    <div class="trade-summary-card" [class.pnl-neg]="noSLCount() > 0">
      <div class="tsc-label">未設停損</div>
      <div class="tsc-value" style="font-size:18px" [class.neg]="noSLCount() > 0">
        {{ noSLCount() }} / {{ rows.length }} 檔
      </div>
      @if (noSLCount() > 0) {
        <div class="tsc-sub neg">這些部位的下檔風險無法估算</div>
      }
    </div>
    <div class="trade-summary-card">
      <div class="tsc-label">淨資產最大回撤</div>
      <div class="tsc-value" style="font-size:18px" [class.neg]="dd != null && dd.maxDD > 0">
        {{ dd != null ? '-' + dd.maxDD.toFixed(2) + '%' : '—' }}
      </div>
      @if (dd != null) {
        <div class="tsc-sub">目前距高點 -{{ dd.currentDD.toFixed(2) }}%（{{ dd.days }} 筆快照）</div>
      } @else {
        <div class="tsc-sub">快照不足，數天後自動可用</div>
      }
    </div>
  </div>

  <!-- 單筆風險 -->
  <div class="risk-section-title">單筆停損風險（R）</div>
  <div class="risk-hint">跌到停損價會虧多少。常見紀律：單筆風險 ≦ 總資產 2%。</div>
  <div class="table-scroll-wrap">
  <table class="supply-table">
    <thead>
      <tr>
        <th style="width:70px">代碼</th>
        <th>名稱</th>
        <th style="width:80px;text-align:right">持股</th>
        <th style="width:90px;text-align:right">現價</th>
        <th style="width:90px;text-align:right">停損價</th>
        <th style="width:120px;text-align:right">觸發損失</th>
        <th style="width:110px;text-align:right">佔總資產</th>
      </tr>
    </thead>
    <tbody>
      @for (r of rows; track r.code) {
        <tr>
          <td><span class="risk-code">{{ r.code }}</span></td>
          <td style="font-weight:600">{{ r.name }}</td>
          <td class="risk-num">{{ r.shares.toLocaleString() }}</td>
          <td class="risk-num">{{ r.price != null ? fmtPrice(r.price, r.market) : '—' }}</td>
          <td class="risk-num">
            @if (r.stopLoss != null) {
              {{ fmtPrice(r.stopLoss, r.market) }}
            } @else {
              <span class="risk-warn-text">未設定</span>
            }
          </td>
          <td class="risk-num">
            @if (r.riskNTD != null) {
              <span [class.neg]="r.riskNTD > 0">-{{ Math.round(r.riskNTD).toLocaleString() }}</span>
            } @else {
              <span style="color:var(--border)">—</span>
            }
          </td>
          <td class="risk-num">
            @if (r.riskPctAssets != null) {
              <span class="risk-badge"
                [class.risk-ok]="r.riskPctAssets <= 1"
                [class.risk-mid]="r.riskPctAssets > 1 && r.riskPctAssets <= 2"
                [class.risk-high]="r.riskPctAssets > 2">
                {{ r.riskPctAssets.toFixed(2) }}%
              </span>
            } @else {
              <span style="color:var(--border)">—</span>
            }
          </td>
        </tr>
      }
    </tbody>
  </table>
  </div>

  <!-- 個股集中度 -->
  <div class="risk-section-title" style="margin-top:24px">個股集中度</div>
  <div class="risk-hint">單一持股佔投組市值比例（不含現金與基金）。</div>
  <div class="risk-bars">
    @for (r of concentrationRows(); track r.code) {
      <div class="risk-bar-row">
        <span class="risk-bar-label">{{ r.code }} {{ r.name }}</span>
        <div class="risk-bar-track">
          <div class="risk-bar-fill" [class.risk-bar-high]="r.pct > 30" [style.width.%]="Math.min(r.pct, 100)"></div>
        </div>
        <span class="risk-bar-pct">{{ r.pct.toFixed(1) }}%</span>
      </div>
    }
  </div>

  <!-- 產業集中度 -->
  @if (industrySlices().length > 0) {
    <div class="risk-section-title" style="margin-top:24px">產業集中度</div>
    <div class="risk-hint">單一產業超過 50% 以紅色標示。</div>
    <div class="risk-pie-wrap">
      <app-pie-chart [slices]="industrySlices()" />
    </div>
  }
}

<!-- ── 分批加碼計畫（543） ─────────────────────────── -->
<div style="display:flex;align-items:center;gap:12px;margin-top:28px;margin-bottom:4px">
  <div class="risk-section-title" style="margin:0">分批加碼計畫（543）</div>
  <button class="idx-add-btn" style="padding:4px 12px;font-size:13px;margin-left:auto"
    (click)="showPlanForm.set(!showPlanForm())">
    {{ showPlanForm() ? '取消' : '＋ 新計畫' }}
  </button>
</div>
<div class="risk-hint">資金分筆，跌到觸發價由 LINE 通知加碼（平日 13:00 檢查）。</div>

@if (showPlanForm()) {
  <div class="tp-form">
    <div class="tp-form-grid">
      <label>代碼
        <input [value]="fCode()" (input)="fCode.set(asStr($event))" placeholder="0050" />
      </label>
      <label>總金額
        <input type="number" [value]="fTotal()" (input)="fTotal.set(asStr($event))" placeholder="300000" />
      </label>
      <label>筆數
        <input type="number" [value]="fCount()" (input)="fCount.set(asStr($event))" />
      </label>
      <label>首筆價
        <input type="number" [value]="fFirst()" (input)="fFirst.set(asStr($event))"
          [placeholder]="currentClose(fCode()) != null ? '現價 ' + currentClose(fCode()) : '首筆觸發價'" />
      </label>
      <label>間隔 %
        <input type="number" [value]="fStep()" (input)="fStep.set(asStr($event))" />
      </label>
    </div>
    @let preview = previewItems();
    @if (preview.length > 0) {
      <div class="tp-preview">
        @for (p of preview; track p.seq) {
          <span class="tp-preview-chip">第{{ p.seq }}筆 {{ p.triggerPrice.toFixed(2) }}｜NT\${{ Math.round(p.amount).toLocaleString() }}</span>
        }
      </div>
    }
    <button class="idx-add-btn" style="padding:6px 16px;font-size:13px;margin-top:10px"
      [disabled]="preview.length === 0" (click)="createPlan()">建立計畫</button>
  </div>
}

@if (state.tranchePlans().length === 0 && !showPlanForm()) {
  <div class="tp-empty">尚無加碼計畫。點「＋ 新計畫」把 543 的等待價位交給系統盯。</div>
}

@for (plan of state.tranchePlans(); track plan.id) {
  @let filled = filledCount(plan);
  <div class="tp-plan">
    <div class="tp-plan-head">
      <span class="risk-code" style="font-size:15px">{{ plan.code }}</span>
      <span style="font-weight:600">{{ stockName(plan.code) }}</span>
      <span class="tp-progress">已投入 {{ filled }}/{{ plan.items.length }} 筆</span>
      @if (currentClose(plan.code) != null) {
        <span style="font-size:12px;color:var(--text-muted)">現價 {{ currentClose(plan.code) }}</span>
      }
      <button class="tp-del" (click)="deletePlan(plan)" title="刪除計畫">✕</button>
    </div>
    <div class="tp-items">
      @for (it of plan.items; track it.id) {
        @let hit = isHit(plan.code, it);
        <div class="tp-item" [class.tp-item-filled]="it.status === 'filled'" [class.tp-item-hit]="hit">
          <span class="tp-item-seq">第 {{ it.seq }} 筆</span>
          <span class="tp-item-price">{{ it.triggerPrice.toFixed(2) }}</span>
          <span class="tp-item-amt">NT\${{ Math.round(it.amount).toLocaleString() }}</span>
          <span class="tp-item-status">
            @if (it.status === 'filled') {
              ✓ 已買進 {{ it.filledDate }}
            } @else if (hit) {
              <span style="color:var(--red,#e74c3c);font-weight:700">▼ 已到價</span>
            } @else {
              等待中
            }
          </span>
          <button class="tp-item-btn" (click)="toggleItem(plan, it)">
            {{ it.status === 'filled' ? '撤銷' : '已買進' }}
          </button>
        </div>
      }
    </div>
  </div>
}
  `,
  styles: [`
    .risk-section-title { font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
    .risk-hint { font-size:12px; color:var(--text-muted); margin-bottom:10px; }
    .risk-code { font-family:'JetBrains Mono',monospace; font-weight:600; color:var(--gold); }
    .risk-num { text-align:right; font-family:'JetBrains Mono',monospace; }
    .risk-warn-text { color:var(--red,#e74c3c); font-size:12px; font-weight:600; }
    .risk-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:700; }
    .risk-ok   { background:rgba(39,174,96,.12);  color:var(--green,#27ae60); }
    .risk-mid  { background:rgba(212,160,23,.15); color:var(--gold,#d4a017); }
    .risk-high { background:rgba(231,76,60,.14);  color:var(--red,#e74c3c); }
    .risk-bars { display:flex; flex-direction:column; gap:6px; }
    .risk-bar-row { display:grid; grid-template-columns:180px 1fr 56px; align-items:center; gap:10px; }
    .risk-bar-label { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .risk-bar-track { height:14px; background:var(--panel-bg); border:1px solid var(--border); border-radius:7px; overflow:hidden; }
    .risk-bar-fill { height:100%; background:var(--gold,#d4a017); border-radius:7px; transition:width .3s; }
    .risk-bar-high { background:var(--red,#e74c3c); }
    .risk-bar-pct { font-size:12px; font-family:'JetBrains Mono',monospace; text-align:right; }
    .neg { color:var(--red,#e74c3c); }
    @media (max-width:600px) { .risk-bar-row { grid-template-columns:110px 1fr 52px; } }
    .risk-pie-wrap { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:18px 20px; }
    /* tranche plans */
    .tp-form { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:12px; }
    .tp-form-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
    .tp-form-grid label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--text-muted); font-weight:600; }
    .tp-form-grid input { padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg,transparent); color:var(--text); font-size:14px; font-family:'JetBrains Mono',monospace; }
    .tp-preview { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .tp-preview-chip { font-size:12px; font-family:'JetBrains Mono',monospace; border:1px solid var(--border); border-radius:8px; padding:3px 8px; color:var(--text-muted); }
    .tp-empty { color:var(--text-muted); font-size:13px; padding:14px 0; }
    .tp-plan { background:var(--panel-bg); border:1.5px solid var(--border); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
    .tp-plan-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
    .tp-progress { font-size:12px; color:var(--gold); font-weight:700; }
    .tp-del { margin-left:auto; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:12px; opacity:.5; }
    .tp-del:hover { opacity:1; color:var(--red,#e74c3c); }
    .tp-items { display:flex; flex-direction:column; gap:4px; }
    .tp-item { display:grid; grid-template-columns:64px 90px 120px 1fr 72px; align-items:center; gap:10px; padding:5px 8px; border-radius:6px; font-size:13px; }
    .tp-item-hit { background:rgba(231,76,60,.07); }
    .tp-item-filled { opacity:.55; }
    .tp-item-seq { font-weight:600; }
    .tp-item-price, .tp-item-amt { font-family:'JetBrains Mono',monospace; text-align:right; }
    .tp-item-status { font-size:12px; color:var(--text-muted); }
    .tp-item-btn { font-size:12px; padding:3px 10px; border:1px solid var(--border); border-radius:6px; background:none; color:var(--text); cursor:pointer; }
    .tp-item-btn:hover { border-color:var(--gold); color:var(--gold); }
    @media (max-width:600px) {
      .tp-form-grid { grid-template-columns:1fr 1fr; }
      .tp-item { grid-template-columns:52px 76px 1fr 64px; }
      .tp-item-status { display:none; }
    }
  `],
})
export class RiskViewComponent {
  Math = Math;

  showPlanForm = signal(false);
  fCode  = signal('');
  fTotal = signal('');
  fCount = signal('5');
  fFirst = signal('');
  fStep  = signal('3.5');

  constructor(public state: AppStateService, private stock: StockService, private api: ApiService) {
    if (!this.state.tranchePlansLoaded()) {
      this.api.getTranchePlans().then(plans => {
        this.state.tranchePlans.set(plans);
        this.state.tranchePlansLoaded.set(true);
      }).catch(() => {});
    }
  }

  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  stockName(code: string) { return this.stock.codeToName()[code] || ''; }
  currentClose(code: string): number | null { return this.stock.closeMap()[code]?.close ?? null; }
  filledCount(plan: TranchePlan) { return plan.items.filter(i => i.status === 'filled').length; }

  isHit(code: string, it: TrancheItem): boolean {
    if (it.status === 'filled') return false;
    const c = this.currentClose(code);
    return c != null && c <= it.triggerPrice;
  }

  previewItems = computed(() => {
    const total = parseFloat(this.fTotal());
    const count = parseInt(this.fCount(), 10);
    const step = parseFloat(this.fStep());
    let first = parseFloat(this.fFirst());
    if (isNaN(first)) first = this.currentClose(this.fCode().trim().toUpperCase()) ?? NaN;
    if ([total, count, step, first].some(isNaN) || total <= 0 || count < 2 || count > 10 || step <= 0 || first <= 0) {
      return [];
    }
    const amount = total / count;
    return Array.from({ length: count }, (_, i) => ({
      seq: i + 1,
      triggerPrice: first * (1 - (step / 100) * i),
      amount,
    }));
  });

  async createPlan() {
    const items = this.previewItems();
    const code = this.fCode().trim().toUpperCase();
    if (!items.length || !code) return;
    const plan: TranchePlan = {
      id: this.state.uid(),
      code,
      note: '',
      createdAt: Date.now(),
      items: items.map(p => ({
        id: this.state.uid(), seq: p.seq, triggerPrice: p.triggerPrice,
        amount: p.amount, status: 'pending' as const, filledDate: null, alertedAt: null,
      })),
    };
    const saved = await this.api.createTranchePlan(plan);
    this.state.addTranchePlan(saved);
    this.showPlanForm.set(false);
    this.fCode.set(''); this.fTotal.set(''); this.fFirst.set('');
    this.fCount.set('5'); this.fStep.set('3.5');
  }

  async deletePlan(plan: TranchePlan) {
    if (!confirm(`刪除 ${plan.code} 的加碼計畫？`)) return;
    await this.api.deleteTranchePlan(plan.id);
    this.state.removeTranchePlan(plan.id);
  }

  async toggleItem(plan: TranchePlan, it: TrancheItem) {
    const next = it.status === 'filled' ? 'pending' : 'filled';
    const updated = await this.api.patchTrancheItem(it.id, next);
    this.state.updateTrancheItem(plan.id, updated);
  }

  /** 總資產 = 現金 + 持股市值 + 基金（與資產負債頁同口徑） */
  totalAssets = computed(() => {
    const cash = this.state.accounts().reduce((s, a) => s + a.balance, 0);
    const stocks = this.riskRows().reduce((s, r) => s + (r.mvNTD ?? 0), 0);
    const funds = this.state.funds().reduce((s, f) => s + f.marketValue, 0);
    return cash + stocks + funds;
  });

  riskRows = computed<RiskRow[]>(() => {
    const fx = this.state.usdTwdRate();
    const closeMap = this.stock.closeMap();
    const nameMap = this.stock.codeToName();
    const industryMap = this.stock.industryMap();
    const rows: Omit<RiskRow, 'riskPctAssets' | 'weightPct'>[] = [];

    for (const [code, trades] of Object.entries(this.state.trades())) {
      const market = this.state.tradeMarkets()[code] ?? 'tw';
      const fifo = calcFIFO(trades, market);
      if (fifo.holdingShares <= 0) continue;
      const toNTD = market === 'us' ? fx : 1;
      const price = closeMap[code]?.close ?? null;
      const tracked = this.state.tracked().find(t => t.code === code);
      const slNum = parseFloat(tracked?.stopLoss ?? '');
      const stopLoss = !isNaN(slNum) && slNum > 0 ? slNum : null;
      const refPrice = price ?? fifo.avgCost;
      const riskNTD = stopLoss != null
        ? Math.max(0, (refPrice - stopLoss)) * fifo.holdingShares * toNTD
        : null;
      rows.push({
        code, market,
        name: nameMap[code] || code,
        shares: fifo.holdingShares,
        avgCost: fifo.avgCost,
        price,
        mvNTD: price != null ? price * fifo.holdingShares * toNTD : null,
        stopLoss,
        riskNTD,
        industry: industryMap[code] || '未分類',
      });
    }

    const totalMV = rows.reduce((s, r) => s + (r.mvNTD ?? 0), 0);
    const cash = this.state.accounts().reduce((s, a) => s + a.balance, 0);
    const funds = this.state.funds().reduce((s, f) => s + f.marketValue, 0);
    const assets = cash + totalMV + funds;

    return rows
      .map(r => ({
        ...r,
        riskPctAssets: r.riskNTD != null && assets > 0 ? (r.riskNTD / assets) * 100 : null,
        weightPct: r.mvNTD != null && totalMV > 0 ? (r.mvNTD / totalMV) * 100 : null,
      }))
      .sort((a, b) => (b.riskNTD ?? -1) - (a.riskNTD ?? -1));
  });

  totalRisk = computed(() => this.riskRows().reduce((s, r) => s + (r.riskNTD ?? 0), 0));
  hasAnyStopLoss = computed(() => this.riskRows().some(r => r.riskNTD != null));
  noSLCount = computed(() => this.riskRows().filter(r => r.stopLoss == null).length);

  concentrationRows = computed(() =>
    this.riskRows()
      .filter(r => r.weightPct != null)
      .map(r => ({ code: r.code, name: r.name, pct: r.weightPct! }))
      .sort((a, b) => b.pct - a.pct),
  );

  industrySlices = computed((): PieSlice[] => {
    const map = new Map<string, number>();
    let total = 0;
    for (const r of this.riskRows()) {
      if (r.mvNTD == null) continue;
      map.set(r.industry, (map.get(r.industry) ?? 0) + r.mvNTD);
      total += r.mvNTD;
    }
    if (total <= 0) return [];
    const palette = ['#d4a017', '#3498db', '#8e7cc3', '#27ae60', '#e67e22', '#16a085', '#c0392b', '#7f8c8d'];
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([industry, mv], i) => ({
        label: industry, value: mv,
        // 單一產業 > 50% 視為過度集中 → 紅色警示
        color: mv / total > 0.5 ? '#e74c3c' : palette[i % palette.length],
      }));
  });

  /** 淨資產快照的最大回撤與目前回撤 */
  drawdown = computed(() => {
    const snaps = [...this.state.netWorthSnapshots()].sort((a, b) => a.date.localeCompare(b.date));
    if (snaps.length < 2) return null;
    let peak = -Infinity, maxDD = 0;
    for (const s of snaps) {
      const net = s.assets - s.liabilities;
      if (net > peak) peak = net;
      if (peak > 0) maxDD = Math.max(maxDD, ((peak - net) / peak) * 100);
    }
    const last = snaps[snaps.length - 1];
    const lastNet = last.assets - last.liabilities;
    const currentDD = peak > 0 ? Math.max(0, ((peak - lastNet) / peak) * 100) : 0;
    return { maxDD, currentDD, days: snaps.length };
  });

  fmtPrice(n: number, market: string) {
    if (market === 'us') return n.toFixed(2);
    return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
  }
}
