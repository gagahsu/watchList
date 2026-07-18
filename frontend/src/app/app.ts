import { Component, OnInit } from '@angular/core';
import { fmtD } from './utils';
import { AppStateService } from './services/app-state.service';
import { ApiService } from './services/api.service';
import { StockService } from './services/stock.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { NotesViewComponent } from './components/notes-view/notes-view.component';
import { NotesListViewComponent } from './components/notes-list-view/notes-list-view.component';
import { PortfolioViewComponent } from './components/portfolio-view/portfolio-view.component';
import { StockIndexComponent } from './components/stock-index/stock-index.component';
import { SignalsViewComponent } from './components/signals-view/signals-view.component';
import { AddCompanyModalComponent } from './components/modals/add-company-modal/add-company-modal.component';
import { StockDetailModalComponent } from './components/modals/stock-detail-modal/stock-detail-modal.component';
import { ImportModalComponent } from './components/modals/import-modal/import-modal.component';
import { BrokerSettingsModalComponent } from './components/modals/broker-settings-modal/broker-settings-modal.component';
import { CreditCardSettingsModalComponent } from './components/modals/credit-card-settings-modal/credit-card-settings-modal.component';
import { AccountsViewComponent } from './components/accounts-view/accounts-view.component';
import { BalanceSheetViewComponent } from './components/balance-sheet-view/balance-sheet-view.component';
import { WatchViewComponent } from './components/watch-view/watch-view.component';
import { AccountTransactionsViewComponent } from './components/account-transactions-view/account-transactions-view.component';
import { DividendViewComponent } from './components/dividend-view/dividend-view.component';
import { FundHoldingsViewComponent } from './components/fund-holdings-view/fund-holdings-view.component';
import { CashFlowViewComponent } from './components/cash-flow-view/cash-flow-view.component';
import { CalendarViewComponent } from './components/calendar-view/calendar-view.component';
import { LiabilitiesViewComponent } from './components/liabilities-view/liabilities-view.component';
import { RiskViewComponent } from './components/risk-view/risk-view.component';

@Component({
  selector: 'app-root',
  imports: [
    SidebarComponent, NotesViewComponent, NotesListViewComponent,
    StockIndexComponent, SignalsViewComponent, PortfolioViewComponent,
    AddCompanyModalComponent, StockDetailModalComponent, ImportModalComponent,
    BrokerSettingsModalComponent, CreditCardSettingsModalComponent, AccountsViewComponent,
    BalanceSheetViewComponent, WatchViewComponent, AccountTransactionsViewComponent,
    DividendViewComponent, FundHoldingsViewComponent, CashFlowViewComponent, CalendarViewComponent,
    LiabilitiesViewComponent, RiskViewComponent,
  ],
  templateUrl: './app.html',
})
export class App implements OnInit {
  constructor(
    public state: AppStateService,
    private api: ApiService,
    private stock: StockService,
  ) {}

  async ngOnInit() {
    try {
      const [notes, signals, trades, sources, markets, stocks, trackedStocks, brokers, accounts, liabilities, transactions, dividends, fxRate, funds, creditCards, netWorthSnapshots, assetClasses] = await this.api.loadAll();
      this.state.notes.set(notes);
      this.state.signals.set(signals);
      this.state.trades.set(trades);
      this.state.sources.set(sources);
      this.state.tradeMarkets.set(markets);
      this.stock.apply(stocks);
      this.state.tracked.set(trackedStocks);
      this.state.brokers.set(brokers);
      this.state.accounts.set(accounts);
      this.state.liabilities.set(liabilities);
      this.state.transactions.set(transactions);
      this.state.dividends.set(dividends);
      this.state.usdTwdRate.set(fxRate.rate);
      this.state.funds.set(funds);
      this.state.creditCards.set(creditCards);
      this.state.netWorthSnapshots.set(netWorthSnapshots);
      this.state.assetClasses.set(assetClasses);
      this.state.activeNoteId.set(notes[0]?.id ?? null);
      this.state.loading.set(false);
    } catch (e: any) {
      this.state.error.set(e.message ?? '載入失敗');
      this.state.loading.set(false);
    }
  }

  fmtD = fmtD;

  fmtPortfolioTime(d: Date) {
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }
  private titleTimer: ReturnType<typeof setTimeout> | null = null;

  onTitleInput(e: Event) {
    const title = (e.target as HTMLInputElement).value;
    const id = this.state.activeNoteId()!;
    this.state.updateNoteTitle(id, title);
    if (this.titleTimer) clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => this.api.patchNote(id, { title }), 300);
  }

  reload() { window.location.reload(); }

  pageTitle() {
    const titles: Record<string, string> = {
      'notes-list': '筆記列表',
      'notes': '理債富',
      'index': '個股索引',
      'signals': '訊號總覽',
      'portfolio': '投資組合',
      'balance-sheet': '資產負債',
      'watch':    '鎖定觀察',
      'accounts': '帳戶管理',
      'transactions': '資金流水帳',
      'dividends': '股息追蹤',
      'funds': '基金持倉',
      'cash-flow': '每月現金流',
      'calendar':  '財務行事曆',
      'liabilities': '負債管理',
      'risk': '風險暴露',
    };
    return titles[this.state.view()] ?? '理債富';
  }
}
