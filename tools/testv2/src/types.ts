export type Timeframe = 'W1' | 'D1' | 'H4' | 'H1' | 'M15' | 'M5' | 'M1';
export type Pair = string;
export type Direction = 'BUY' | 'SELL' | null;
export type SetupType = 'SWING' | 'INTRADAY' | 'SCALPING' | null;

export type SignalCode = 
  | 'RE'    // Reentry
  | 'RJ'    // Reject EMA 50
  | 'RJB'   // Reject EMA 50 + BB
  | 'MHV'   // Market Hilang Volume
  | 'EXT'   // Extreme
  | 'CSA'   // Candlestick Arah
  | 'CSAK'  // Candlestick Arah Kukuh
  | 'MOM'   // Momentum
  | 'TPW';  // Take Profit Wajib

export type SignalStatus = 'ACTIVE' | 'INACTIVE';

export interface CellSignal {
  code: SignalCode;
  direction: Direction;
  active: boolean;
  timestamp: number;
}

export interface DashboardCell {
  pair: Pair;
  timeframe: Timeframe;
  signals: SignalCode[];
  direction: Direction;
}

export interface MatchedSetup {
  type: SetupType;
  direction: Direction;
  tf1: Timeframe;
  tf2: Timeframe;
  tf3: Timeframe;
  tf1Signal: SignalCode;
  tf2Signal: SignalCode;
  tf3Signal: SignalCode;
  pair: Pair;
  entryPrice?: number;
  tpPrice?: number;
  slPrice?: number;
  timestamp: number;
}

export interface JournalEntry {
  id: string;
  pair: Pair;
  setup: MatchedSetup;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  notes: string;
  images: JournalImage[];
  createdAt: number;
}

export interface JournalImage {
  id: string;
  dataUrl: string;
  label: string;
  timeframe: Timeframe;
  type: 'before' | 'after' | 'tf_chart';
}

export interface DashboardState {
  cells: Record<string, Record<Timeframe, CellSignal[]>>;
  matchedSetups: MatchedSetup[];
  journalEntries: JournalEntry[];
  selectedPair: Pair | null;
  selectedTimeframe: Timeframe | null;
}
