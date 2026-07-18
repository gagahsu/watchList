import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { StockService } from '../../services/stock.service';
import { FifoResult, Signal, Trade } from '../../models/types';
import { SIG_DIR_CLASS, SIG_DIR_LABELS, STATUS_CLASS, STATUS_LABELS, calcFIFO, fmtDate } from '../../utils';

interface SigRow {
  code: string;
  name: string;
  trackStatus: string;
  activeCount: number;
  totalCount: number;
  latestSig: Signal | null;
  latestDate: number;
}

interface SigPerf {
  id: string;
  code: string;
  name: string;
  source: string;
  direction: string;
  date: number;
  pnlNTD: number;
  costNTD: number;
  returnPct: number | null;
  hasOpen: boolean;
}

interface SourceScore {
  source: string;
  signalCount: number;
  tradedCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturnPct: number | null;
  payoffRatio: number | null;
  totalPnLNTD: number;
}

@Component({
  selector: 'app-signals-view',
  template: `
<!-- Tabs -->
<div class="note-tabs" style="margin-bottom:16px">
  <button class="note-tab" [class.active]="tab()==='list'" (click)="tab.set('list')">訊號列表</button>
  <button class="note-tab" [class.active]="tab()==='score'" (click)="tab.set('score')">
    成效計分板
    @if (tradedSignalCount() > 0) {
      <span class="badge">{{ tradedSignalCount() }}</span>
    }
  </button>
</div>

@if (tab() === 'list') {
  @if (rows().length === 0 && !showAll()) {
    <div class="sov-empty">
      目前沒有有效訊號
      <br>
      <button class="empty-btn" style="margin-top:12px" (click)="showAll.set(true)">顯示全部個股</button>
    </div>
  } @else if (rows().length === 0) {
    <div class="sov-empty">尚無訊號記錄</div>
  } @else {
    <!-- toolbar -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="font-size:13px;color:var(--text-muted)">{{ rows().length }} 支個股</span>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;margin-left:auto">
        <input type="checkbox" [checked]="showAll()" (change)="showAll.set(!showAll())" />
        顯示無有效訊號
      </label>
    </div>

    <div class="table-scroll-wrap">
    <table class="supply-table sov-table">
      <thead>
        <tr>
          <th style="width:70px">代碼</th>
          <th>名稱</th>
          <th style="width:76px">狀態</th>
          <th style="width:68px;text-align:center">有效</th>
          <th>最新訊號</th>
          <th style="width:72px;text-align:right">日期</th>
        </tr>
      </thead>
      <tbody>
        @for (r of rows(); track r.code) {
          <tr class="sov-row" (click)="open(r.code)">
            <td>
              <span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--gold)">
                {{ r.code }}
              </span>
            </td>
            <td style="font-weight:600">{{ r.name }}</td>
            <td>
              <span class="company-chip {{ statusClass(r.trackStatus) }}"
                style="font-size:11px;padding:2px 7px">
                <span class="chip-dot"></span>{{ statusLabel(r.trackStatus) }}
              </span>
            </td>
            <td style="text-align:center">
              @if (r.activeCount > 0) {
                <span style="background:var(--gold);color:white;border-radius:10px;padding:1px 8px;font-size:12px;font-weight:600">
                  {{ r.activeCount }}
                </span>
              } @else {
                <span style="color:var(--border);font-size:12px">—</span>
              }
            </td>
            <td>
              @if (r.latestSig) {
                <div style="display:flex;align-items:baseline;gap:7px;min-width:0">
                  <span class="sig-dir {{ dirClass(r.latestSig.direction) }}"
                    style="font-size:11px;padding:1px 6px;flex-shrink:0">
                    {{ dirLabel(r.latestSig.direction) }}
                  </span>
                  <span style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {{ r.latestSig.condition }}
                  </span>
                </div>
              } @else {
                <span style="color:var(--border);font-size:12px">—</span>
              }
            </td>
            <td style="text-align:right;font-size:12px;color:var(--text-muted);white-space:nowrap">
              {{ r.latestDate ? fmtDate(r.latestDate) : '—' }}
            </td>
          </tr>
        }
      </tbody>
    </table>
    </div>
  }
}

@if (tab() === 'score') {
  @if (sourceScores().length === 0) {
    <div class="sov-empty">
      尚無可統計的訊號
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.8">
        在個股詳情新增訊號（含來源），並在新增交易時選「訊號參考」，<br>
        系統就會自動統計每個訊號來源的實戰績效。
      </div>
    </div>
  } @else {
    <div class="score-hint">
      損益含已實現與持倉中未實現（NTD），僅計入有連結交易的訊號。勝率門檻：損益 > 0。
    </div>
    <div class="table-scroll-wrap">
    <table class="supply-table">
      <thead>
        <tr>
          <th>訊號來源</th>
          <th style="width:70px;text-align:center">訊號數</th>
          <th style="width:70px;text-align:center">有交易</th>
          <th style="width:80px;text-align:right">勝率</th>
          <th style="width:96px;text-align:right">平均報酬</th>
          <th style="width:80px;text-align:right">盈虧比</th>
          <th style="width:120px;text-align:right">總損益（NTD）</th>
        </tr>
      </thead>
      <tbody>
        @for (s of sourceScores(); track s.source) {
          <tr>
            <td style="font-weight:600">{{ s.source }}</td>
            <td style="text-align:center;font-family:'JetBrains Mono',monospace">{{ s.signalCount }}</td>
            <td style="text-align:center;font-family:'JetBrains Mono',monospace">
              @if (s.tradedCount > 0) { {{ s.tradedCount }} } @else { <span style="color:var(--border)">—</span> }
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              @if (s.winRate != null) {
                <span [class.pos]="s.winRate >= 50" [class.neg]="s.winRate < 50">{{ s.winRate.toFixed(0) }}%</span>
                <span style="font-size:11px;color:var(--text-muted)"> ({{ s.wins }}勝{{ s.losses }}敗)</span>
              } @else { <span style="color:var(--border)">—</span> }
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              @if (s.avgReturnPct != null) {
                <span [class.pos]="s.avgReturnPct >= 0" [class.neg]="s.avgReturnPct < 0">
                  {{ s.avgReturnPct >= 0 ? '+' : '' }}{{ s.avgReturnPct.toFixed(2) }}%
                </span>
              } @else { <span style="color:var(--border)">—</span> }
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              {{ s.payoffRatio != null ? s.payoffRatio.toFixed(2) : '—' }}
            </td>
            <td style="text-align:right;font-family:'JetBrains Mono',monospace">
              @if (s.tradedCount > 0) {
                <span [class.pos]="s.totalPnLNTD >= 0" [class.neg]="s.totalPnLNTD < 0">
                  {{ s.totalPnLNTD >= 0 ? '+' : '-' }}{{ Math.round(Math.abs(s.totalPnLNTD)).toLocaleString() }}
                </span>
              } @else { <span style="color:var(--border)">—</span> }
            </td>
          </tr>
        }
      </tbody>
    </table>
    </div>

    @if (sigPerfs().length > 0) {
      <div class="score-section-title">個別訊號成效</div>
      <div class="table-scroll-wrap">
      <table class="supply-table">
        <thead>
          <tr>
            <th style="width:70px">代碼</th>
            <th>名稱</th>
            <th style="width:110px">來源</th>
            <th style="width:60px">方向</th>
            <th style="width:80px;text-align:right">日期</th>
            <th style="width:96px;text-align:right">報酬率</th>
            <th style="width:120px;text-align:right">損益（NTD）</th>
          </tr>
        </thead>
        <tbody>
          @for (p of sigPerfs(); track p.id) {
            <tr class="sov-row" (click)="open(p.code)">
              <td><span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--gold)">{{ p.code }}</span></td>
              <td style="font-weight:600">{{ p.name }}</td>
              <td style="font-size:13px">{{ p.source || '未標來源' }}</td>
              <td>
                <span class="sig-dir {{ dirClass(p.direction) }}" style="font-size:11px;padding:1px 6px">
                  {{ dirLabel(p.direction) }}
                </span>
              </td>
              <td style="text-align:right;font-size:12px;color:var(--text-muted)">{{ fmtDate(p.date) }}</td>
              <td style="text-align:right;font-family:'JetBrains Mono',monospace">
                @if (p.returnPct != null) {
                  <span [class.pos]="p.returnPct >= 0" [class.neg]="p.returnPct < 0">
                    {{ p.returnPct >= 0 ? '+' : '' }}{{ p.returnPct.toFixed(2) }}%
                  </span>
                } @else { <span style="color:var(--border)">—</span> }
              </td>
              <td style="text-align:right;font-family:'JetBrains Mono',monospace">
                <span [class.pos]="p.pnlNTD >= 0" [class.neg]="p.pnlNTD < 0">
                  {{ p.pnlNTD >= 0 ? '+' : '-' }}{{ Math.round(Math.abs(p.pnlNTD)).toLocaleString() }}
                </span>
                @if (p.hasOpen) { <span class="score-open-tag">持倉中</span> }
              </td>
            </tr>
          }
        </tbody>
      </table>
      </div>
    }
  }
}
  `,
  styles: [`
    .score-hint { font-size:12px; color:var(--text-muted); margin-bottom:12px; }
    .score-section-title { font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em; margin:24px 0 10px; }
    .score-open-tag { font-size:10px; color:var(--gold); border:1px solid var(--gold); border-radius:8px; padding:0 5px; margin-left:5px; vertical-align:1px; }
    .pos { color:var(--green,#27ae60); }
    .neg { color:var(--red,#e74c3c); }
  `],
})
export class SignalsViewComponent {
  showAll = signal(false);
  tab = signal<'list' | 'score'>('list');
  fmtDate = fmtDate;
  Math = Math;

