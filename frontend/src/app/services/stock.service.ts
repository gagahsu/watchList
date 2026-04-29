import { Injectable, computed, signal } from '@angular/core';
import { StockInfo } from '../models/types';

@Injectable({ providedIn: 'root' })
export class StockService {
  private _list = signal<StockInfo[]>([]);

  readonly list = this._list.asReadonly();

  readonly codeToName = computed(() => {
    const m: Record<string, string> = {};
    this._list().forEach(s => (m[s.code] = s.name));
    return m;
  });

  readonly closeMap = computed(() => {
    const m: Record<string, { close: number | null; updatedAt: string | null }> = {};
    this._list().forEach(s => (m[s.code] = { close: s.close, updatedAt: s.updatedAt }));
    return m;
  });

  apply(stks: StockInfo[]) { this._list.set(stks); }

  readonly industryMap = computed(() => {
    const m: Record<string, string> = {};
    this._list().forEach(s => (m[s.code] = s.industry));
    return m;
  });

  search(query: string, limit = 8): [string, string, string][] {
    if (!query) return [];
    const list = this._list();
    const byCode = list.filter(s => s.code.startsWith(query));
    const byName =
      query.length >= 2
        ? list.filter(s => !s.code.startsWith(query) && s.name.includes(query))
        : [];
    const byIndustry =
      query.length >= 2
        ? list.filter(s => !s.code.startsWith(query) && !s.name.includes(query) && s.industry.includes(query))
        : [];
    return [...byCode, ...byName, ...byIndustry].slice(0, limit).map(s => [s.code, s.name, s.industry]);
  }

  nameToEntry(name: string): StockInfo | undefined {
    return this._list().find(s => s.name === name);
  }
}
