export type TrackingStatus = 'holding' | 'tracking' | 'locked';
export type SignalDirection = 'enter' | 'exit' | 'watch';
export type SignalStatus = 'active' | 'triggered' | 'invalid' | 'expired';
export type TradeType = 'buy' | 'sell';
export type Market = 'tw' | 'us';
export type MainView = 'notes' | 'notes-list' | 'index' | 'signals' | 'portfolio' | 'balance-sheet' | 'watch' | 'accounts' | 'transactions' | 'dividends' | 'funds' | 'cash-flow' | 'calendar' | 'liabilities' | 'risk' | 'grid';

// ── ATR Grid (backend/grid/) ────────────────────────────────────────────────
export type GridAction = 'BUY' | 'SELL' | 'HOLD' | 'REVIEW' | 'SKIP';

export interface GridDecision {
  ticker: string;
  name: string;
  assetClass: string;
  action: GridAction;
  shares: number;
  rungs: number;
  lotShares: number;
  price: number;
  anchorBefore: number;
  anchorAfter: number;
  step: number;
  stepPct: number;
  priceBandLow: number | null;
  priceBandHigh: number | null;
  atr: number | null;
  atrPct: number | null;
  rungBefore: number;
  rungAfter: number;
  positionShares: number;
  estGross: number;
  estFee: number;
  estTax: number;
  estCashFlow: number;
  estRealizedPnl: number | null;
  signalRungs: number;
  /** 趨勢濾網判定的行情狀態：bull（強勢多頭，抑制賣出）/ bear（強勢空頭，抑制買進）/ neutral */
  regime: 'bull' | 'bear' | 'neutral';
  /** 底倉股數，永遠不參與網格賣出 */
  baseShares: number;
  reasons: string[];
  blocks: string[];
  notes: string[];
}

export interface GridCashCheck {
  available: number;
  required: number;
  shortfall: number;
  pendingSettlement: number;
}

export interface GridAdvice {
  asOf: string;
  decisions: GridDecision[];
  summary: {
    orders: number; tickers: number; netCashFlow: number; cost: number;
    cash: { tw: GridCashCheck; us: GridCashCheck };
    warnings: string[];
  };
}

/** 一組資產類別的網格參數（後端 grid/config.py 的 GridParams）。 */
export interface GridParams {
  atr_period: number;
  atr_multiplier: number;
  min_step_pct: number;
  max_step_pct: number;
  max_buy_rungs: number;
  max_sell_rungs: number;
  max_rungs_per_day: number;
  gap_atr_limit: number;
  drift_mode: string;
  drift_beta: number;
  trend_ema_period: number;
  allow_loss_sell: boolean;
  trend_filter_mode: 'off' | 'pause' | 'widen';
  trend_ma_period: number;
  rsi_period: number;
  rsi_overbought: number;
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
  trend_step_multiple: number;
  base_position_pct: number;
  range_reset_days: number;
  [key: string]: unknown;
}

export interface GridPosition {
  code: string;
  name: string;
  assetClass: string | null;
  market: Market;
  enabled: boolean;
  shares: number;
  avgCost: number;
  anchor: number;
  rung: number;
  baselineShares: number;
  lotShares?: number;
  maxBuyRungs?: number;
  maxSellRungs?: number;
  nextBuy?: number[];
  nextSell?: number[];
}

export interface GridPositionAddRequest {
  code: string;
  assetClass: 'equity' | 'bond' | 'leveraged' | 'stock';
  market: Market;
  gridOverrides?: Record<string, unknown>;
}

export interface GridRecordRequest {
  code: string;
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  rungs: number;
  step: number;
  date?: string;
  accountId?: string;
}

export interface OhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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
  description: string;
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
  note: string;
  accountId: string | null;
  settled: boolean;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  note: string;
}

export interface StockInfo {
  code: string;
  name: string;
  industry: string;
  close: number | null;
  updatedAt: string | null;
}

export interface TrackedStock {
  code: string;
  status: TrackingStatus;
  thesis: string;
  memo: string;
  stopLoss: string;
  takeProfit: string;
  atrEnabled: boolean;
  addedAt: number;
}

export interface Broker {
  id: string;
  name: string;
  discount: number;
  minFee: number;
  rounding: 'floor' | 'round' | 'ceil';
  accountId: string | null;
}

export type EditTarget =
  | { kind: 'tracked'; code: string; tab?: 'info' | 'signals' | 'trades' }
  | { kind: 'entry';   rowId: string; entry: Entry };

export interface Liability {
  id: string;
  name: string;
  type: string;
  amount: number;
  reminderEnabled: boolean;
  reminderDay: number | null;  // 1-31; null when disabled
  note: string;
  totalAmount: number | null;
  periods: number | null;
  paidPeriods: number | null;
  interestRate: number | null;
  monthlyPayment: number | null;
  accountId: string | null;
}

export interface NetWorthSnapshot {
  id: string;
  date: string;
  assets: number;
  liabilities: number;
  note: string;
  recordedAt: number;
}

export interface InstitutionalDay {
  date: string;
  foreign: number;
  trust: number;
  dealer: number;
  dealerHedge: number;
  total: number;
  totalStreak?: number;
  totalDirection?: 'buy' | 'sell' | 'none';
  foreignStreak?: number;
  foreignDirection?: 'buy' | 'sell' | 'none';
  trustStreak?: number;
  trustDirection?: 'buy' | 'sell' | 'none';
  dealerStreak?: number;
  dealerDirection?: 'buy' | 'sell' | 'none';
}

export interface MarginDay {
  date: string;
  marginBalance: number;
  marginChange: number;
  marginUsage: number;
  shortBalance: number;
  shortChange: number;
  shortRatio: number;
}

export interface LendingDay {
  date: string;
  balance: number;
  change: number;
}

export interface ShareholdingWeek {
  date: string;
  bigHolder: number;
  retail: number;
  totalShareholders: number;
}

export type TxnType = 'deposit' | 'withdrawal' | 'transfer';

export interface DividendRecord {
  id: string;
  code: string;
  exDate: string;
  cashDiv: number;
  stockDiv: number;
  payDate: string | null;
  note: string;
}

export interface AccountTransaction {
  id: string;
  date: string;
  type: TxnType;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  note: string;
}

export interface ChipData {
  institutional: InstitutionalDay[];
  margin: MarginDay[];
}

export interface FundSchedule {
  id: string;
  dayOfMonth: number;
  amount: number;
  note: string;
}

export interface FundHolding {
  id: string;
  name: string;
  cost: number;
  marketValue: number;
  note: string;
  accountId: string | null;
  schedules: FundSchedule[];
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string;
  paymentDay: number;
  note: string;
}

export interface TrancheItem {
  id: string;
  seq: number;
  triggerPrice: number;
  amount: number;
  status: 'pending' | 'filled';
  filledDate: string | null;
  alertedAt: string | null;
}

export interface TranchePlan {
  id: string;
  code: string;
  note: string;
  createdAt: number;
  items: TrancheItem[];
}

export interface FifoResult {
  realizedPnL: number;
  holdingShares: number;
  avgCost: number;
  results: { id: string; realized: number | null; tax: number }[];
  /** buy lots still (partially) held, in FIFO order */
  openLots: { id: string; shares: number; unitCost: number }[];
  /** FIFO buy→sell pairings: pnl/cost of each consumed lot portion */
  allocations: { buyId: string; sellId: string; shares: number; pnl: number; cost: number }[];
}
