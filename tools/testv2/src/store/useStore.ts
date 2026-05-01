import { create } from 'zustand';
import { Timeframe, Pair, SignalCode, Direction, MatchedSetup, JournalEntry, JournalImage, SetupType } from '../types';
import { PAIRS, TIMEFRAMES } from '../constants';
import { detectSignals, matchMTFSetup, generateMockPrice } from '../engine/bbmaEngine';

interface AppState {
  // Dashboard cells: pair -> timeframe -> signals[]
  cellSignals: Record<Pair, Record<Timeframe, { code: SignalCode; direction: Direction }[]>>;
  matchedSetups: MatchedSetup[];
  journalEntries: JournalEntry[];
  
  // UI state
  activeTab: 'dashboard' | 'journal' | 'about';
  selectedCell: { pair: Pair; timeframe: Timeframe } | null;
  
  // Actions
  refreshAllSignals: () => void;
  refreshSignalsForPair: (pair: Pair) => void;
  clearAllSignals: () => void;
  addJournalEntry: (entry: JournalEntry) => void;
  updateJournalEntry: (id: string, updates: Partial<JournalEntry>) => void;
  deleteJournalEntry: (id: string) => void;
  addImageToEntry: (entryId: string, image: JournalImage) => void;
  removeImageFromEntry: (entryId: string, imageId: string) => void;
  setActiveTab: (tab: 'dashboard' | 'journal' | 'about') => void;
  setSelectedCell: (cell: { pair: Pair; timeframe: Timeframe } | null) => void;
  
  // Export/Import
  exportData: () => string;
  importData: (json: string) => boolean;
}

export const useStore = create<AppState>((set, get) => ({
  cellSignals: {},
  matchedSetups: [],
  journalEntries: [],
  activeTab: 'dashboard',
  selectedCell: null,
  
  refreshAllSignals: () => {
    const newSignals: Record<Pair, Record<Timeframe, { code: SignalCode; direction: Direction }[]>> = {};
    
    for (const pair of PAIRS) {
      newSignals[pair] = {} as Record<Timeframe, { code: SignalCode; direction: Direction }[]>;
      for (const tf of TIMEFRAMES) {
        const priceData = generateMockPrice(pair, tf);
        newSignals[pair][tf] = detectSignals(pair, tf, priceData);
      }
    }
    
    // Match MTF setups
    const allSetups: MatchedSetup[] = [];
    for (const pair of PAIRS) {
      const setups = matchMTFSetup(pair, newSignals[pair]);
      allSetups.push(...setups);
    }
    
    set({ cellSignals: newSignals, matchedSetups: allSetups });
  },
  
  refreshSignalsForPair: (pair: Pair) => {
    const current = get().cellSignals;
    const newPairSignals: Record<Timeframe, { code: SignalCode; direction: Direction }[]> = {} as Record<Timeframe, { code: SignalCode; direction: Direction }[]>;
    
    for (const tf of TIMEFRAMES) {
      const priceData = generateMockPrice(pair, tf);
      newPairSignals[tf] = detectSignals(pair, tf, priceData);
    }
    
    const updated = { ...current, [pair]: newPairSignals };
    const allSetups: MatchedSetup[] = [];
    for (const p of PAIRS) {
      const setups = matchMTFSetup(p, updated[p] || ({} as Record<Timeframe, { code: SignalCode; direction: Direction }[]>));
      allSetups.push(...setups);
    }
    
    set({ cellSignals: updated, matchedSetups: allSetups });
  },
  
  clearAllSignals: () => {
    const empty: Record<Pair, Record<Timeframe, { code: SignalCode; direction: Direction }[]>> = {};
    for (const pair of PAIRS) {
      empty[pair] = {} as Record<Timeframe, { code: SignalCode; direction: Direction }[]>;
      for (const tf of TIMEFRAMES) {
        empty[pair][tf] = [];
      }
    }
    set({ cellSignals: empty, matchedSetups: [] });
  },
  
  addJournalEntry: (entry) => {
    set(s => ({ journalEntries: [entry, ...s.journalEntries] }));
  },
  
  updateJournalEntry: (id, updates) => {
    set(s => ({
      journalEntries: s.journalEntries.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  },
  
  deleteJournalEntry: (id) => {
    set(s => ({
      journalEntries: s.journalEntries.filter(e => e.id !== id),
    }));
  },
  
  addImageToEntry: (entryId, image) => {
    set(s => ({
      journalEntries: s.journalEntries.map(e =>
        e.id === entryId ? { ...e, images: [...e.images, image] } : e
      ),
    }));
  },
  
  removeImageFromEntry: (entryId, imageId) => {
    set(s => ({
      journalEntries: s.journalEntries.map(e =>
        e.id === entryId ? { ...e, images: e.images.filter(img => img.id !== imageId) } : e
      ),
    }));
  },
  
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCell: (cell) => set({ selectedCell: cell }),
  
  exportData: () => {
    const state = get();
    const data = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      cellSignals: state.cellSignals,
      matchedSetups: state.matchedSetups,
      journalEntries: state.journalEntries,
    };
    return JSON.stringify(data, null, 2);
  },
  
  importData: (json: string) => {
    try {
      const data = JSON.parse(json);
      if (data.version && data.cellSignals) {
        set({
          cellSignals: data.cellSignals,
          matchedSetups: data.matchedSetups || [],
          journalEntries: data.journalEntries || [],
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
