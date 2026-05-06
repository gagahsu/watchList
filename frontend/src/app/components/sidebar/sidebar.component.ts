import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { uid } from '../../utils';
import { Note } from '../../models/types';
import { pendingSettlements } from '../../utils';

@Component({
  selector: 'app-sidebar',
  template: `
<div id="sidebar" [class.open]="state.sidebarOpen()">
  <div class="sidebar-header">
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">📋</div>
      <div>
        <div>理債富</div>
        <div class="sidebar-brand-sub">財務暨投資管理平台</div>
      </div>
    </div>
    <button class="sidebar-close-btn" (click)="state.sidebarOpen.set(false)" aria-label="關閉側邊欄">×</button>
  </div>

  <div class="sidebar-nav">
    <!-- 財務 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">財務</span>
      <button class="sidebar-nav-item" [class.active]="isActive('balance-sheet')" (click)="navigate('balance-sheet')">
        <span class="nav-icon">⚖️</span> 資產負債
        @if (liabilityReminderCount() > 0) {
          <span class="sidebar-nav-badge" style="background:rgba(192,57,43,.8)">🔔 {{ liabilityReminderCount() }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('liabilities')" (click)="navigate('liabilities')">
        <span class="nav-icon">📋</span> 負債管理
        @if (state.liabilities().length > 0) {
          <span class="sidebar-nav-badge" [style.background]="liabilityReminderCount() > 0 ? 'rgba(192,57,43,.8)' : ''">{{ state.liabilities().length }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('cash-flow')" (click)="navigate('cash-flow')">
        <span class="nav-icon">📊</span> 每月現金流
        @if (creditCardReminderCount() > 0) {
          <span class="sidebar-nav-badge" style="background:rgba(192,57,43,.8)">💳 {{ creditCardReminderCount() }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('calendar')" (click)="navigate('calendar')">
        <span class="nav-icon">📅</span> 財務行事曆
        @if (calendarEventCount() > 0) {
          <span class="sidebar-nav-badge" style="background:rgba(212,160,23,.8)">{{ calendarEventCount() }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('transactions')" (click)="navigate('transactions')">
        <span class="nav-icon">📒</span> 資金流水帳
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('accounts')" (click)="navigate('accounts')">
        <span class="nav-icon">💰</span> 帳戶管理
        @if (accountWarningCount() > 0) {
          <span class="sidebar-nav-badge" style="background:rgba(192,57,43,.8)">⚠️ {{ accountWarningCount() }}</span>
        } @else if (state.accounts().length > 0) {
          <span class="sidebar-nav-badge">{{ state.accounts().length }}</span>
        }
      </button>
    </div>

    <div class="sidebar-divider"></div>

    <!-- 持倉 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">持倉</span>
      <button class="sidebar-nav-item" [class.active]="isActive('portfolio')" (click)="navigate('portfolio')">
        <span class="nav-icon">💼</span> 投資組合
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('dividends')" (click)="navigate('dividends')">
        <span class="nav-icon">💵</span> 股息追蹤
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('funds')" (click)="navigate('funds')">
        <span class="nav-icon">🏦</span> 基金持倉
        @if (state.funds().length > 0) {
          <span class="sidebar-nav-badge">{{ state.funds().length }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('watch')" (click)="navigate('watch')">
        <span class="nav-icon">🔒</span> 鎖定觀察
        @if (watchCount() > 0) {
          <span class="sidebar-nav-badge">{{ watchCount() }}</span>
        }
      </button>
    </div>

    <div class="sidebar-divider"></div>

    <!-- 研究 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">研究</span>
      <button class="sidebar-nav-item" [class.active]="isActive('index')" (click)="navigate('index')">
        <span class="nav-icon">🔍</span> 個股索引
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('signals')" (click)="navigate('signals')">
        <span class="nav-icon">📡</span> 訊號總覽
        @if (state.activeSignalCount() > 0) {
          <span class="sidebar-nav-badge">{{ state.activeSignalCount() }}</span>
        }
      </button>
    </div>

    <div class="sidebar-divider"></div>

    <!-- 筆記 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">筆記</span>
      <button class="sidebar-nav-item" (click)="addNote()">
        <span class="nav-icon">＋</span> 新增筆記
      </button>
      <button class="sidebar-nav-item" (click)="openImport()">
        <span class="nav-icon">📥</span> 匯入 CSV
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('notes-list') || isActive('notes')"
        (click)="navigate('notes-list')">
        <span class="nav-icon">📚</span> 筆記列表
        @if (state.notes().length > 0) {
          <span class="sidebar-nav-badge">{{ state.notes().length }}</span>
        }
      </button>
    </div>

    <div class="sidebar-divider"></div>

    <!-- 設定 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">設定</span>
      <button class="sidebar-nav-item" [disabled]="state.syncing()" (click)="syncStocks()">
        <span class="nav-icon">🔄</span>
        {{ state.syncing() ? '同步中…' : '同步股票資料' }}
      </button>
      <button class="sidebar-nav-item" (click)="openBrokers()">
        <span class="nav-icon">🏦</span> 管理券商
        @if (state.brokers().length > 0) {
          <span class="sidebar-nav-badge">{{ state.brokers().length }}</span>
        }
      </button>
      <button class="sidebar-nav-item" (click)="openCreditCards()">
        <span class="nav-icon">💳</span> 信用卡扣款日
        @if (state.creditCards().length > 0) {
          <span class="sidebar-nav-badge">{{ state.creditCards().length }}</span>
        }
      </button>
    </div>
  </div>

  @if (state.syncMsg()) {
    <div class="sync-msg" style="margin:0 8px 8px;white-space:pre-line">{{ state.syncMsg() }}</div>
  }
</div>
  `,
})
export class SidebarComponent {
  private _syncMsgTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  isActive(view: string) {
    return this.state.view() === view;
  }

