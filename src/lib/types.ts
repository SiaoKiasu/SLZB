export type Source = "demo" | "binance";
export type Balance = { asset: string; free: string; locked: string };
export type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string };
export type Trade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: string;
  quantity: string;
  quoteQuantity: string;
  fee: string;
  feeAsset: string;
  time: number;
  isMaker: boolean;
};
export type Order = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: string;
  quantity: string;
  executedQuantity: string;
  status: string;
  time: number;
};
export type Holding = Balance & {
  quantity: string;
  price: string | null;
  value: string | null;
  allocation: number;
  change24h: number | null;
  averageCost: string | null;
  unrealizedPnl: string | null;
};
export type Snapshot = { time: number; equity: string };
export type MarketLedger = {
  baseAsset: string;
  quoteAsset: string;
  nextId: string;
  complete: boolean;
  checkedAt: number;
  trades: Trade[];
};
export type TradeLedger = { version: 1; markets: Record<string, MarketLedger> };
export type HistorySync = { scanned: number; total: number; oldestCheck: number | null };
export type ProviderData = {
  spotEquity?: string | null;
  ledger?: TradeLedger;
  historySync?: HistorySync;

  balances: Balance[];
  tickers: Ticker[];
  trades: Trade[];
  orders: Order[];
  warnings: string[];
  tradesComplete: boolean;
  ordersComplete: boolean;
};
export type Dashboard = {
  source: Source;
  accountLabel: string;
  environment: string;
  updatedAt: number;
  holdings: Holding[];
  trades: Trade[];
  orders: Order[];
  history: Snapshot[];
  summary: {
    equity: string;
    equitySource: "exchange" | "calculated";
    equityComplete: boolean;
    pricedAssets: number;
    unpricedAssets: number;
    unrealizedPnl: string | null;
    costCoverage: number;
    totalPnl: string | null;
    realizedPnl: string | null;
    realizedPnlNote: string;
    principal: string | null;
    cash: string;
    cashFree: string;
    cashLocked: string;
    baseline: string | null;
    baselineAt: string | null;
    netFlows: string | null;
    stablecoinValue: string;
    tradeCount: number;
  };
  connection: {
    historySync: HistorySync;
    database: boolean;
    snapshotsSaved: boolean;
    symbols: string[];
    tradesComplete: boolean;
    ordersComplete: boolean;
  };
  warnings: string[];
};
