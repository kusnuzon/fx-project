import { SignalCode, Direction, Timeframe, MatchedSetup, SetupType } from '../types';
import { SETUP_COMBOS, SIGNAL_LABELS } from '../constants';

/**
 * Detects individual signals per timeframe for a given pair.
 * In production, this would read real price data. Here we simulate
 * with rules-based logic on mock price data.
 */
export function detectSignals(
  pair: string,
  timeframe: Timeframe,
  priceData: { open: number; high: number; low: number; close: number; volume: number; bbTop: number; bbMid: number; bbLow: number; wma5High: number; wma10High: number; wma5Low: number; wma10Low: number; ema50: number } | null
): { code: SignalCode; direction: Direction }[] {
  if (!priceData) return [];
  
  const signals: { code: SignalCode; direction: Direction }[] = [];
  const { high, low, close, bbTop, bbMid, bbLow, wma5High, wma10High, wma5Low, wma10Low, ema50, open } = priceData;
  
  const isAboveEMA50 = close > ema50;
  const isBelowEMA50 = close < ema50;
  const brokeAboveBB = high > bbTop;
  const brokeBelowBB = low < bbLow;
  const closeAboveBB = close > bbTop;
  const closeBelowBB = close < bbLow;
  const closeAboveMid = close > bbMid;
  const closeBelowMid = close < bbMid;
  
  // Direction bias from EMA50
  const bias: Direction = isAboveEMA50 ? 'BUY' : isBelowEMA50 ? 'SELL' : null;
  
  // EXTREME - WMA 5 or 10 breaks outside BB
  if (brokeAboveBB && (wma5High > bbTop || wma10High > bbTop)) {
    signals.push({ code: 'EXT', direction: 'SELL' });
  }
  if (brokeBelowBB && (wma5Low < bbLow || wma10Low < bbLow)) {
    signals.push({ code: 'EXT', direction: 'BUY' });
  }
  
  // MOMENTUM - candle body closes outside BB
  if (closeAboveBB) {
    signals.push({ code: 'MOM', direction: 'SELL' });
  }
  if (closeBelowBB) {
    signals.push({ code: 'MOM', direction: 'BUY' });
  }
  
  // MHV - wick touches BB but body stays inside
  if (brokeAboveBB && !closeAboveBB) {
    signals.push({ code: 'MHV', direction: 'SELL' });
  }
  if (brokeBelowBB && !closeBelowBB) {
    signals.push({ code: 'MHV', direction: 'BUY' });
  }
  
  // TPW - price pulled back from extreme towards WMA
  const prevExtreme = false; // would check history
  if (prevExtreme && close > wma5High && close < wma10High) {
    signals.push({ code: 'TPW', direction: 'BUY' });
  }
  if (prevExtreme && close < wma5Low && close > wma10Low) {
    signals.push({ code: 'TPW', direction: 'SELL' });
  }
  
  // REENTRY - price touches WMA 5/10 area
  const touchWMAHigh = high >= wma5High * 0.998 && high <= wma10High * 1.002;
  const touchWMALow = low <= wma5Low * 1.002 && low >= wma10Low * 0.998;
  
  if (touchWMAHigh && isAboveEMA50) {
    signals.push({ code: 'RE', direction: 'BUY' });
  }
  if (touchWMALow && isBelowEMA50) {
    signals.push({ code: 'RE', direction: 'SELL' });
  }
  
  // CSA / CSAK - candle crosses mid BB and/or EMA50
  if (closeAboveMid && open < bbMid) {
    if (close > ema50 && open < ema50) {
      signals.push({ code: 'CSAK', direction: 'BUY' });
    } else {
      signals.push({ code: 'CSA', direction: 'BUY' });
    }
  }
  if (closeBelowMid && open > bbMid) {
    if (close < ema50 && open > ema50) {
      signals.push({ code: 'CSAK', direction: 'SELL' });
    } else {
      signals.push({ code: 'CSA', direction: 'SELL' });
    }
  }
  
  // RJ - Reject EMA 50 (price touches EMA50 and bounces)
  const touchEMA50High = low <= ema50 * 1.002 && high >= ema50 * 0.998;
  const touchEMA50Low = high >= ema50 * 0.998 && low <= ema50 * 1.002;
  
  if (touchEMA50High && isAboveEMA50 && close > open) {
    signals.push({ code: 'RJ', direction: 'BUY' });
  }
  if (touchEMA50Low && isBelowEMA50 && close < open) {
    signals.push({ code: 'RJ', direction: 'SELL' });
  }
  
  // RJB - Reject EMA 50 + BB simultaneously
  const touchBBTop = high >= bbTop * 0.995;
  const touchBBLow = low <= bbLow * 1.005;
  
  if (touchEMA50High && touchBBLow && isAboveEMA50) {
    signals.push({ code: 'RJB', direction: 'BUY' });
  }
  if (touchEMA50Low && touchBBTop && isBelowEMA50) {
    signals.push({ code: 'RJB', direction: 'SELL' });
  }
  
  return signals;
}