  constructor(public state: AppStateService, private stock: StockService) {}

  stockMap = computed(() => {
    const m: Record<string, { name: string; status: string }> = {};
    this.state.notes().forEach(n => n.rows.forEach(r => r.entries.forEach(e => {
      if (!m[e.code]) m[e.code] = { name: e.name, status: e.status };
    })));
    return m;
  });

  rows = computed<SigRow[]>(() => {
    const result: SigRow[] = [];
    for (const [code, sigs] of Object.entries(this.state.signals())) {
      if (!sigs.length) continue;
      const activeCount = sigs.filter(s => s.status === 'active').length;
      if (!this.showAll() && activeCount === 0) continue;

      const sorted = [...sigs].sort((a, b) => b.date - a.date);
      const latestSig = sorted[0] ?? null;
      const stockInfo = this.stockMap()[code];
      const tracked = this.state.tracked().find(t => t.code === code);

      result.push({
        code,
        name: stockInfo?.name ?? this.stock.codeToName()[code] ?? code,
        trackStatus: stockInfo?.status ?? tracked?.status ?? 'tracking',
        activeCount,
        totalCount: sigs.length,
        latestSig,
        latestDate: latestSig?.date ?? 0,
      });
    }
    return result.sort((a, b) => b.latestDate - a.latestDate);
  });

