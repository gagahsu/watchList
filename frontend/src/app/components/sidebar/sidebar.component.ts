import { Component, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { StockService } from '../../services/stock.service';
import { uid } from '../../utils';
import { Note } from '../../models/types';

@Component({
  selector: 'app-sidebar',
  template: `
<div id="sidebar" [class.open]="state.sidebarOpen()">
  <div class="sidebar-header">
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">📋</div>
      <div>
        <div>WatchList</div>
        <div class="sidebar-brand-sub">投資研究筆記</div>
      </div>
    </div>
    <button class="sidebar-close-btn" (click)="state.sidebarOpen.set(false)" aria-label="關閉側邊欄">×</button>
  </div>

  <div class="sidebar-nav">
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

    <!-- 個股 -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">個股</span>
      <button class="sidebar-nav-item" [class.active]="isActive('index')" (click)="navigate('index')">
        <span class="nav-icon">🔍</span> 個股索引
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('signals')" (click)="navigate('signals')">
        <span class="nav-icon">📡</span> 訊號總覽
        @if (state.activeSignalCount() > 0) {
          <span class="sidebar-nav-badge">{{ state.activeSignalCount() }}</span>
        }
      </button>
      <button class="sidebar-nav-item" [class.active]="isActive('portfolio')" (click)="navigate('portfolio')">
        <span class="nav-icon">💼</span> 投資組合
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
    </div>
  </div>

  @if (state.syncMsg()) {
    <div class="sync-msg" style="margin:0 8px 8px;white-space:pre-line">{{ state.syncMsg() }}</div>
  }
</div>
  `,
})
export class SidebarComponent {
  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  isActive(view: string) {
    return this.state.view() === view;
  }

  navigate(view: 'notes-list' | 'index' | 'signals' | 'portfolio') {
    this.state.view.set(view);
    this.state.sidebarOpen.set(false);
  }

  openBrokers() { this.state.brokersOpen.set(true); this.state.sidebarOpen.set(false); }

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
    this.state.syncing.set(true);
    this.state.syncMsg.set('');
    try {
      const res = await this.api.syncStocks(false) as any;
      const stocks = await this.api.getStocks();
      this.stock.apply(stocks);
      let msg = res.message ?? '同步完成';
      if ((res.prices_synced ?? 0) === 0 && !res.all_up_to_date && res.log?.length) {
        msg += '\n' + (res.log as string[]).join('\n');
      }
      this.state.syncMsg.set(msg);
    } catch (e: any) {
      this.state.syncMsg.set('同步失敗：' + (e.message ?? ''));
    } finally {
      this.state.syncing.set(false);
      setTimeout(() => this.state.syncMsg.set(''), 30000);
    }
  }
}