/**
 * Match signals across 3 timeframes to find complete setups
 */
export function matchMTFSetup(
  pair: string,
  cellSignals: Record<Timeframe, { code: SignalCode; direction: Direction }[]>
): MatchedSetup[] {
  const matched: MatchedSetup[] = [];
  
  for (const combo of SETUP_COMBOS) {
    const tf1Signals = cellSignals[combo.tf1] || [];
    const tf2Signals = cellSignals[combo.tf2] || [];
    const tf3Signals = cellSignals[combo.tf3] || [];
    
    const reTf1 = tf1Signals.filter(s => s.code === 'RE');
    const rejTf2 = tf2Signals.filter(s => s.code === 'RJ' || s.code === 'RJB');
    const entryTf3 = tf3Signals.filter(s => ['RE', 'EXT', 'MHV'].includes(s.code));
    
    for (const s1 of reTf1) {
      for (const s2 of rejTf2) {
        if (s1.direction === s2.direction) {
          for (const s3 of entryTf3) {
            if (s3.direction === s1.direction) {
              const setup: MatchedSetup = {
                type: combo.type,
                direction: s1.direction,
                tf1: combo.tf1,
                tf2: combo.tf2,
                tf3: combo.tf3,
                tf1Signal: s1.code,
                tf2Signal: s2.code,
                tf3Signal: s3.code,
                pair,
                timestamp: Date.now(),
              };
              matched.push(setup);
            }
          }
        }
      }
    }
  }
  
  return matched;
}

/**
 * Generate mock price data for simulation
 */
export function generateMockPrice(pair: string, timeframe: Timeframe): {
  open: number; high: number; low: number; close: number; volume: number;
  bbTop: number; bbMid: number; bbLow: number;
  wma5High: number; wma10High: number; wma5Low: number; wma10Low: number;
  ema50: number;
} {
  const seed = pair.length * 7 + timeframe.length * 13;
  const base = seed % 200 + 100;
  const volatility = timeframe === 'W1' ? 0.08 : timeframe === 'D1' ? 0.04 : timeframe === 'H4' ? 0.02 : timeframe === 'H1' ? 0.012 : timeframe === 'M15' ? 0.006 : timeframe === 'M5' ? 0.003 : 0.0015;
  
  const pseudoRandom = (s: number) => {
    const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  
  const r = pseudoRandom(seed + Date.now() % 1000 * 0.001);
  const close = base * (1 + (r - 0.5) * volatility * 4);
  const open = close * (1 + (pseudoRandom(seed + 1) - 0.5) * volatility * 2);
  const high = Math.max(open, close) * (1 + pseudoRandom(seed + 2) * volatility);
  const low = Math.min(open, close) * (1 - pseudoRandom(seed + 3) * volatility);
  
  const bbMid = base;
  const bbWidth = base * volatility * 2.5;
  const bbTop = bbMid + bbWidth;
  const bbLow = bbMid - bbWidth;
  
  const wma5High = bbMid + bbWidth * 0.55;
  const wma10High = bbMid + bbWidth * 0.45;
  const wma5Low = bbMid - bbWidth * 0.55;
  const wma10Low = bbMid - bbWidth * 0.45;
  
  const ema50 = bbMid * (1 + (pseudoRandom(seed + 99) - 0.5) * 0.03);
  
  return {
    open, high, low, close,
    volume: Math.floor(pseudoRandom(seed + 50) * 10000),
    bbTop, bbMid, bbLow,
    wma5High, wma10High, wma5Low, wma10Low,
    ema50,
  };
}