  /** 每筆有連結交易的訊號成效（損益一律換算 NTD） */
  sigPerfs = computed<SigPerf[]>(() => {
    const fx = this.state.usdTwdRate();
    const markets = this.state.tradeMarkets();
    const closeMap = this.stock.closeMap();
    const nameMap = this.stock.codeToName();

    const fifoByCode: Record<string, FifoResult> = {};
    const tradesBySig = new Map<string, { code: string; trade: Trade }[]>();
    for (const [code, trades] of Object.entries(this.state.trades())) {
      fifoByCode[code] = calcFIFO(trades, markets[code] ?? 'tw');
      for (const t of trades) {
        if (!t.sigRef) continue;
        const list = tradesBySig.get(t.sigRef) ?? [];
        list.push({ code, trade: t });
        tradesBySig.set(t.sigRef, list);
      }
    }

    const perfs: SigPerf[] = [];
    for (const [code, sigs] of Object.entries(this.state.signals())) {
      for (const sig of sigs) {
        const linked = tradesBySig.get(sig.id);
        if (!linked?.length) continue;

        // 依股票分組連結的交易 id，透過 FIFO 買賣配對歸因，
        // 買賣兩端連到同一訊號時損益只計一次
        const linkedByCode = new Map<string, Set<string>>();
        for (const { code: c, trade: t } of linked) {
          const set = linkedByCode.get(c) ?? new Set<string>();
          set.add(t.id);
          linkedByCode.set(c, set);
        }

        let pnl = 0, cost = 0, hasOpen = false;
        for (const [c, ids] of linkedByCode.entries()) {
          const fifo = fifoByCode[c];
          if (!fifo) continue;
          const toNTD = (markets[c] ?? 'tw') === 'us' ? fx : 1;
          for (const a of fifo.allocations) {
            if (ids.has(a.buyId) || ids.has(a.sellId)) {
              pnl += a.pnl * toNTD;
              cost += a.cost * toNTD;
            }
          }
          // 連結買單中仍持有的部位:計入未實現損益
          for (const lot of fifo.openLots) {
            if (!ids.has(lot.id) || lot.shares <= 0) continue;
            hasOpen = true;
            cost += lot.shares * lot.unitCost * toNTD;
            const price = closeMap[c]?.close;
            if (price != null) pnl += (price - lot.unitCost) * lot.shares * toNTD;
          }
        }

        perfs.push({
          id: sig.id, code,
          name: nameMap[code] || code,
          source: sig.source,
          direction: sig.direction,
          date: sig.date,
          pnlNTD: pnl,
          costNTD: cost,
          returnPct: cost > 0 ? (pnl / cost) * 100 : null,
          hasOpen,
        });
      }
    }
    return perfs.sort((a, b) => b.date - a.date);
  });

