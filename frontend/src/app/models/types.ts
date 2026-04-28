export type TrackingStatus = 'holding' | 'tracking' | 'watching';
export type SignalDirection = 'enter' | 'exit' | 'watch';
export type SignalStatus = 'active' | 'triggered' | 'invalid' | 'expired';
export type TradeType = 'buy' | 'sell';
export type Market = 'tw' | 'us';
export type MainView = 'notes' | 'index' | 'signals';

export interface Entry {
  id: string;
  code: string;
  name: string;
  status: TrackingStatus;
  thesis: string;
  memo: string;
}

export interface Row {
  id: string;
  category: string;
  entries: Entry[];
}

export interface Note {
  id: string;
  title: string;
  createdAt: number;
  rows: Row[];
}

export interface Signal {
  id: string;
  date: number;
  direction: SignalDirection;
  source: string;
  condition: string;
  price: string;
  status: SignalStatus;
  invalidReason: string;
}

export interface Trade {
  id: string;
  date: string;
  type: TradeType;
  shares: number;
  price: number;
  fee: number;
  sigRef: string;
}

export interface StockInfo {
  code: string;
  name: string;
  close: number | null;
  updatedAt: string | null;
}

export interface EditTarget {
  rowId: string;
  entry: Entry;
}

export interface FifoResult {
  realizedPnL: number;
  holdingShares: number;
  avgCost: number;
  results: { id: string; realized: number | null; tax: number }[];
}
