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

@Component({
  selector: 'app-root',
  imports: [
    SidebarComponent, NotesViewComponent, NotesListViewComponent,
    StockIndexComponent, SignalsViewComponent, PortfolioViewComponent,
    AddCompanyModalComponent, StockDetailModalComponent, ImportModalComponent,
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
      const [notes, signals, trades, sources, markets, stocks, trackedStocks] = await this.api.loadAll();
      this.state.notes.set(notes);
      this.state.signals.set(signals);
      this.state.trades.set(trades);
      this.state.sources.set(sources);
      this.state.tradeMarkets.set(markets);
      this.stock.apply(stocks);
      this.state.tracked.set(trackedStocks);
      this.state.activeNoteId.set(notes[0]?.id ?? null);
      this.state.loading.set(false);
    } catch (e: any) {
      this.state.error.set(e.message ?? '載入失敗');
      this.state.loading.set(false);
    }
  }

  fmtD = fmtD;
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
      'notes': 'WatchList',
      'index': '個股索引',
      'signals': '訊號總覽',
      'portfolio': '投資組合',
    };
    return titles[this.state.view()] ?? 'WatchList';
  }
}
