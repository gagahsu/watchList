import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { DividendRecord } from '../../models/types';
import { calcFIFO, uid } from '../../utils';

@Component({
  selector: 'app-dividend-view',
  template: `
<!-- ── Holdings summary ───────────────────────────── -->
@if (holdingSummary().length > 0) {
  <div class="dv-summary-bar">
    <span class="dv-summary-label">持股年化股利收入</span>
    <span class="dv-summary-value">{{ fmtNT(totalAnnual()) }}</span>
    <span class="dv-summary-sub">（以近 12 個月除息記錄估算）</span>
  </div>

  <table class="index-table" style="margin-bottom:28px">
    <thead><tr>
      <th style="width:80px">代碼</th>
      <th>名稱</th>
      <th style="text-align:right">持股數</th>
      <th style="text-align:right">年股利/股</th>
      <th style="text-align:right">估計年收息</th>
      <th>最近除息日</th>
    </tr></thead>
    <tbody>
      @for (h of holdingSummary(); track h.code) {
        <tr style="cursor:default">
          <td><span class="idx-code">{{ h.code }}</span></td>
          <td><span class="idx-name" style="font-size:14px">{{ h.name }}</span></td>
          <td class="dv-num">{{ h.shares.toLocaleString() }}</td>
          <td class="dv-num" style="color:var(--green,#27ae60)">
            {{ h.annualDiv > 0 ? '$' + h.annualDiv.toFixed(2) : '—' }}
          </td>
          <td class="dv-num" style="color:var(--green,#27ae60);font-weight:700">
            {{ h.annualIncome > 0 ? fmtNT(h.annualIncome) : '—' }}
          </td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)">
            {{ h.lastExDate || '—' }}
          </td>
        </tr>
      }
    </tbody>
  </table>
}

<!-- ── Dividend records ───────────────────────────── -->
<div class="index-filter-bar">
  <div class="index-search-wrap" style="margin-bottom:0;flex:1;max-width:240px">
    <span class="index-search-icon">🔍</span>
    <input class="index-search" style="padding-top:8px;padding-bottom:8px;font-size:14px"
      placeholder="搜尋代碼…"
      [value]="search()" (input)="search.set(asStr($event))" />
  </div>
  <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">{{ filtered().length }} 筆</span>
  <button class="idx-add-btn" style="margin-left:8px;background:rgba(39,174,96,.15);border-color:rgba(39,174,96,.4);color:var(--green,#27ae60)"
    [disabled]="syncing()" (click)="syncHoldings()">
    {{ syncing() ? '同步中…' : '⟳ 同步股息' }}
  </button>
</div>
@if (syncMsg()) {
  <div style="margin-bottom:12px;padding:10px 14px;border-radius:8px;font-size:12px;background:var(--panel-bg);border:1px solid var(--border);white-space:pre-line;color:var(--text-muted)">
    {{ syncMsg() }}
  </div>
}

@if (state.dividends().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:0.4">💵</div>
    <div class="empty-title">尚無股息記錄</div>
    <div class="empty-sub">記錄每次除息資訊，追蹤收息狀況與年化收益</div>
    <button class="empty-btn" (click)="openNew()">＋ 新增記錄</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">股息記錄 · 點擊列查看</span>
    <button class="idx-add-btn" (click)="openNew()">＋ 新增記錄</button>
  </div>
  <table class="index-table">
    <thead><tr>
      <th style="width:100px">除息日</th>
      <th style="width:80px">代碼</th>
      <th>名稱</th>
      <th style="text-align:right">現金股利/股</th>
      <th style="text-align:right">股票股利/股</th>
      <th>備註</th>
    </tr></thead>
    <tbody>
      @for (d of filtered(); track d.id) {
        <tr (click)="openView(d)">
          <td style="font-family:'JetBrains Mono',monospace;font-size:13px">{{ d.exDate }}</td>
          <td><span class="idx-code">{{ d.code }}</span></td>
          <td style="font-size:13px">{{ stockName(d.code) }}</td>
          <td class="dv-num" style="color:var(--green,#27ae60)">
            {{ d.cashDiv > 0 ? '$' + d.cashDiv.toFixed(2) : '—' }}
          </td>
          <td class="dv-num" style="color:var(--gold,#b5851b)">
            {{ d.stockDiv > 0 ? d.stockDiv.toFixed(4) + ' 股' : '—' }}
          </td>
          <td style="font-size:12px;color:var(--text-muted)">{{ d.note || '—' }}</td>
        </tr>
      }
    </tbody>
  </table>
}

<!-- ── Modal ─────────────────────────────────────── -->
@if (openModal()) {
  <div class="modal-overlay" (click)="closeModal()">
    <div class="modal-box" (click)="$event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:17px;font-weight:700">{{ isNew() ? '新增股息記錄' : '股息記錄' }}</div>
        <button class="sidebar-close-btn" (click)="closeModal()">×</button>
      </div>

      @if (isNew()) {
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">股票代碼</div>
            <input class="modal-input" placeholder="如：2330"
              [value]="f.code" (input)="f.code=asStr($event)" />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">除息日</div>
            <input class="modal-input" type="date" [value]="f.exDate"
              (input)="f.exDate=asStr($event)" />
          </div>
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">現金股利/股 (元)</div>
            <input class="modal-input" type="number" min="0" step="0.01" placeholder="如：3.00"
              [value]="f.cashDiv || ''" (input)="f.cashDiv=toNum($event)" />
          </div>
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">股票股利/股 (選填)</div>
            <input class="modal-input" type="number" min="0" step="0.0001" placeholder="如：0.1"
              [value]="f.stockDiv || ''" (input)="f.stockDiv=toNum($event)" />
          </div>
        </div>
        <div class="broker-form-row">
          <div class="broker-form-group" style="flex:1">
            <div class="modal-label">發放日 (選填)</div>
            <input class="modal-input" type="date" [value]="f.payDate"
              (input)="f.payDate=asStr($event)" />
          </div>
          <div class="broker-form-group" style="flex:2">
            <div class="modal-label">備註 (選填)</div>
            <input class="modal-input" placeholder="如：2025Q1"
              [value]="f.note" (input)="f.note=asStr($event)" />
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:18px">
          <button class="btn-primary" style="flex:1" (click)="saveNew()"
            [disabled]="!f.code || (!f.cashDiv && !f.stockDiv)">新增</button>
          <button class="btn-cancel" (click)="closeModal()">取消</button>
        </div>
      } @else {
        @let d = viewTarget()!;
        @let sh = sharesOnDate(d.code);
        <div class="txn-detail-grid">
          <span class="txn-detail-label">代碼</span>
          <span><span class="idx-code">{{ d.code }}</span> {{ stockName(d.code) }}</span>
          <span class="txn-detail-label">除息日</span>
          <span style="font-family:'JetBrains Mono',monospace">{{ d.exDate }}</span>
          @if (d.cashDiv > 0) {
            <span class="txn-detail-label">現金股利</span>
            <span class="dv-green dv-bold">{{ '$' + d.cashDiv.toFixed(2) }}/股</span>
          }
          @if (d.stockDiv > 0) {
            <span class="txn-detail-label">股票股利</span>
            <span class="dv-gold dv-bold">{{ d.stockDiv.toFixed(4) }} 股/股</span>
          }
          @if (d.payDate) {
            <span class="txn-detail-label">發放日</span>
            <span style="font-family:'JetBrains Mono',monospace">{{ d.payDate }}</span>
          }
          @if (sh > 0) {
            <span class="txn-detail-label">持股數</span>
            <span>{{ sh.toLocaleString() }} 股</span>
            @if (d.cashDiv > 0) {
              <span class="txn-detail-label">實收現金</span>
              <span class="dv-green dv-bold">{{ fmtNT(d.cashDiv * sh) }}</span>
            }
          }
          @if (d.note) {
            <span class="txn-detail-label">備註</span>
            <span>{{ d.note }}</span>
          }
        </div>
        <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="sig-action-btn danger" style="width:100%" (click)="deleteDividend(d.id)">
            刪除此記錄
          </button>
        </div>
      }
    </div>
  </div>
}
  `,
  styles: [`
    .dv-summary-bar {
      display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;
      background:var(--panel-bg); border:1.5px solid rgba(39,174,96,.3);
      border-radius:10px; padding:14px 18px; margin-bottom:16px;
    }
    .dv-summary-label { font-size:13px; color:var(--text-muted); font-weight:700; }
    .dv-summary-value { font-size:22px; font-weight:700; color:var(--green,#27ae60); font-family:'JetBrains Mono',monospace; }
    .dv-summary-sub   { font-size:11px; color:var(--text-muted); }
    .dv-num { text-align:right; font-family:'JetBrains Mono',monospace; font-size:13px; white-space:nowrap; }
    .txn-detail-grid { display:grid; grid-template-columns:max-content 1fr; gap:10px 16px; align-items:center; }
    .txn-detail-label { font-size:12px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; }
  `],
})
export class DividendViewComponent {
  search    = signal('');
  openModal = signal<'new' | DividendRecord | null>(null);
  syncing   = signal(false);
  syncMsg   = signal('');
  f = this.blankForm();

  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  blankForm() {
    return { code: '', exDate: new Date().toISOString().slice(0, 10), cashDiv: 0, stockDiv: 0, payDate: '', note: '' };
  }

