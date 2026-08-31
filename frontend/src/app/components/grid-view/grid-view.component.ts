import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { GridAdvice, GridDecision, GridPosition } from '../../models/types';

const ASSET_CLASS_OPTIONS = [
  { value: 'equity', label: 'equity（股票型 ETF）' },
  { value: 'bond', label: 'bond（債券 ETF）' },
  { value: 'leveraged', label: 'leveraged（槓桿型）' },
  { value: 'stock', label: 'stock（個股）' },
];

const ACTION_LABELS: Record<string, string> = {
  BUY: '買進', SELL: '賣出', HOLD: '持有', REVIEW: '需複核', SKIP: '略過',
};
const ACTION_CLASS: Record<string, string> = {
  BUY: 'sig-dir-enter', SELL: 'sig-dir-exit',
  HOLD: 'sig-dir-watch', REVIEW: 'sig-dir-watch', SKIP: 'sig-dir-watch',
};

@Component({
  selector: 'app-grid-view',
  imports: [FormsModule],
  template: `
@let advice = advice_();
@let positions = positions_();

<div class="grid-toolbar">
  <button class="portfolio-refresh-btn" [disabled]="loadingAdvice()"
    (click)="refreshAdvice()" title="重新產生今日建議"><span [class.spinning]="loadingAdvice()">↻</span> 重新整理建議</button>
  @if (advice) {
    <span style="font-size:12px;color:var(--text-muted)">建議日期 {{ advice.asOf }}</span>
  }
  <button class="grid-tab-btn" [class.active]="tab() === 'advice'" (click)="tab.set('advice')">今日建議</button>
  <button class="grid-tab-btn" [class.active]="tab() === 'positions'" (click)="tab.set('positions')">持股狀態</button>
</div>

@if (loadingAdvice() && !advice) {
  <div class="empty-state">
    <div class="empty-icon">⏳</div>
    <div class="empty-title">正在計算今日建議…</div>
    <div class="empty-sub">要抓報價與日 K，可能需要幾秒鐘。</div>
  </div>
} @else if (tab() === 'advice') {

  @if (advice) {
    <div class="trade-summary trade-summary-3" style="margin-bottom:16px">
      <div class="trade-summary-card">
        <div class="tsc-label">今日訊號</div>
        <div class="tsc-value" style="font-size:18px">{{ advice.summary.tickers }} 檔 / {{ advice.summary.orders }} 筆</div>
      </div>
      <div class="trade-summary-card" [class.pnl-neg]="advice.summary.netCashFlow < 0" [class.pnl-pos]="advice.summary.netCashFlow > 0">
        <div class="tsc-label">預估淨現金流</div>
        <div class="tsc-value" style="font-size:18px" [class.neg]="advice.summary.netCashFlow < 0" [class.pos]="advice.summary.netCashFlow > 0">
          {{ advice.summary.netCashFlow > 0 ? '+' : '' }}{{ advice.summary.netCashFlow.toLocaleString() }}
        </div>
      </div>
      <div class="trade-summary-card">
        <div class="tsc-label">預估手續費＋稅</div>
        <div class="tsc-value" style="font-size:18px">{{ advice.summary.cost.toLocaleString() }}</div>
      </div>
    </div>
  }

  @if (!advice || advice.decisions.length === 0) {
    <div class="empty-state">
      <div class="empty-icon">🕸️</div>
      <div class="empty-title">尚無建議</div>
      <div class="empty-sub">按上方「重新整理建議」抓今天的報價並計算。</div>
    </div>
  } @else {
    <div class="table-scroll-wrap">
    <table class="supply-table">
      <thead>
        <tr>
          <th style="width:70px">代碼</th>
          <th>名稱</th>
          <th style="width:70px">動作</th>
          <th style="width:110px;text-align:right">建議股數</th>
          <th style="width:90px;text-align:right">現價</th>
          <th style="width:90px;text-align:right">錨點</th>
          <th style="width:80px;text-align:right">步長%</th>
          <th>說明</th>
          <th style="width:90px"></th>
        </tr>
      </thead>
      <tbody>
        @for (d of sortedDecisions(advice.decisions); track d.ticker) {
          <tr>
            <td><span class="risk-code">{{ d.ticker }}</span></td>
            <td style="font-weight:600">{{ d.name }}</td>
            <td><span class="sig-dir {{ ACTION_CLASS[d.action] }}">{{ ACTION_LABELS[d.action] }}</span></td>
            <td class="risk-num">
              @if (d.shares > 0) {
                {{ d.rungs }} × {{ d.lotShares }} = {{ d.shares.toLocaleString() }}
              } @else { <span style="color:var(--border)">—</span> }
            </td>
            <td class="risk-num">
              {{ d.price > 0 ? d.price.toFixed(2) : '—' }}
              @if (d.priceBandLow !== null && d.priceBandHigh !== null) {
                <div style="font-size:11px;color:var(--text-muted);font-weight:400">
                  {{ d.priceBandLow.toFixed(2) }}~{{ d.priceBandHigh.toFixed(2) }} 仍算此份數
                </div>
              }
            </td>
            <td class="risk-num">{{ d.anchorBefore.toFixed(3) }}</td>
            <td class="risk-num">{{ d.stepPct > 0 ? d.stepPct.toFixed(2) + '%' : '—' }}</td>
            <td style="font-size:12px;color:var(--text-muted);line-height:1.5">
              @for (b of d.blocks; track b) { <div class="grid-block-text">⛔ {{ b }}</div> }
              @for (n of d.notes; track n) { <div>{{ n }}</div> }
              @if (d.blocks.length === 0 && d.notes.length === 0 && d.reasons.length > 0) {
                <div>{{ d.reasons[d.reasons.length - 1] }}</div>
              }
            </td>
            <td>
              @if (d.shares > 0 && (d.action === 'BUY' || d.action === 'SELL')) {
                @if (recordingTicker() === d.ticker) {
                  <span style="font-size:12px;color:var(--text-muted)">記錄中…</span>
                } @else {
                  <button class="btn-cancel" style="padding:4px 10px;font-size:13px" (click)="openRecord(d)">記錄成交</button>
                }
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
    </div>
  }

  @if (recordTarget()) {
    <div class="grid-record-panel">
      <div style="font-weight:700;margin-bottom:8px">記錄 {{ recordTarget()!.ticker }} {{ ACTION_LABELS[recordTarget()!.action] }} 成交</div>
      <div class="grid-record-fields">
        <label>股數 <input type="number" [(ngModel)]="recordShares" /></label>
        <label>成交價 <input type="number" step="0.01" [(ngModel)]="recordPrice" /></label>
        <label>日期 <input type="date" [(ngModel)]="recordDate" /></label>
      </div>
      @if (recordError()) { <div style="color:var(--red);font-size:13px;margin:6px 0">{{ recordError() }}</div> }
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" style="flex:none;padding:8px 16px" [disabled]="recordingTicker() !== null" (click)="submitRecord()">確認回填</button>
        <button class="btn-cancel" (click)="recordTarget.set(null)">取消</button>
      </div>
    </div>
  }

} @else {
  <!-- 持股狀態 -->
  <div class="grid-hint">網格標的來自「投資組合」的 ATR 勾選：勾選即以當下現價建立網格，取消勾選會移出清單但保留錨點與階數，重新勾選就接續原本的網格。</div>

  @if (positions.length === 0) {
    <div class="empty-state">
      <div class="empty-icon">🕸️</div>
      <div class="empty-title">尚無網格標的</div>
      <div class="empty-sub">到「投資組合」把想跑網格的持股勾選 ATR 欄位。</div>
    </div>
  } @else {
    <div class="table-scroll-wrap">
    <table class="supply-table">
      <thead>
        <tr>
          <th style="width:70px">代碼</th>
          <th>名稱</th>
          <th style="width:70px">類別</th>
          <th style="width:50px">市場</th>
          <th style="width:90px;text-align:right">持股</th>
          <th style="width:90px;text-align:right">成本</th>
          <th style="width:90px;text-align:right">錨點</th>
          <th style="width:60px;text-align:right">階數</th>
          <th>下一買 / 下一賣</th>
          <th style="width:70px">狀態</th>
          <th style="width:110px"></th>
        </tr>
      </thead>
      <tbody>
        @for (p of positions; track p.code) {
          <tr [class.grid-row-disabled]="!p.enabled">
            <td><span class="risk-code">{{ p.code }}</span></td>
            <td style="font-weight:600">{{ p.name }}</td>
            <td>
              <select class="grid-class-select" style="font-size:12px;padding:3px 4px"
                [ngModel]="p.assetClass" (ngModelChange)="setAssetClass(p, $event)">
                @for (c of ASSET_CLASS_OPTIONS; track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
            </td>
            <td style="font-size:12px;color:var(--text-muted)">{{ p.market === 'us' ? '美股' : '台股' }}</td>
            <td class="risk-num">{{ p.shares.toLocaleString() }}</td>
            <td class="risk-num">{{ p.avgCost.toFixed(2) }}</td>
            <td class="risk-num">
              @if (editingAnchorCode() === p.code) {
                <input type="number" step="0.001" style="width:90px;text-align:right" [(ngModel)]="anchorInputValue" />
              } @else {
                {{ p.anchor.toFixed(3) }}
              }
            </td>
            <td class="risk-num">{{ p.rung > 0 ? '+' + p.rung : p.rung }}</td>
            <td style="font-size:12px">
              @if (p.nextBuy && p.nextSell) {
                <span class="pos">↓ {{ p.nextBuy[0].toFixed(2) }}</span>
                &nbsp;/&nbsp;
                <span class="neg">↑ {{ p.nextSell[0].toFixed(2) }}</span>
              } @else { <span style="color:var(--border)">—</span> }
            </td>
            <td>
              <button class="btn-cancel" style="padding:3px 10px;font-size:12px"
                (click)="toggleEnabled(p)">{{ p.enabled ? '停用' : '啟用' }}</button>
            </td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                @if (editingAnchorCode() === p.code) {
                  <button class="btn-primary" style="padding:3px 10px;font-size:12px" [disabled]="savingAnchor().has(p.code)"
                    (click)="saveAnchor(p)">{{ savingAnchor().has(p.code) ? '儲存中…' : '儲存' }}</button>
                  <button class="btn-cancel" style="padding:3px 10px;font-size:12px" (click)="cancelEditAnchor()">取消</button>
                } @else {
                  <button class="btn-cancel" style="padding:3px 10px;font-size:12px" (click)="startEditAnchor(p)">自訂錨點</button>
                  <button class="btn-cancel" style="padding:3px 10px;font-size:12px" [disabled]="resettingAnchor().has(p.code)"
                    (click)="resetAnchor(p)">{{ resettingAnchor().has(p.code) ? '重設中…' : '重設為現價' }}</button>
                }
              </div>
            </td>
          </tr>
        }
      </tbody>
    </table>
    </div>
  }
}
  `,
  styles: [`
    .grid-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .grid-tab-btn { padding:6px 14px; border-radius:8px; border:1.5px solid var(--border); background:none; font-family:inherit; font-size:13px; cursor:pointer; color:var(--text-muted); margin-left:auto; }
    .grid-tab-btn.active { background:var(--gold); color:white; border-color:var(--gold); }
    .grid-tab-btn + .grid-tab-btn { margin-left:0; }
    .grid-block-text { color:var(--red); }
    .grid-row-disabled { opacity:0.5; }
    .grid-record-panel { margin-top:14px; padding:14px 16px; border:1.5px solid var(--border); border-radius:10px; background:var(--sidebar-bg); max-width:480px; }
    .grid-record-fields { display:flex; gap:12px; flex-wrap:wrap; }
    .grid-record-fields label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--text-muted); }
    .grid-record-fields input { padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:14px; width:120px; }
    .grid-hint { margin-bottom:16px; font-size:12px; color:var(--text-muted); }
    .grid-class-select { padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:13px; background:none; color:inherit; }
  `],
})
export class GridViewComponent implements OnInit {
  ACTION_LABELS = ACTION_LABELS;
  ASSET_CLASS_OPTIONS = ASSET_CLASS_OPTIONS;
  ACTION_CLASS = ACTION_CLASS;

