import { Injectable, computed, signal } from '@angular/core';
import {
  Account, AccountTransaction, Broker, CreditCard, DividendRecord, EditTarget, Entry, FundHolding, FundSchedule, Liability, MainView, Market, NetWorthSnapshot, Note,
  Row, Signal, Trade, TrackedStock,
} from '../models/types';

function uid() { return Math.random().toString(36).slice(2, 9); }

@Injectable({ providedIn: 'root' })
export class AppStateService {
  // ── Server data ───────────────────────────────────────────────────────────
  notes        = signal<Note[]>([]);
  signals      = signal<Record<string, Signal[]>>({});
  trades       = signal<Record<string, Trade[]>>({});
  sources      = signal<string[]>([]);
  tradeMarkets = signal<Record<string, Market>>({});
  tracked      = signal<TrackedStock[]>([]);
  accounts     = signal<Account[]>([]);
  liabilities  = signal<Liability[]>([]);
  transactions = signal<AccountTransaction[]>([]);
  dividends    = signal<DividendRecord[]>([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  activeNoteId = signal<string | null>(null);
  view         = signal<MainView>('balance-sheet');
  sidebarOpen  = signal(false);
  editTarget   = signal<EditTarget | null>(null);
  addToRowId   = signal<string | null>(null);
  addingDirect = signal(false);
  importing    = signal(false);
  syncing      = signal(false);
  syncMsg      = signal('');
  loading      = signal(true);
  error        = signal<string | null>(null);
  portfolioRefreshTick    = signal(0);
  portfolioRefreshing     = signal(false);
  portfolioLastUpdated    = signal<Date | null>(null);
  brokers                 = signal<Broker[]>([]);
  brokersOpen             = signal(false);
  creditCardsOpen         = signal(false);
  accountsOpen            = signal(false);
  balanceSheetOpen        = signal(false);
  feeDiscount    = signal<number>(parseFloat(localStorage.getItem('fee_discount') ?? '0.6'));
  usdTwdRate     = signal<number>(31.5);
  monthlySalary  = signal<number>(parseFloat(localStorage.getItem('monthly_salary') ?? '0'));

  setFeeDiscount(v: number) {
    const clamped = Math.max(0.1, Math.min(1, v));
    this.feeDiscount.set(clamped);
    localStorage.setItem('fee_discount', String(clamped));
  }

  setMonthlySalary(v: number) {
    this.monthlySalary.set(v);
    localStorage.setItem('monthly_salary', String(v));
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  activeNote = computed(() =>
    this.notes().find(n => n.id === this.activeNoteId()) ?? null,
  );

  activeSignalCount = computed(() =>
    Object.values(this.signals())
      .flat()
      .filter(s => s.status === 'active').length,
  );

  // ── Helpers: uid ──────────────────────────────────────────────────────────
  uid() { return uid(); }

  // ── Notes mutations ───────────────────────────────────────────────────────
  addNote(note: Note) {
    this.notes.update(ns => [note, ...ns]);
    this.activeNoteId.set(note.id);
    this.view.set('notes');
    this.sidebarOpen.set(false);
  }

  removeNote(id: string) {
    this.notes.update(ns => {
      const rem = ns.filter(n => n.id !== id);
      if (this.activeNoteId() === id) this.activeNoteId.set(rem[0]?.id ?? null);
      return rem;
    });
  }

  updateNoteTitle(id: string, title: string) {
    this.notes.update(ns => ns.map(n => (n.id === id ? { ...n, title } : n)));
  }

  updateNoteDescription(id: string, description: string) {
    this.notes.update(ns => ns.map(n => (n.id === id ? { ...n, description } : n)));
  }

  addNoteToFront(note: Note) {
    this.notes.update(ns => [note, ...ns]);
    this.activeNoteId.set(note.id);
    this.view.set('notes');
    this.sidebarOpen.set(false);
  }

  // ── Row mutations ─────────────────────────────────────────────────────────
  addRow(noteId: string, row: Row) {
    this._mutNote(noteId, n => ({ ...n, rows: [...n.rows, row] }));
  }

  removeRow(noteId: string, rowId: string) {
    this._mutNote(noteId, n => ({ ...n, rows: n.rows.filter(r => r.id !== rowId) }));
  }

  updateCategory(noteId: string, rowId: string, category: string) {
    this._mutNote(noteId, n => ({
      ...n,
      rows: n.rows.map(r => (r.id === rowId ? { ...r, category } : r)),
    }));
  }

  // ── Entry mutations ───────────────────────────────────────────────────────
  addEntry(noteId: string, rowId: string, entry: Entry) {
    this._mutRow(noteId, rowId, r => ({ ...r, entries: [...r.entries, entry] }));
  }

  removeEntry(noteId: string, rowId: string, entryId: string) {
    this._mutRow(noteId, rowId, r => ({
      ...r,
      entries: r.entries.filter(e => e.id !== entryId),
    }));
  }

  cycleEntry(noteId: string, rowId: string, entryId: string, status: Entry['status']) {
    this._mutEntry(noteId, rowId, entryId, e => ({ ...e, status }));
  }

  saveEntry(noteId: string, rowId: string, updated: Entry) {
    this._mutEntry(noteId, rowId, updated.id, () => updated);
  }

  // ── Tracked stock mutations ───────────────────────────────────────────────
  addTracked(t: TrackedStock) {
    this.tracked.update(ts => ts.some(x => x.code === t.code) ? ts : [t, ...ts]);
  }

  updateTracked(updated: TrackedStock) {
    this.tracked.update(ts => ts.map(t => t.code === updated.code ? updated : t));
  }

  removeTracked(code: string) {
    this.tracked.update(ts => ts.filter(t => t.code !== code));
  }

  // ── Signal mutations ──────────────────────────────────────────────────────
  addSignal(code: string, sig: Signal) {
    this.signals.update(ss => ({ ...ss, [code]: [sig, ...(ss[code] ?? [])] }));
  }

  updateSignal(code: string, id: string, updated: Signal) {
    this.signals.update(ss => ({
      ...ss,
      [code]: (ss[code] ?? []).map(s => (s.id === id ? updated : s)),
    }));
  }

  deleteSignal(code: string, id: string) {
    this.signals.update(ss => ({
      ...ss,
      [code]: (ss[code] ?? []).filter(s => s.id !== id),
    }));
  }

  // ── Trade mutations ───────────────────────────────────────────────────────
  addTrade(code: string, trade: Trade) {
    this.trades.update(tt => ({ ...tt, [code]: [trade, ...(tt[code] ?? [])] }));
  }

  deleteTrade(code: string, id: string) {
    this.trades.update(tt => ({
      ...tt,
      [code]: (tt[code] ?? []).filter(t => t.id !== id),
    }));
  }

  setMarket(code: string, market: Market) {
    this.tradeMarkets.update(mm => ({ ...mm, [code]: market }));
  }

  // ── Source mutations ──────────────────────────────────────────────────────
  addSource(name: string) {
    this.sources.update(ss => (ss.includes(name) ? ss : [...ss, name]));
  }

  // ── Account mutations ─────────────────────────────────────────────────────
  addAccount(a: Account) {
    this.accounts.update(as => [...as, a]);
  }

  updateAccount(updated: Account) {
    this.accounts.update(as => as.map(a => a.id === updated.id ? updated : a));
  }

  removeAccount(id: string) {
    this.accounts.update(as => as.filter(a => a.id !== id));
  }

  // ── Liability mutations ───────────────────────────────────────────────────
  addLiability(l: Liability) {
    this.liabilities.update(ls => [...ls, l]);
  }

  updateLiability(updated: Liability) {
    this.liabilities.update(ls => ls.map(l => l.id === updated.id ? updated : l));
  }

  removeLiability(id: string) {
    this.liabilities.update(ls => ls.filter(l => l.id !== id));
  }

  addTransaction(t: AccountTransaction) {
    this.transactions.update(ts => [t, ...ts]);
  }
  removeTransaction(id: string) {
    this.transactions.update(ts => ts.filter(t => t.id !== id));
  }

  addDividend(d: DividendRecord) { this.dividends.update(ds => [d, ...ds]); }
  removeDividend(id: string) { this.dividends.update(ds => ds.filter(d => d.id !== id)); }

  // ── Credit card mutations ─────────────────────────────────────────────────
  creditCards = signal<CreditCard[]>([]);
  addCreditCard(c: CreditCard) { this.creditCards.update(cs => [...cs, c]); }
  updateCreditCard(updated: CreditCard) { this.creditCards.update(cs => cs.map(c => c.id === updated.id ? updated : c)); }
  removeCreditCard(id: string) { this.creditCards.update(cs => cs.filter(c => c.id !== id)); }

  // ── Net Worth Snapshot mutations ──────────────────────────────────────────
  netWorthSnapshots = signal<NetWorthSnapshot[]>([]);
  addNetWorthSnapshot(s: NetWorthSnapshot) { this.netWorthSnapshots.update(ss => [...ss, s].sort((a, b) => a.date.localeCompare(b.date))); }
  removeNetWorthSnapshot(id: string) { this.netWorthSnapshots.update(ss => ss.filter(s => s.id !== id)); }

  // ── Fund mutations ────────────────────────────────────────────────────────
  funds = signal<FundHolding[]>([]);
  addFund(f: FundHolding) { this.funds.update(fs => [...fs, f]); }
  updateFund(updated: FundHolding) { this.funds.update(fs => fs.map(f => f.id === updated.id ? updated : f)); }
  removeFund(id: string) { this.funds.update(fs => fs.filter(f => f.id !== id)); }

  addFundSchedule(fundId: string, s: FundSchedule) {
    this.funds.update(fs => fs.map(f =>
      f.id === fundId ? { ...f, schedules: [...f.schedules, s].sort((a, b) => a.dayOfMonth - b.dayOfMonth) } : f
    ));
  }
  removeFundSchedule(fundId: string, scheduleId: string) {
    this.funds.update(fs => fs.map(f =>
      f.id === fundId ? { ...f, schedules: f.schedules.filter(s => s.id !== scheduleId) } : f
    ));
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private _mutNote(id: string, fn: (n: Note) => Note) {
    this.notes.update(ns => ns.map(n => (n.id === id ? fn(n) : n)));
  }

  private _mutRow(noteId: string, rowId: string, fn: (r: Row) => Row) {
    this._mutNote(noteId, n => ({
      ...n,
      rows: n.rows.map(r => (r.id === rowId ? fn(r) : r)),
    }));
  }

  private _mutEntry(
    noteId: string, rowId: string, entryId: string, fn: (e: Entry) => Entry,
  ) {
    this._mutRow(noteId, rowId, r => ({
      ...r,
      entries: r.entries.map(e => (e.id === entryId ? fn(e) : e)),
    }));
  }
}
