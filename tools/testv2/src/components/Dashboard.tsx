import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { PAIRS, TIMEFRAMES, SIGNAL_LABELS, TF_COLORS, SETUP_COMBOS } from '../constants';
import { Timeframe, Pair, SignalCode, Direction } from '../types';
import { cn } from '../utils/cn';

export default function Dashboard() {
  const { cellSignals, matchedSetups, refreshAllSignals, clearAllSignals, selectedCell, setSelectedCell } = useStore();
  
  useEffect(() => {
    refreshAllSignals();
  }, []);
  
  const getSignalsForCell = (pair: Pair, tf: Timeframe): { code: SignalCode; direction: Direction }[] => {
    return cellSignals[pair]?.[tf] || [];
  };
  
  const getSetupForPair = (pair: Pair) => {
    return matchedSetups.filter(s => s.pair === pair);
  };
  
  const getDirectionBadge = (dir: Direction | null) => {
    if (!dir) return null;
    const isBuy = dir === 'BUY';
    return (
      <span className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold',
        isBuy ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
      )}>
        {isBuy ? '▲' : '▼'} {dir}
      </span>
    );
  };
  
  const getSetupBadge = (type: string | null) => {
    if (!type) return null;
    const colors: Record<string, string> = {
      'SWING': 'bg-indigo-100 text-indigo-700 border-indigo-300',
      'INTRADAY': 'bg-cyan-100 text-cyan-700 border-cyan-300',
      'SCALPING': 'bg-amber-100 text-amber-700 border-amber-300',
    };
    return (
      <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border', colors[type] || 'bg-gray-100')}>
        {type}
      </span>
    );
  };
  
  return (
    <div className="w-full">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1">
        <div>
          <h2 className="text-lg font-bold text-slate-800">BBMA MTF Dashboard</h2>
          <p className="text-xs text-slate-500">Multi-Timeframe Signal Matrix — Oma Ally</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshAllSignals}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={clearAllSignals}
            className="px-3 py-1.5 text-xs font-medium bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-1.5 mb-3 px-1">
        {Object.entries(SIGNAL_LABELS).map(([code, info]) => (
          <div key={code} className="flex items-center gap-1 text-[10px] bg-white/80 rounded px-1.5 py-0.5 border border-slate-200">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
            <span className="font-semibold text-slate-700">{code}</span>
          </div>
        ))}
      </div>
      
      {/* Matched Setups Alerts */}
      {matchedSetups.length > 0 && (
        <div className="mb-3 px-1 space-y-1">
          {matchedSetups.map((setup, i) => (
            <div key={i} className={cn(
              'flex items-center gap-2 text-xs px-3 py-2 rounded-lg border',
              setup.direction === 'BUY' 
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : setup.direction === 'SELL'
                ? 'bg-red-50 border-red-300 text-red-800'
                : 'bg-slate-50 border-slate-300 text-slate-800'
            )}>
              <span className="font-bold">{setup.pair}</span>
              {getSetupBadge(setup.type)}
              <span>{setup.tf1}<span className="text-[10px] mx-0.5">●</span>{setup.tf2}<span className="text-[10px] mx-0.5">●</span>{setup.tf3}</span>
              <span className="font-mono text-[10px] bg-white/60 px-1.5 py-0.5 rounded">
                {setup.tf1Signal} → {setup.tf2Signal} → {setup.tf3Signal}
              </span>
              {getDirectionBadge(setup.direction)}
              <button
                onClick={() => {
                  import('../store/useStore').then(m => {
                    const id = `entry-${Date.now()}`;
                    const entryPrice = setup.direction === 'BUY' ? 100 : 100;
                    m.useStore.getState().addJournalEntry({
                      id,
                      pair: setup.pair,
                      setup,
                      entryPrice,
                      tpPrice: setup.direction === 'BUY' ? entryPrice * 1.02 : entryPrice * 0.98,
                      slPrice: setup.direction === 'BUY' ? entryPrice * 0.99 : entryPrice * 1.01,
                      entryTime: new Date().toISOString(),
                      notes: '',
                      images: [],
                      createdAt: Date.now(),
                    });
                  });
                }}
                className="ml-auto px-2 py-0.5 text-[10px] bg-white border border-current rounded hover:opacity-80 font-semibold"
              >
                + Journal
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Dashboard Grid — scrollable horizontally on mobile */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="min-w-[900px]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="sticky left-0 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-600 border-b border-r border-slate-200 z-10 min-w-[90px]">
                  Pair / TF
                </th>
                {TIMEFRAMES.map(tf => (
                  <th
                    key={tf}
                    className="px-2 py-2 text-center font-semibold border-b border-slate-200 min-w-[72px]"
                    style={{ color: TF_COLORS[tf] }}
                  >
                    {tf}
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-semibold text-slate-600 border-b border-slate-200 min-w-[130px]">
                  Setup
                </th>
              </tr>
            </thead>
            <tbody>
              {PAIRS.map((pair, pi) => (
                <tr key={pair} className={cn(
                  'hover:bg-slate-50 transition-colors',
                  pi % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                )}>
                  <td className="sticky left-0 bg-inherit px-3 py-2 font-semibold text-slate-700 border-r border-slate-200 z-10 whitespace-nowrap">
                    {pair}
                  </td>
                  {TIMEFRAMES.map(tf => {
                    const signals = getSignalsForCell(pair, tf);
                    const isSelected = selectedCell?.pair === pair && selectedCell?.timeframe === tf;
                    return (
                      <td
                        key={tf}
                        onClick={() => setSelectedCell({ pair, timeframe: tf })}
                        className={cn(
                          'px-2 py-2 text-center border border-slate-100 cursor-pointer transition-all',
                          isSelected && 'ring-2 ring-blue-400 ring-inset bg-blue-50/50'
                        )}
                      >
                        <div className="flex flex-wrap justify-center gap-0.5">
                          {signals.length === 0 ? (
                            <span className="text-slate-300 text-[10px]">—</span>
                          ) : (
                            signals.map((s, i) => {
                              const info = SIGNAL_LABELS[s.code];
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold leading-none"
                                  style={{ backgroundColor: info.bg, color: info.color }}
                                  title={`${info.description} | ${s.direction}`}
                                >
                                  {s.direction === 'BUY' ? '▲' : s.direction === 'SELL' ? '▼' : ''}
                                  {s.code}
                                </span>
                              );
                            })
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center border border-slate-100">
                    <div className="flex flex-wrap justify-center gap-0.5">
                      {getSetupForPair(pair).map((s, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          {getDirectionBadge(s.direction)}
                          {getSetupBadge(s.type)}
                        </div>
                      ))}
                      {getSetupForPair(pair).length === 0 && (
                        <span className="text-slate-300 text-[10px]">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Setup Combination Reference */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 px-1">
        {SETUP_COMBOS.map(combo => (
          <div key={combo.type} className="bg-white/80 border border-slate-200 rounded-lg px-3 py-2 text-xs">
            <span className="font-bold text-slate-700">{combo.type}</span>
            <span className="text-slate-500 ml-2">{combo.tf1} RE → {combo.tf2} RJ/RJB → {combo.tf3} RE/EXT/MHV</span>
          </div>
        ))}
      </div>
    </div>
  );
}
