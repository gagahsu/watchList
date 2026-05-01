import { FifoResult, Trade } from './models/types';

export const uid = () => Math.random().toString(36).slice(2, 9);

export const fmtD = (d: number) =>
  new Date(d).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });

export const fmtDate = (d: number) =>
  new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });

export const STATUS_LABELS: Record<string, string> = {
  holding: '已持有', tracking: '追蹤中', locked: '鎖定',
};
export const STATUS_CLASS: Record<string, string> = {
  holding: 'chip-holding', tracking: 'chip-tracking', locked: 'chip-locked',
};
export const STATUS_ORDER = ['tracking', 'locked', 'holding'];

export const SIG_DIR_LABELS: Record<string, string> = {
  enter: '進場', exit: '出場', watch: '觀察',
};
export const SIG_DIR_CLASS: Record<string, string> = {
  enter: 'sig-dir-enter', exit: 'sig-dir-exit', watch: 'sig-dir-watch',
};
export const SIG_STATUS_LABELS: Record<string, string> = {
  active: '有效', triggered: '已實現', invalid: '已失效', expired: '已過期',
};
export const SIG_STATUS_CLASS: Record<string, string> = {
  active: 'sig-status-active', triggered: 'sig-status-triggered',
  invalid: 'sig-status-invalid', expired: 'sig-status-expired',
};

export const DEFAULT_SOURCES = ['口袋證券', '股癌', '方格子', 'XQ全球贏家', '理財達人秀', '其他'];

export function fmtMoney(n: number, market: string): string {
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  return market === 'us' ? `${sign}$${abs.toFixed(2)}` : `${sign}${Math.round(abs).toLocaleString()}`;
}

export function calcFIFO(trades: Trade[], market: string): FifoResult {
  const sorted = [...trades].sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (d !== 0) return d;
    // same day: buy before sell so FIFO can match them correctly
    if (a.type === 'buy' && b.type !== 'buy') return -1;
    if (a.type !== 'buy' && b.type === 'buy') return 1;
    return 0;
  });
  const buyQueue: { shares: number; unitCost: number }[] = [];
  let realizedPnL = 0;
  const results: FifoResult['results'] = [];

  for (const t of sorted) {
    const fee = t.fee || 0;
    const shares = t.shares || 0;
    const price = t.price || 0;

    if (t.type === 'buy') {
      const unitCost = (shares * price + fee) / shares;
      buyQueue.push({ shares, unitCost });
      results.push({ id: t.id, realized: null, tax: 0 });
    } else {
      const sellAmount = shares * price;
      const tax = market === 'tw' ? Math.floor(sellAmount * 0.003) : 0;
      const proceeds = sellAmount - fee - tax;
      let remaining = shares;
      let costBasis = 0;
      while (remaining > 0 && buyQueue.length > 0) {
        const lot = buyQueue[0];
        const used = Math.min(remaining, lot.shares);
        costBasis += used * lot.unitCost;
        lot.shares -= used;
        remaining -= used;
        if (lot.shares <= 0) buyQueue.shift();
      }
      const realized = proceeds - costBasis;
      realizedPnL += realized;
      results.push({ id: t.id, realized, tax });
    }
  }

  const holdingShares = buyQueue.reduce((s, l) => s + l.shares, 0);
  const holdingCost = buyQueue.reduce((s, l) => s + l.shares * l.unitCost, 0);
  const avgCost = holdingShares > 0 ? holdingCost / holdingShares : 0;
  return { realizedPnL, holdingShares, avgCost, results };
}

export function parseCSV(
  text: string,
  stockDB: Record<string, string>,
  stockList: { code: string; name: string }[],
): { id: string; category: string; entries: { id: string; code: string; name: string; status: string }[] }[] | null {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  const parseLine = (line: string) => {
    const out: string[] = []; let cur = ''; let inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    out.push(cur.trim());
    return out;
  };

  const parseEntry = (str: string) => {
    str = str.trim().replace(/（/g, '(').replace(/）/g, ')');
    const m = str.match(/^(.+?)\((\d{4,6})\)$/);
    if (m) return { id: uid(), name: m[1].trim(), code: m[2].trim(), status: 'tracking' };
    if (/^\d{4,6}$/.test(str)) return { id: uid(), name: stockDB[str] || str, code: str, status: 'tracking' };
    const byName = stockList.find(s => s.name === str);
    if (byName) return { id: uid(), name: byName.name, code: byName.code, status: 'tracking' };
    return { id: uid(), name: str, code: '', status: 'tracking' };
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s/g, ''));
  const ci = Math.max(0, headers.findIndex(h => h.includes('產業') || h.includes('category') || h.includes('類別')));
  const ni = Math.max(1, headers.findIndex(h => h.includes('公司') || h.includes('company') || h.includes('名稱')));

  const catMap = new Map<string, ReturnType<typeof parseEntry>[]>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const cat = (cols[ci] || '').trim();
    if (!cat) continue;
    if (!catMap.has(cat)) catMap.set(cat, []);
    const cell = (cols[ni] || '').trim();
    const parts = cell.split(/[、；;]|(?<=\))[,，]/).map(s => s.trim()).filter(Boolean);
    parts.forEach(p => catMap.get(cat)!.push(parseEntry(p)));
  }

  return Array.from(catMap.entries()).map(([category, entries]) => ({ id: uid(), category, entries }));
}
