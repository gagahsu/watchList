import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { GridAdvice, GridDecision, GridParams, GridPosition } from '../../models/types';

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

/** 「單邊防護」分頁的表單模型。ngModel 綁的是百分比／天數這類人看得懂的單位，
 *  送回後端前才換算成 GridParams 的欄位。 */
interface GuardRow {
  assetClass: string;
  trendFilterMode: 'off' | 'pause' | 'widen';
  trendMaPeriod: number;
  rsiOverbought: number;
  trendStepMultiple: number;
  basePositionPct: number;
  rangeResetDays: number;
  rungPctOfBaseline: number;
}

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
  <button class="btn-cancel" style="padding:6px 12px;font-size:13px" (click)="openManualPicker()">手動回填成交</button>
  <button class="grid-tab-btn" [class.active]="tab() === 'advice'" (click)="tab.set('advice')">今日建議</button>
  <button class="grid-tab-btn" [class.active]="tab() === 'positions'" (click)="tab.set('positions')">持股狀態</button>
  <button class="grid-tab-btn" [class.active]="tab() === 'guards'" (click)="tab.set('guards')">單邊防護</button>
</div>

@if (loadingAdvice() && !advice) {
  <div class="empty-state">
    <div class="empty-icon">⏳</div>
    <div class="empty-title">正在計算今日建議…</div>
    <div class="empty-sub">要抓報價與日 K，可能需要幾秒鐘。</div>
  </div>
} @else if (tab() === 'advice') {

  @if (advice) {
    @if (advice.summary.warnings.length > 0) {
      <div class="import-error">
        @for (w of advice.summary.warnings; track w) {
          <div>⚠️ {{ w }}</div>
        }
      </div>
    }
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

} @else if (tab() === 'positions') {
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
} @else {
  <!-- 單邊防護：趨勢濾網 / 底倉 / 區間上移 -->
  <div class="grid-hint">
    純網格是「越跌越買、越漲越賣」的左側交易，在盤整區間最有效率，遇到單邊走勢卻會兩頭挨打：
    一路漲會把籌碼賣光（賣飛）、一路跌會把子彈打光（接刀）。這三道閘門預設全部關閉，
    打開之後只在極端行情介入，平時網格照常運作。參數依資產類別套用，個別標的可再用覆寫調整。
  </div>

  @if (paramsError()) { <div style="color:var(--red);font-size:13px;margin-bottom:12px">{{ paramsError() }}</div> }

  @if (guardRows().length === 0) {
    <div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">載入參數中…</div></div>
  } @else {
    @for (g of guardRows(); track g.assetClass) {
      <div class="grid-guard-card">
        <div class="grid-guard-title">{{ assetClassLabel(g.assetClass) }}</div>

        <div class="grid-guard-grid">
          <div>
            <div class="modal-label">趨勢濾網</div>
            <select class="grid-class-select" style="width:100%" [(ngModel)]="g.trendFilterMode">
              <option value="off">關閉（純網格）</option>
              <option value="pause">暫停逆勢單（多頭不賣／空頭不買）</option>
              <option value="widen">放大逆勢步長（讓格子變稀）</option>
            </select>
            <div class="grid-guard-help">
              多頭＝現價站上 MA{{ g.trendMaPeriod }} 且 RSI 超買；空頭＝現價跌破 MA{{ g.trendMaPeriod }} 且 MACD DIF &lt; 0。
            </div>
          </div>

          <div>
            <div class="modal-label">MA 天數</div>
            <input class="modal-input" type="number" min="2" step="1" [(ngModel)]="g.trendMaPeriod" />
          </div>

          <div>
            <div class="modal-label">RSI 超買門檻</div>
            <input class="modal-input" type="number" min="1" max="100" step="1" [(ngModel)]="g.rsiOverbought" />
          </div>

          <div>
            <div class="modal-label">逆勢步長倍數</div>
            <input class="modal-input" type="number" min="1" step="0.1"
              [disabled]="g.trendFilterMode !== 'widen'" [(ngModel)]="g.trendStepMultiple" />
            <div class="grid-guard-help">只在「放大逆勢步長」模式下生效。</div>
          </div>

          <div>
            <div class="modal-label">底倉比例（%）</div>
            <input class="modal-input" type="number" min="0" max="99" step="1" [(ngModel)]="g.basePositionPct" />
            <div class="grid-guard-help">建檔股數的這個比例永遠不參與網格賣出，賣飛時仍留有部位吃趨勢。0 = 不留底倉。</div>
          </div>

          <div>
            <div class="modal-label">區間上移天數</div>
            <input class="modal-input" type="number" min="0" step="1" [(ngModel)]="g.rangeResetDays" />
            <div class="grid-guard-help">連續幾天站上網格上緣就把錨點移到現價、階數歸零，在新中樞重開一組網格。0 = 關閉。</div>
          </div>
        </div>

        <div class="grid-guard-title" style="margin-top:16px;font-size:13px">網格結構（跟上面三道單邊防護無關）</div>
        <div class="grid-guard-grid">
          <div>
            <div class="modal-label">單階佔建檔股數（%）</div>
            <input class="modal-input" type="number" min="0" max="99" step="1" [(ngModel)]="g.rungPctOfBaseline" />
            <div class="grid-guard-help">
              每階股數改成建檔股數（baseline_shares）× 這個比例，以手續費最低收費的股數為下限。
              0 = 關閉，每階固定是手續費最低收費的股數（跟這個參數加入前的行為一樣）。
            </div>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <button class="btn-primary" style="padding:5px 16px;font-size:13px"
            [disabled]="savingParams().has(g.assetClass)" (click)="saveGuards(g)">
            {{ savingParams().has(g.assetClass) ? '儲存中…' : '儲存' }}
          </button>
          @if (savedParams().has(g.assetClass)) { <span style="font-size:12px;color:var(--green)">已儲存</span> }
        </div>
      </div>
    }
  }
}

@if (manualPickOpen()) {
  <div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeManualPickerIfBg($event)">
    <div class="modal-box" style="max-width:420px;width:92vw">
      <div class="modal-title">手動回填成交</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
        用實際成交的價格試算網格會給的份數/階數 —— 用在建議已經過期（例如上週六建議、這幾天才成交）而今日建議已經不再顯示的情況。
      </div>
      <div class="modal-label">代碼</div>
      <select class="modal-input" [(ngModel)]="manualCode">
        @for (p of positions_(); track p.code) {
          <option [value]="p.code">{{ p.code }} {{ p.name }}</option>
        }
      </select>
      <div class="modal-label" style="margin-top:12px">方向</div>
      <select class="modal-input" [(ngModel)]="manualAction">
        <option value="BUY">買進</option>
        <option value="SELL">賣出</option>
      </select>
      <div class="modal-label" style="margin-top:12px">實際成交價</div>
      <input class="modal-input" type="number" step="0.01" [(ngModel)]="manualPrice" />
      @if (manualError()) { <div style="color:var(--red);font-size:13px;margin-top:8px">{{ manualError() }}</div> }
      <div class="modal-actions">
        <button class="btn-primary" style="flex:1" [disabled]="manualLoading()" (click)="submitManualPreview()">
          {{ manualLoading() ? '試算中…' : '試算' }}
        </button>
        <button class="btn-cancel" (click)="manualPickOpen.set(false)">取消</button>
      </div>
    </div>
  </div>
}

@if (recordTarget(); as rt) {
  <div class="modal-overlay" (mousedown)="trackMd($event)" (mouseup)="closeRecordIfBg($event)">
    <div class="modal-box" style="max-width:520px;width:92vw">
      <div class="modal-title">記錄 {{ rt.ticker }} {{ ACTION_LABELS[rt.action] }} 成交</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
        建議 {{ rt.rungs }} 階 × {{ rt.lotShares }} 股 @ {{ rt.price.toFixed(2) }}。可分成多筆、各自填不同成交價再送出。
      </div>

      <div class="modal-label">日期</div>
      <input class="modal-input" type="date" [(ngModel)]="recordDate" />

      <div class="modal-label" style="margin-top:12px">成交明細</div>
      @for (row of recordRows; track $index) {
        <div class="grid-record-row">
          <input type="number" step="1" [(ngModel)]="row.shares" placeholder="股數" />
          <span style="color:var(--text-muted);font-size:13px">股 @</span>
          <input type="number" step="0.01" [(ngModel)]="row.price" placeholder="成交價" />
          @if (recordRows.length > 1) {
            <button class="grid-record-row-del" (click)="removeRow($index)">✕</button>
          }
        </div>
      }
      <button class="sig-open-add" style="margin-top:8px" (click)="addRow()">＋ 新增一筆（不同成交價）</button>

      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">
        目前合計 {{ totalRowShares().toLocaleString() }} 股（建議 {{ rt.shares.toLocaleString() }} 股）
      </div>

      @if (recordError()) { <div style="color:var(--red);font-size:13px;margin-top:8px">{{ recordError() }}</div> }
      <div class="modal-actions">
        <button class="btn-primary" style="flex:1" [disabled]="recordingTicker() !== null" (click)="submitRecord()">
          {{ recordingTicker() ? '記錄中…' : '確認回填' }}
        </button>
        <button class="btn-cancel" (click)="recordTarget.set(null)">取消</button>
      </div>
    </div>
  </div>
}
  `,
  styles: [`
    .grid-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .grid-tab-btn { padding:6px 14px; border-radius:8px; border:1.5px solid var(--border); background:none; font-family:inherit; font-size:13px; cursor:pointer; color:var(--text-muted); margin-left:auto; }
    .grid-tab-btn.active { background:var(--gold); color:white; border-color:var(--gold); }
    .grid-tab-btn + .grid-tab-btn { margin-left:0; }
    .grid-block-text { color:var(--red); }
    .grid-row-disabled { opacity:0.5; }
    .grid-record-row { display:flex; align-items:center; gap:6px; margin-top:6px; }
    .grid-record-row input { padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:14px; width:110px; }
    .grid-record-row-del { border:none; background:none; color:var(--text-muted); cursor:pointer; font-size:14px; padding:2px 6px; }
    .grid-record-row-del:hover { color:var(--red); }
    .grid-hint { margin-bottom:16px; font-size:12px; color:var(--text-muted); }
    .grid-class-select { padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:13px; background:none; color:inherit; }
    .grid-guard-card { border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:14px; }
    .grid-guard-title { font-weight:700; font-size:14px; margin-bottom:10px; }
    .grid-guard-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px 16px; }
    .grid-guard-help { font-size:11px; color:var(--text-muted); margin-top:4px; line-height:1.5; }
  `],
})
export class GridViewComponent implements OnInit {
  ACTION_LABELS = ACTION_LABELS;
  ASSET_CLASS_OPTIONS = ASSET_CLASS_OPTIONS;
  ACTION_CLASS = ACTION_CLASS;

  tab = signal<'advice' | 'positions' | 'guards'>('advice');
  advice_ = signal<GridAdvice | null>(null);
  positions_ = signal<GridPosition[]>([]);
  loadingAdvice = signal(false);
  loadingPositions = signal(false);

  recordTarget = signal<GridDecision | null>(null);
  recordRows: { shares: number; price: number }[] = [];
  recordingTicker = signal<string | null>(null);
  recordError = signal('');
  recordDate = new Date().toISOString().slice(0, 10);

  gridParams = signal<Record<string, GridParams>>({});
  guardRows = signal<GuardRow[]>([]);
  savingParams = signal<Set<string>>(new Set());
  savedParams = signal<Set<string>>(new Set());
  paramsError = signal('');

  manualPickOpen = signal(false);
  manualCode = '';
  manualAction: 'BUY' | 'SELL' = 'BUY';
  manualPrice = 0;
  manualLoading = signal(false);
  manualError = signal('');

  private overlayMd = false;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadPositions();
    this.refreshAdvice();
    this.loadParams();
  }

  assetClassLabel(assetClass: string): string {
    return ASSET_CLASS_OPTIONS.find(o => o.value === assetClass)?.label ?? assetClass;
  }

  async loadParams() {
    try {
      const params = await this.api.getGridParams();
      this.gridParams.set(params);
      this.guardRows.set(
        Object.keys(params).sort().map(assetClass => ({
          assetClass,
          trendFilterMode: params[assetClass].trend_filter_mode ?? 'off',
          trendMaPeriod: params[assetClass].trend_ma_period ?? 20,
          rsiOverbought: params[assetClass].rsi_overbought ?? 70,
          trendStepMultiple: params[assetClass].trend_step_multiple ?? 2,
          // 後端存的是 0~1 的比例，畫面上用百分比比較直覺
          basePositionPct: Math.round((params[assetClass].base_position_pct ?? 0) * 100),
          rangeResetDays: params[assetClass].range_reset_days ?? 0,
          rungPctOfBaseline: Math.round((params[assetClass].rung_pct_of_baseline ?? 0) * 100),
        })),
      );
      this.paramsError.set('');
    } catch {
      this.paramsError.set('讀取網格參數失敗');
    }
  }

  async saveGuards(row: GuardRow) {
    const existing = this.gridParams()[row.assetClass];
    if (!existing) return;
    this.savingParams.update(s => new Set(s).add(row.assetClass));
    this.savedParams.update(s => { const n = new Set(s); n.delete(row.assetClass); return n; });
    // 後端的 PUT 要完整的參數字典，所以是覆蓋既有值而非只送這幾欄。
    const params: GridParams = {
      ...existing,
      trend_filter_mode: row.trendFilterMode,
      trend_ma_period: Number(row.trendMaPeriod),
      rsi_overbought: Number(row.rsiOverbought),
      trend_step_multiple: Number(row.trendStepMultiple),
      base_position_pct: Number(row.basePositionPct) / 100,
      range_reset_days: Number(row.rangeResetDays),
      rung_pct_of_baseline: Number(row.rungPctOfBaseline) / 100,
    };
    try {
      await this.api.putGridParams(row.assetClass, params);
      this.gridParams.update(p => ({ ...p, [row.assetClass]: params }));
      this.savedParams.update(s => new Set(s).add(row.assetClass));
      this.paramsError.set('');
      await this.refreshAdvice();
    } catch (e: unknown) {
      const detail = (e as { error?: { detail?: string } })?.error?.detail;
      this.paramsError.set(detail ?? '儲存失敗');
    } finally {
      this.savingParams.update(s => { const n = new Set(s); n.delete(row.assetClass); return n; });
    }
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
    this.recordRows = [{ shares: d.shares, price: d.price }];
    this.recordDate = new Date().toISOString().slice(0, 10);
    this.recordError.set('');
  }

  totalRowShares(): number {
    return this.recordRows.reduce((sum, r) => sum + (r.shares || 0), 0);
  }

  addRow() {
    const d = this.recordTarget();
    if (!d) return;
    const lot = d.lotShares || d.shares || 1;
    const remaining = Math.max(0, d.shares - this.totalRowShares());
    this.recordRows = [...this.recordRows, { shares: remaining > 0 ? Math.min(lot, remaining) : lot, price: d.price }];
  }

  removeRow(i: number) {
    this.recordRows = this.recordRows.filter((_, idx) => idx !== i);
  }

  async submitRecord() {
    const d = this.recordTarget();
    if (!d) return;
    const rows = this.recordRows.filter(r => r.shares > 0 && r.price > 0);
    if (rows.length === 0) {
      this.recordError.set('至少要有一筆股數與成交價都大於 0 的紀錄');
      return;
    }
    this.recordError.set('');
    this.recordingTicker.set(d.ticker);
    try {
      const lot = d.lotShares || d.shares;
      for (const row of rows) {
        const rungs = Math.max(1, Math.round(row.shares / lot));
        await this.api.recordGridFill({
          code: d.ticker,
          action: d.action as 'BUY' | 'SELL',
          shares: row.shares,
          price: row.price,
          rungs,
          step: d.step,
          date: this.recordDate,
        });
      }
      this.recordTarget.set(null);
      this.recordRows = [];
      await Promise.all([this.loadPositions(), this.refreshAdvice()]);
    } catch (e: any) {
      this.recordError.set(e?.error?.detail ?? e?.message ?? '記錄失敗');
    } finally {
      this.recordingTicker.set(null);
    }
  }

  openManualPicker() {
    const codes = this.positions_();
    this.manualCode = codes[0]?.code ?? '';
    this.manualAction = 'BUY';
    this.manualPrice = 0;
    this.manualError.set('');
    this.manualPickOpen.set(true);
  }

  async submitManualPreview() {
    if (!this.manualCode || this.manualPrice <= 0) {
      this.manualError.set('請選代碼並輸入大於 0 的成交價');
      return;
    }
    this.manualError.set('');
    this.manualLoading.set(true);
    try {
      const d = await this.api.previewGridFill(this.manualCode, this.manualPrice);
      if (d.shares <= 0 || (d.action !== 'BUY' && d.action !== 'SELL') || d.action !== this.manualAction) {
        const msgs = [...d.blocks, ...d.notes];
        this.manualError.set(
          msgs.length
            ? msgs.join('；')
            : `這個價格在 ${d.ticker} 目前的網格下不會觸發${this.manualAction === 'BUY' ? '買進' : '賣出'}（目前判定為${ACTION_LABELS[d.action] ?? d.action}）`
        );
        return;
      }
      this.manualPickOpen.set(false);
      this.openRecord(d);
    } catch (e: any) {
      this.manualError.set(e?.error?.detail ?? e?.message ?? '試算失敗');
    } finally {
      this.manualLoading.set(false);
    }
  }

  trackMd(e: MouseEvent) { this.overlayMd = e.target === e.currentTarget; }

  closeManualPickerIfBg(e: MouseEvent) {
    if (this.overlayMd && e.target === e.currentTarget) this.manualPickOpen.set(false);
    this.overlayMd = false;
  }

  closeRecordIfBg(e: MouseEvent) {
    if (this.overlayMd && e.target === e.currentTarget) this.recordTarget.set(null);
    this.overlayMd = false;
  }
}
