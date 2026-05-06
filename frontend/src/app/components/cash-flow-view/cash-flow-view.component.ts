import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { StockService } from '../../services/stock.service';
import { calcFIFO } from '../../utils';

@Component({
  selector: 'app-cash-flow-view',
  template: `
<!-- Summary cards -->
<div class="trade-summary trade-summary-3" style="margin-bottom:24px">
  <div class="trade-summary-card">
    <div class="tsc-label">每月預估收入</div>
    <div class="tsc-value pos" style="font-size:20px">
      {{ fmtNT(totalIncome()) }}
    </div>
  </div>
  <div class="trade-summary-card">
    <div class="tsc-label">每月固定支出</div>
    <div class="tsc-value neg" style="font-size:20px">
      {{ fmtNT(totalExpense()) }}
    </div>
  </div>
  <div class="trade-summary-card" [class.pnl-pos]="netFlow() >= 0" [class.pnl-neg]="netFlow() < 0">
    <div class="tsc-label">月淨現金流</div>
    <div class="tsc-value" style="font-size:20px" [class.pos]="netFlow() >= 0" [class.neg]="netFlow() < 0">
      {{ (netFlow() >= 0 ? '+' : '') + fmtNT(netFlow()) }}
    </div>
  </div>
</div>

<div class="cf-grid">

  <!-- ── 收入 ─────────────────────────────────── -->
  <div class="cf-section">
    <div class="cf-section-header">
      <span class="cf-section-title">💰 收入</span>
      <span class="cf-section-total pos">{{ fmtNT(totalIncome()) }}</span>
    </div>

    <!-- 薪水 -->
    <div class="cf-row">
      <span class="cf-row-label">薪水</span>
      <span class="cf-row-note">月薪（手動設定）</span>
      <span class="cf-row-amount pos">
        @if (editingSalary()) {
          <input #salaryInput class="cf-inline-input"
            type="number" min="0" step="1000"
            [value]="state.monthlySalary()"
            (blur)="saveSalary($event)"
            (keydown.enter)="saveSalary($event)"
            (keydown.escape)="editingSalary.set(false)" />
        } @else {
          {{ fmtNT(state.monthlySalary()) }}
          <button class="cf-edit-btn" (click)="editingSalary.set(true)">編輯</button>
        }
      </span>
    </div>

    <!-- 股息月均 -->
    @if (monthlyDivIncome() > 0) {
      <div class="cf-row">
        <span class="cf-row-label">股息月均</span>
        <span class="cf-row-note">近 12 個月除息記錄 ÷ 12</span>
        <span class="cf-row-amount pos">{{ fmtNT(monthlyDivIncome()) }}</span>
      </div>
      @for (h of divHoldings(); track h.code) {
        <div class="cf-row cf-row-sub">
          <span class="cf-row-label"><span class="idx-code" style="font-size:11px">{{ h.code }}</span> {{ h.name }}</span>
          <span class="cf-row-note">年 {{ fmtNT(h.annualIncome) }} ÷ 12</span>
          <span class="cf-row-amount" style="color:var(--text-muted)">{{ fmtNT(h.annualIncome / 12) }}</span>
        </div>
      }
    } @else {
      <div class="cf-row">
        <span class="cf-row-label">股息月均</span>
        <span class="cf-row-note">近 12 個月無除息記錄</span>
        <span class="cf-row-amount" style="color:var(--text-muted)">—</span>
      </div>
    }
  </div>

  <!-- ── 支出 ─────────────────────────────────── -->
  <div class="cf-section">
    <div class="cf-section-header">
      <span class="cf-section-title">📤 支出</span>
      <span class="cf-section-total neg">{{ fmtNT(totalExpense()) }}</span>
    </div>

    <!-- 基金定期定額 -->
    @if (fundRows().length > 0) {
      <div class="cf-row">
        <span class="cf-row-label">基金定期定額</span>
        <span class="cf-row-note">{{ fundRows().length }} 筆基金</span>
        <span class="cf-row-amount neg">{{ fmtNT(totalFundSchedule()) }}</span>
      </div>
      @for (f of fundRows(); track f.id) {
        <div class="cf-row cf-row-sub">
          <span class="cf-row-label">{{ f.name }}</span>
          <span class="cf-row-note">
            @for (s of f.schedules; track s.id; let last = $last) {
              每月 {{ s.dayOfMonth }} 日 {{ s.amount.toLocaleString() }}{{ last ? '' : '、' }}
            }
          </span>
          <span class="cf-row-amount" style="color:var(--text-muted)">{{ fmtNT(f.monthlyTotal) }}</span>
        </div>
      }
    } @else {
      <div class="cf-row">
        <span class="cf-row-label">基金定期定額</span>
        <span class="cf-row-note">尚無設定扣款日</span>
        <span class="cf-row-amount" style="color:var(--text-muted)">—</span>
      </div>
    }

    <!-- 貸款月付 -->
    @if (loanRows().length > 0) {
      <div class="cf-row">
        <span class="cf-row-label">貸款還款</span>
        <span class="cf-row-note">{{ loanRows().length }} 筆貸款</span>
        <span class="cf-row-amount neg">{{ fmtNT(totalLoanPayment()) }}</span>
      </div>
      @for (l of loanRows(); track l.id) {
        <div class="cf-row cf-row-sub">
          <span class="cf-row-label">{{ l.name }}</span>
          <span class="cf-row-note">
            {{ l.monthlyPayment!.toLocaleString() }}/月
            @if (l.paidPeriods != null && l.periods != null) {
              ・已繳 {{ l.paidPeriods }}/{{ l.periods }} 期
            }
          </span>
          <span class="cf-row-amount" style="color:var(--text-muted)">{{ fmtNT(l.monthlyPayment!) }}</span>
        </div>
      }
    } @else {
      <div class="cf-row">
        <span class="cf-row-label">貸款還款</span>
        <span class="cf-row-note">尚無設定月付金額的貸款</span>
        <span class="cf-row-amount" style="color:var(--text-muted)">—</span>
      </div>
    }

    <div class="cf-note">
      <span>※ 信用卡費因金額不固定，不列入計算</span>
    </div>
  </div>

</div>
  `,
  styles: [`
    .cf-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 700px) {
      .cf-grid { grid-template-columns: 1fr; }
    }
    .cf-section {
      background: var(--panel-bg);
      border: 1.5px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .cf-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,.03);
    }
    .cf-section-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
    }
    .cf-section-total {
      font-size: 16px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .cf-row {
      display: grid;
      grid-template-columns: 130px 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 11px 18px;
      border-bottom: 1px solid rgba(255,255,255,.04);
      font-size: 13px;
    }
    .cf-row:last-child { border-bottom: none; }
    .cf-row-sub {
      padding-left: 28px;
      background: rgba(255,255,255,.015);
    }
    .cf-row-label {
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cf-row-note {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cf-row-amount {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      text-align: right;
      white-space: nowrap;
    }
    .cf-inline-input {
      width: 120px;
      background: var(--input-bg, rgba(255,255,255,.08));
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 3px 8px;
      text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .cf-edit-btn {
      margin-left: 8px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-muted);
      font-size: 11px;
      padding: 2px 7px;
      cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .cf-edit-btn:hover { border-color: var(--gold); color: var(--gold); }
    .cf-note {
      padding: 8px 18px 10px;
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid rgba(255,255,255,.04);
    }
    .pos { color: var(--green, #27ae60); }
    .neg { color: var(--red, #e74c3c); }
  `],
})
export class CashFlowViewComponent {
  editingSalary = signal(false);

