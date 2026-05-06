import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  Note, Row, Entry, Signal, Trade, StockInfo, TrackedStock,
  TrackingStatus, SignalStatus, Market, Broker, Account, Liability, OhlcBar, ChipData,
  AccountTransaction, CreditCard, DividendRecord, FundHolding, FundSchedule, NetWorthSnapshot,
} from '../models/types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient) {}

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private post<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`${this.base}${path}`, body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  loadAll() {
    return Promise.all([
      this.get<Note[]>('/notes'),
      this.get<Record<string, Signal[]>>('/signals'),
      this.get<Record<string, Trade[]>>('/trades'),
      this.get<string[]>('/sources'),
      this.get<Record<string, Market>>('/trade-markets'),
      this.get<StockInfo[]>('/stocks'),
      this.get<TrackedStock[]>('/tracked'),
      this.get<Broker[]>('/brokers'),
      this.get<Account[]>('/accounts'),
      this.get<Liability[]>('/liabilities'),
      this.get<AccountTransaction[]>('/account-transactions'),
      this.get<DividendRecord[]>('/dividends'),
      this.get<{rate: number}>('/fx-rate'),
      this.get<FundHolding[]>('/funds'),
      this.get<CreditCard[]>('/credit-cards'),
      this.get<NetWorthSnapshot[]>('/net-worth-snapshots'),
    ]);
  }

  getFxRate() { return this.get<{rate: number}>('/fx-rate'); }

  // ── Notes ─────────────────────────────────────────────────────────────────
  createNote(note: Partial<Note>) { return this.post<Note>('/notes', note); }
  deleteNote(id: string) { return this.delete<{ok:boolean}>(`/notes/${id}`); }
  patchNote(id: string, body: {title?: string; description?: string}) { return this.patch(`/notes/${id}`, body); }

  // ── Rows ──────────────────────────────────────────────────────────────────
  createRow(noteId: string, row: Partial<Row>) {
    return this.post<Row>(`/notes/${noteId}/rows`, row);
  }
  patchRow(rowId: string, body: {category: string}) {
    return this.patch(`/rows/${rowId}`, body);
  }
  deleteRow(rowId: string) { return this.delete<{ok:boolean}>(`/rows/${rowId}`); }

  // ── Entries ───────────────────────────────────────────────────────────────
  createEntry(rowId: string, entry: Partial<Entry>) {
    return this.post<Entry>(`/rows/${rowId}/entries`, entry);
  }
  patchEntry(entryId: string, body: Partial<Entry> & {status?: TrackingStatus}) {
    return this.patch<Entry>(`/entries/${entryId}`, body);
  }
  deleteEntry(entryId: string) { return this.delete<{ok:boolean}>(`/entries/${entryId}`); }

  // ── Signals ───────────────────────────────────────────────────────────────
  createSignal(code: string, sig: Partial<Signal>) {
    return this.post<Signal>(`/signals/${code}`, sig);
  }
  patchSignal(sigId: string, body: Partial<Pick<Signal, 'status'|'invalidReason'|'direction'|'source'|'condition'|'price'>>) {
    return this.patch<Signal>(`/signals/${sigId}`, body);
  }
  deleteSignal(sigId: string) { return this.delete<{ok:boolean}>(`/signals/${sigId}`); }

  // ── Trades ────────────────────────────────────────────────────────────────
  createTrade(code: string, trade: Partial<Trade>) {
    return this.post<Trade>(`/trades/${code}`, trade);
  }
  deleteTrade(tradeId: string) { return this.delete<{ok:boolean}>(`/trades/${tradeId}`); }
  setMarket(code: string, market: Market) {
    return this.put(`/trade-markets/${code}`, { market });
  }

  // ── Tracked Stocks ────────────────────────────────────────────────────────
  addTracked(body: Partial<TrackedStock> & { code: string }) {
    return this.post<TrackedStock>('/tracked', { ...body, addedAt: body.addedAt ?? Date.now() });
  }
  patchTracked(code: string, body: { status?: TrackingStatus; thesis?: string; memo?: string; stopLoss?: string; takeProfit?: string }) {
    return this.patch<TrackedStock>(`/tracked/${code}`, body);
  }
  deleteTracked(code: string) { return this.delete<{ok:boolean}>(`/tracked/${code}`); }

  // ── Sources ───────────────────────────────────────────────────────────────
  addSource(name: string) { return this.post<string[]>('/sources', { name }); }

  // ── Stocks ────────────────────────────────────────────────────────────────
  getStocks() { return this.get<StockInfo[]>('/stocks'); }
  syncStocks(force = false) {
    return this.post<{
      message:        string;
      prices_synced:  number;
      chips_synced:   number;
      skipped:        number;
      all_up_to_date: boolean;
      log:            string[];
    }>('/stocks/sync', { force });
  }

  // ── Live Quotes (yfinance, ~15min delay) ──────────────────────────────────
  getQuotes(items: {code: string; market: string}[]) {
    return this.post<Record<string, number | null>>('/quotes', { items });
  }

  // ── OHLC (60-day candlestick data via yfinance) ────────────────────────────
  // days=120: 60 display bars + 59 warmup to fully compute MA60
  getOhlc(code: string, days = 120) {
    return this.get<OhlcBar[]>(`/ohlc/${code}?days=${days}`);
  }

  getChips(code: string) {
    return this.get<ChipData>(`/chips/${code}`);
  }

  // ── Brokers ───────────────────────────────────────────────────────────────
  getBrokers() { return this.get<Broker[]>('/brokers'); }
  createBroker(b: Broker) { return this.post<Broker>('/brokers', b); }
  updateBroker(id: string, b: Broker) { return this.put<Broker>(`/brokers/${id}`, b); }
  deleteBroker(id: string) { return this.delete<{ok:boolean}>(`/brokers/${id}`); }

  // ── Accounts ──────────────────────────────────────────────────────────────
  getAccounts() { return this.get<Account[]>('/accounts'); }
  createAccount(a: Account) { return this.post<Account>('/accounts', a); }
  patchAccount(id: string, body: Partial<Pick<Account, 'name'|'balance'|'interestRate'|'note'>>) {
    return this.patch<Account>(`/accounts/${id}`, body);
  }
  deleteAccount(id: string) { return this.delete<{ok:boolean}>(`/accounts/${id}`); }
  reorderAccounts(ids: string[]) { return this.put<{ok:boolean}>('/accounts/reorder', { ids }); }

  // ── Liabilities ───────────────────────────────────────────────────────────
  createLiability(l: Liability) { return this.post<Liability>('/liabilities', l); }
  patchLiability(id: string, body: Partial<Omit<Liability, 'id'>>) {
    return this.patch<Liability>(`/liabilities/${id}`, body);
  }
  deleteLiability(id: string) { return this.delete<{ok:boolean}>(`/liabilities/${id}`); }

  // ── Account Transactions ──────────────────────────────────────────────────
  createTransaction(t: AccountTransaction) {
    return this.post<AccountTransaction>('/account-transactions', t);
  }
  deleteTransaction(id: string) {
    return this.delete<{ok:boolean}>(`/account-transactions/${id}`);
  }

  // ── Dividends ─────────────────────────────────────────────────────────────
  loadDividends() { return this.get<DividendRecord[]>('/dividends'); }
  createDividend(d: DividendRecord) { return this.post<DividendRecord>('/dividends', d); }
  deleteDividend(id: string) { return this.delete<{ok:boolean}>(`/dividends/${id}`); }
  syncDividends(code: string) {
    return this.post<{code:string; source:string|null; fetched:number; saved:number; errors:string[]}>(`/dividends/sync/${code}`, {});
  }

  // ── Funds ─────────────────────────────────────────────────────────────────
  getFunds() { return this.get<FundHolding[]>('/funds'); }
  createFund(f: FundHolding) { return this.post<FundHolding>('/funds', f); }
  patchFund(id: string, body: Partial<Omit<FundHolding, 'id' | 'schedules'>>) { return this.patch<FundHolding>(`/funds/${id}`, body); }
  deleteFund(id: string) { return this.delete<{ok:boolean}>(`/funds/${id}`); }
  createFundSchedule(fundId: string, s: FundSchedule) { return this.post<FundSchedule>(`/funds/${fundId}/schedules`, s); }
  deleteFundSchedule(fundId: string, scheduleId: string) { return this.delete<{ok:boolean}>(`/funds/${fundId}/schedules/${scheduleId}`); }

  // ── Credit Cards ──────────────────────────────────────────────────────────
  getCreditCards() { return this.get<CreditCard[]>('/credit-cards'); }
  createCreditCard(c: CreditCard) { return this.post<CreditCard>('/credit-cards', c); }
  patchCreditCard(id: string, body: Partial<Omit<CreditCard, 'id'>>) { return this.patch<CreditCard>(`/credit-cards/${id}`, body); }
  deleteCreditCard(id: string) { return this.delete<{ok:boolean}>(`/credit-cards/${id}`); }

  // ── Net Worth Snapshots ───────────────────────────────────────────────────
  getNetWorthSnapshots() { return this.get<NetWorthSnapshot[]>('/net-worth-snapshots'); }
  createNetWorthSnapshot(s: NetWorthSnapshot) { return this.post<NetWorthSnapshot>('/net-worth-snapshots', s); }
  deleteNetWorthSnapshot(id: string) { return this.delete<{ok:boolean}>(`/net-worth-snapshots/${id}`); }
}