  asStr(e: Event) { return (e.target as HTMLInputElement).value; }
  toNum(e: Event) { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  fmtNT(n: number) { return `NT$${Math.round(n).toLocaleString()}`; }
  stockName(code: string) { return this.stock.codeToName()[code] ?? ''; }

  isNew()      { return this.openModal() === 'new'; }
  viewTarget() { const m = this.openModal(); return m !== 'new' ? m : null; }
  openNew()    { this.f = this.blankForm(); this.openModal.set('new'); }
  openView(d: DividendRecord) { this.openModal.set(d); }
  closeModal() { this.openModal.set(null); }

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.state.dividends();
    return this.state.dividends().filter(d => d.code.toLowerCase().includes(q) || this.stockName(d.code).toLowerCase().includes(q));
  });

  sharesOnDate(code: string): number {
    const trades = this.state.trades()[code] ?? [];
    const mkt    = this.state.tradeMarkets()[code] ?? 'tw';
    return calcFIFO(trades, mkt).holdingShares;
  }

  holdingSummary = computed(() => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString().slice(0, 10);

    const trades  = this.state.trades();
    const markets = this.state.tradeMarkets();
    const divs    = this.state.dividends();
    const nameMap = this.stock.codeToName();

    return Object.entries(trades)
      .map(([code, ts]) => {
        const mkt    = markets[code] ?? 'tw';
        const shares = calcFIFO(ts, mkt).holdingShares;
        if (shares <= 0) return null;

        const recent = divs.filter(d => d.code === code && d.exDate >= cutoff);
        const annualDiv = recent.reduce((s, d) => s + d.cashDiv, 0);
        const lastExDate = recent[0]?.exDate ?? null;

        return {
          code, name: nameMap[code] ?? '',
          shares, annualDiv, annualIncome: annualDiv * shares, lastExDate,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null && h.annualDiv > 0)
      .sort((a, b) => b.annualIncome - a.annualIncome);
  });

  totalAnnual = computed(() => this.holdingSummary().reduce((s, h) => s + h.annualIncome, 0));

  async syncHoldings() {
    const markets = this.state.tradeMarkets();
    const codes = Object.entries(this.state.trades())
      .filter(([code, ts]) => calcFIFO(ts, markets[code] ?? 'tw').holdingShares > 0)
      .map(([code]) => code);
    this.state.tracked().filter(t => t.status === 'holding').forEach(t => {
      if (!codes.includes(t.code)) codes.push(t.code);
    });
    if (!codes.length) { this.syncMsg.set('沒有持倉股票'); return; }

    this.syncing.set(true);
    this.syncMsg.set(`同步中 (0/${codes.length})…`);
    const lines: string[] = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      this.syncMsg.set(`同步中 (${i + 1}/${codes.length})：${code}…`);
      try {
        const r = await this.api.syncDividends(code);
        if (r.source) {
          lines.push(`✓ ${code}：從 ${r.source} 取得 ${r.fetched} 筆，新增 ${r.saved} 筆`);
        } else {
          lines.push(`✗ ${code}：無資料 (${r.errors.slice(0, 2).join('; ')})`);
        }
      } catch (e: any) {
        lines.push(`✗ ${code}：${e.message}`);
      }
    }
    try {
      const divs = await this.api.loadDividends();
      this.state.dividends.set(divs);
    } catch {}
    this.syncing.set(false);
    this.syncMsg.set(lines.join('\n'));
  }

  async saveNew() {
    if (!this.f.code || (!this.f.cashDiv && !this.f.stockDiv)) return;
    const d: DividendRecord = {
      id: uid(), code: this.f.code.trim().toUpperCase(),
      exDate: this.f.exDate, cashDiv: this.f.cashDiv, stockDiv: this.f.stockDiv,
      payDate: this.f.payDate || null, note: this.f.note.trim(),
    };
    const saved = await this.api.createDividend(d);
    this.state.addDividend(saved);
    this.closeModal();
  }

  async deleteDividend(id: string) {
    await this.api.deleteDividend(id);
    this.state.removeDividend(id);
    this.closeModal();
  }
}
