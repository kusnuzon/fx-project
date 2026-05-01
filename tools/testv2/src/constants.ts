import { Pair, Timeframe, SignalCode, SetupType } from './types';

export const TIMEFRAMES: Timeframe[] = ['W1', 'D1', 'H4', 'H1', 'M15', 'M5', 'M1'];

export const PAIRS: Pair[] = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF',
  'NZD/USD', 'USD/CAD', 'EUR/JPY', 'GBP/JPY', 'EUR/GBP',
  'EUR/AUD', 'GBP/AUD', 'AUD/JPY', 'XAU/USD', 'BTC/USD',
];

export const SIGNAL_LABELS: Record<SignalCode, { label: string; color: string; bg: string; description: string }> = {
  'EXT':  { label: 'EXT',  color: '#ef4444', bg: '#fef2f2', description: 'Extreme - Harga keluar BB' },
  'TPW':  { label: 'TPW',  color: '#f59e0b', bg: '#fffbeb', description: 'Take Profit Wajib' },
  'MHV':  { label: 'MHV',  color: '#8b5cf6', bg: '#f5f3ff', description: 'Market Hilang Volume' },
  'CSA':  { label: 'CSA',  color: '#06b6d4', bg: '#ecfeff', description: 'Candlestick Arah' },
  'CSAK': { label: 'CSAK', color: '#10b981', bg: '#ecfdf5', description: 'Candlestick Arah Kukuh' },
  'MOM':  { label: 'MOM',  color: '#f97316', bg: '#fff7ed', description: 'Momentum - Candle pecah BB' },
  'RE':   { label: 'RE',   color: '#3b82f6', bg: '#eff6ff', description: 'Reentry - Harga sentuh WMA 5/10' },
  'RJ':   { label: 'RJ',   color: '#ec4899', bg: '#fdf2f8', description: 'Reject EMA 50' },
  'RJB':  { label: 'RJB',  color: '#a855f7', bg: '#faf5ff', description: 'Reject EMA 50 + BB' },
};

export const SETUP_COMBOS: { type: SetupType; tf1: Timeframe; tf2: Timeframe; tf3: Timeframe }[] = [
  { type: 'SWING',     tf1: 'D1', tf2: 'H4', tf3: 'H1' },
  { type: 'INTRADAY',  tf1: 'H4', tf2: 'H1', tf3: 'M15' },
  { type: 'SCALPING',  tf1: 'H1', tf2: 'M15', tf3: 'M5' },
];

export const TF_COLORS: Record<Timeframe, string> = {
  'W1':  '#dc2626',
  'D1':  '#ea580c',
  'H4':  '#ca8a04',
  'H1':  '#16a34a',
  'M15': '#2563eb',
  'M5':  '#7c3aed',
  'M1':  '#db2777',
};