  navigate(view: 'notes-list' | 'index' | 'signals' | 'portfolio' | 'watch' | 'balance-sheet' | 'accounts' | 'transactions' | 'dividends' | 'funds' | 'cash-flow' | 'calendar' | 'liabilities') {
    this.state.view.set(view);
    this.state.sidebarOpen.set(false);
  }

  openBrokers()      { this.state.brokersOpen.set(true);      this.state.sidebarOpen.set(false); }
  openCreditCards()  { this.state.creditCardsOpen.set(true);  this.state.sidebarOpen.set(false); }

  accountWarningCount = computed(() => {
    const trades = this.state.trades();
    return this.state.accounts().filter(a => {
      const pending = pendingSettlements(a.id, trades);
      return pending > 0 && (a.balance - pending) < 0;
    }).length;
  });

  watchCount = computed(() =>
    this.state.tracked().filter(t => t.status === 'locked' || t.status === 'holding').length,
  );

  creditCardReminderCount = computed(() => {
    const todayDay = new Date().getDate();
    return this.state.creditCards().filter(c => c.paymentDay === todayDay).length;
  });

  calendarEventCount = computed(() => {
    const n = new Date();
    const d = n.getDate(), m = n.getMonth(), y = n.getFullYear();
    let count = this.state.creditCards().filter(c => c.paymentDay === d).length;
    count += this.state.liabilities().filter(l => l.reminderEnabled && l.reminderDay === d).length;
    count += this.state.funds().flatMap(f => f.schedules).filter(s => s.dayOfMonth === d).length;
    count += this.state.dividends().filter(dv => {
      const dt = new Date(dv.exDate + 'T00:00:00');
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }).length;
    // Balance alerts: payments due TOMORROW — warn today
    const tomorrow = d + 1;
    const accts = this.state.accounts();
    const dedTomorrow = new Map<string, number>();
    for (const l of this.state.liabilities()) {
      if (!l.reminderEnabled || l.reminderDay !== tomorrow || !l.accountId || !l.monthlyPayment) continue;
      dedTomorrow.set(l.accountId, (dedTomorrow.get(l.accountId) ?? 0) + l.monthlyPayment);
    }
    for (const [accountId, due] of dedTomorrow) {
      const acct = accts.find(a => a.id === accountId);
      if (acct && acct.balance < due) count++;
    }
    return count;
  });

  liabilityReminderCount = computed(() => {
    const now = new Date();
    const todayDay = now.getDate();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return this.state.liabilities().filter(l => {
      if (!l.reminderEnabled || !l.reminderDay) return false;
      return todayDay === Math.min(l.reminderDay, lastDay);
    }).length;
  });

  openImport() {
    this.state.importing.set(true);
    this.state.sidebarOpen.set(false);
  }

  async addNote() {
    const note: Note = { id: uid(), title: '新筆記', description: '', createdAt: Date.now(), rows: [] };
    await this.api.createNote(note);
    this.state.addNote(note);
  }

  discountDisplay() { return +(this.state.feeDiscount() * 10).toFixed(1); }

  onDiscountChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v) && v >= 1 && v <= 10) this.state.setFeeDiscount(v / 10);
  }

  async syncStocks() {
    if (this._syncMsgTimer) clearTimeout(this._syncMsgTimer);
    this.state.syncing.set(true);
    this.state.syncMsg.set('');
    try {
      const res = await this.api.syncStocks(false);
      const stocks = await this.api.getStocks();
      this.stock.apply(stocks);

      const lines: string[] = [res.message];
      if (res.chips_synced > 0) lines.push(`籌碼資料更新 ${res.chips_synced} 支`);
      if (res.log?.length) lines.push(...res.log);
      this.state.syncMsg.set(lines.join('\n'));
    } catch (e: any) {
      this.state.syncMsg.set('同步失敗：' + (e.message ?? ''));
    } finally {
      this.state.syncing.set(false);
      this._syncMsgTimer = setTimeout(() => this.state.syncMsg.set(''), 30000);
    }
  }
}