  tab = signal<'advice' | 'positions'>('advice');
  advice_ = signal<GridAdvice | null>(null);
  positions_ = signal<GridPosition[]>([]);
  loadingAdvice = signal(false);
  loadingPositions = signal(false);

  recordTarget = signal<GridDecision | null>(null);
  recordingTicker = signal<string | null>(null);
  recordError = signal('');
  recordShares = 0;
  recordPrice = 0;
  recordDate = new Date().toISOString().slice(0, 10);

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadPositions();
    this.refreshAdvice();
  }

  sortedDecisions(decisions: GridDecision[]): GridDecision[] {
    const rank: Record<string, number> = { BUY: 0, SELL: 0, REVIEW: 1, HOLD: 2, SKIP: 3 };
    return [...decisions].sort((a, b) => (rank[a.action] ?? 9) - (rank[b.action] ?? 9) || a.ticker.localeCompare(b.ticker));
  }

  async refreshAdvice() {
    this.loadingAdvice.set(true);
    try {
      const advice = await this.api.getGridAdvice();
      this.advice_.set(advice);
    } finally {
      this.loadingAdvice.set(false);
    }
  }

  async loadPositions() {
    this.loadingPositions.set(true);
    try {
      this.positions_.set(await this.api.getGridPositions());
    } finally {
      this.loadingPositions.set(false);
    }
  }

  async toggleEnabled(p: GridPosition) {
    await this.api.patchGridPosition(p.code, { enabled: !p.enabled });
    this.loadPositions();
  }

  resettingAnchor = signal<ReadonlySet<string>>(new Set());
  savingAnchor = signal<ReadonlySet<string>>(new Set());
  editingAnchorCode = signal<string | null>(null);
  anchorInputValue = 0;

  /** 手動指定錨點，例如回填成幾天前的實際買入價，或用今天的成交價取代啟用當下抓到的即時報價。 */
  startEditAnchor(p: GridPosition) {
    this.editingAnchorCode.set(p.code);
    this.anchorInputValue = p.anchor;
  }

  cancelEditAnchor() {
    this.editingAnchorCode.set(null);
  }

  async saveAnchor(p: GridPosition) {
    if (this.anchorInputValue <= 0) {
      alert('錨點必須大於 0');
      return;
    }
    if (p.rung !== 0 && !confirm(`${p.code} 目前階數為 ${p.rung}，手動改錨點不會連動調整階數，可能會對不上。確定要繼續嗎？`)) return;
    this.savingAnchor.update(s => new Set(s).add(p.code));
    try {
      await this.api.patchGridPosition(p.code, { anchor: this.anchorInputValue });
      this.editingAnchorCode.set(null);
      await this.loadPositions();
    } catch (e: any) {
      alert(e?.error?.detail ?? e?.message ?? '設定錨點失敗');
    } finally {
      this.savingAnchor.update(s => { const n = new Set(s); n.delete(p.code); return n; });
    }
  }

  /** 錨點放太久沒動（例如軟刪除後隔很久才重新勾選）會讓引擎一次補一堆階數的建議；
   *  重設成現價、階數歸零，等於用現在的價格重新開始網格。 */
  async resetAnchor(p: GridPosition) {
    if (!confirm(`確定要把 ${p.code} 的錨點重設為現價嗎？目前的階數（${p.rung}）會歸零。`)) return;
    this.resettingAnchor.update(s => new Set(s).add(p.code));
    try {
      await this.api.resetGridAnchor(p.code);
      await this.loadPositions();
    } catch (e: any) {
      alert(e?.error?.detail ?? e?.message ?? '重設錨點失敗');
    } finally {
      this.resettingAnchor.update(s => { const n = new Set(s); n.delete(p.code); return n; });
    }
  }

  /** 類別決定網格參數（grid_params），勾選 ATR 時後端只能從代碼／名稱猜，這裡讓使用者更正。 */
  async setAssetClass(p: GridPosition, assetClass: string) {
    if (assetClass === p.assetClass) return;
    await this.api.patchGridPosition(p.code, { assetClass });
    await this.loadPositions();
  }

  openRecord(d: GridDecision) {
    this.recordTarget.set(d);
    this.recordShares = d.shares;
    this.recordPrice = d.price;
    this.recordDate = new Date().toISOString().slice(0, 10);
    this.recordError.set('');
  }

  async submitRecord() {
    const d = this.recordTarget();
    if (!d) return;
    if (this.recordShares <= 0 || this.recordPrice <= 0) {
      this.recordError.set('股數與成交價必須大於 0');
      return;
    }
    this.recordError.set('');
    this.recordingTicker.set(d.ticker);
    try {
      await this.api.recordGridFill({
        code: d.ticker,
        action: d.action as 'BUY' | 'SELL',
        shares: this.recordShares,
        price: this.recordPrice,
        rungs: d.rungs,
        step: d.step,
        date: this.recordDate,
      });
      this.recordTarget.set(null);
      await Promise.all([this.loadPositions(), this.refreshAdvice()]);
    } catch (e: any) {
      this.recordError.set(e.message ?? '記錄失敗');
    } finally {
      this.recordingTicker.set(null);
    }
  }
}
