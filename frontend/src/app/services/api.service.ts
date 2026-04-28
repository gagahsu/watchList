import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  Note, Row, Entry, Signal, Trade, StockInfo,
  TrackingStatus, SignalStatus, Market,
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
    ]);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  createNote(note: Partial<Note>) { return this.post<Note>('/notes', note); }
  deleteNote(id: string) { return this.delete<{ok:boolean}>(`/notes/${id}`); }
  patchNote(id: string, body: {title: string}) { return this.patch(`/notes/${id}`, body); }

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
  patchSignal(sigId: string, body: {status: SignalStatus; invalidReason: string}) {
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

  // ── Sources ───────────────────────────────────────────────────────────────
  addSource(name: string) { return this.post<string[]>('/sources', { name }); }

  // ── Stocks ────────────────────────────────────────────────────────────────
  getStocks() { return this.get<StockInfo[]>('/stocks'); }
  syncStocks() { return this.post<{message: string}>('/stocks/sync', {}); }
}