  constructor(public state: AppStateService, private stock: StockService) {}

  fmtNT(n: number) { return `NT$${Math.round(Math.abs(n)).toLocaleString()}`; }

  divHoldings = computed(() => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff  = oneYearAgo.toISOString().slice(0, 10);
    const trades  = this.state.trades();
    const markets = this.state.tradeMarkets();
    const divs    = this.state.dividends();
    const nameMap = this.stock.codeToName();

    return Object.entries(trades)
      .map(([code, ts]) => {
        const mkt    = markets[code] ?? 'tw';
        const shares = calcFIFO(ts, mkt).holdingShares;
        if (shares <= 0) return null;
        const recent    = divs.filter(d => d.code === code && d.exDate >= cutoff);
        const annualDiv = recent.reduce((s, d) => s + d.cashDiv, 0);
        if (annualDiv <= 0) return null;
        return { code, name: nameMap[code] ?? '', shares, annualDiv, annualIncome: annualDiv * shares };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => b.annualIncome - a.annualIncome);
  });

  monthlyDivIncome = computed(() =>
    this.divHoldings().reduce((s, h) => s + h.annualIncome, 0) / 12
  );

  fundRows = computed(() =>
    this.state.funds()
      .filter(f => f.schedules.length > 0)
      .map(f => ({
        id: f.id,
        name: f.name,
        schedules: f.schedules,
        monthlyTotal: f.schedules.reduce((s, sc) => s + sc.amount, 0),
      }))
  );

  loanRows = computed(() =>
    this.state.liabilities().filter(l => l.monthlyPayment != null && l.monthlyPayment > 0)
  );

  totalFundSchedule = computed(() => this.fundRows().reduce((s, f) => s + f.monthlyTotal, 0));
  totalLoanPayment  = computed(() => this.loanRows().reduce((s, l) => s + (l.monthlyPayment ?? 0), 0));

  totalIncome  = computed(() => this.state.monthlySalary() + this.monthlyDivIncome());
  totalExpense = computed(() => this.totalFundSchedule() + this.totalLoanPayment());
  netFlow      = computed(() => this.totalIncome() - this.totalExpense());

  saveSalary(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v) && v >= 0) this.state.setMonthlySalary(v);
    this.editingSalary.set(false);
  }
}