  tradedSignalCount = computed(() => this.sigPerfs().length);

  sourceScores = computed<SourceScore[]>(() => {
    const bySource = new Map<string, SigPerf[]>();
    for (const [, sigs] of Object.entries(this.state.signals())) {
      for (const sig of sigs) {
        const key = sig.source || '未標來源';
        if (!bySource.has(key)) bySource.set(key, []);
      }
    }
    const perfBySource = new Map<string, SigPerf[]>();
    for (const p of this.sigPerfs()) {
      const key = p.source || '未標來源';
      const list = perfBySource.get(key) ?? [];
      list.push(p);
      perfBySource.set(key, list);
    }
    // 訊號總數（含未交易）
    const countBySource = new Map<string, number>();
    for (const [, sigs] of Object.entries(this.state.signals())) {
      for (const sig of sigs) {
        const key = sig.source || '未標來源';
        countBySource.set(key, (countBySource.get(key) ?? 0) + 1);
      }
    }

    const scores: SourceScore[] = [];
    for (const [source, signalCount] of countBySource.entries()) {
      const perfs = perfBySource.get(source) ?? [];
      const wins = perfs.filter(p => p.pnlNTD > 0);
      const losses = perfs.filter(p => p.pnlNTD < 0);
      const returns = perfs.filter(p => p.returnPct != null).map(p => p.returnPct!);
      const avgWin = wins.length ? wins.reduce((s, p) => s + p.pnlNTD, 0) / wins.length : 0;
      const avgLoss = losses.length ? Math.abs(losses.reduce((s, p) => s + p.pnlNTD, 0) / losses.length) : 0;
      scores.push({
        source,
        signalCount,
        tradedCount: perfs.length,
        wins: wins.length,
        losses: losses.length,
        winRate: perfs.length > 0 ? (wins.length / perfs.length) * 100 : null,
        avgReturnPct: returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : null,
        payoffRatio: avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : null,
        totalPnLNTD: perfs.reduce((s, p) => s + p.pnlNTD, 0),
      });
    }
    return scores.sort((a, b) => {
      if (b.tradedCount === 0 && a.tradedCount === 0) return b.signalCount - a.signalCount;
      if (a.tradedCount === 0) return 1;
      if (b.tradedCount === 0) return -1;
      return (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity);
    });
  });

  open(code: string) {
    this.state.editTarget.set({ kind: 'tracked', code, tab: 'signals' });
  }

  dirLabel(d: string) { return SIG_DIR_LABELS[d]; }
  dirClass(d: string) { return SIG_DIR_CLASS[d]; }
  statusClass(s: string) { return STATUS_CLASS[s]; }
  statusLabel(s: string) { return STATUS_LABELS[s]; }
}
