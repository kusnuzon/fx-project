import { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { JournalEntry, JournalImage, Timeframe } from '../types';
import html2canvas from 'html2canvas';

export default function Journal() {
  const { journalEntries, addJournalEntry, updateJournalEntry, deleteJournalEntry, addImageToEntry, removeImageFromEntry } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  
  // Form state
  const [formPair, setFormPair] = useState('');
  const [formEntry, setFormEntry] = useState('');
  const [formTp, setFormTp] = useState('');
  const [formSl, setFormSl] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDirection, setFormDirection] = useState<'BUY' | 'SELL'>('BUY');
  
  const resetForm = () => {
    setFormPair('');
    setFormEntry('');
    setFormTp('');
    setFormSl('');
    setFormNotes('');
    setFormDirection('BUY');
    setEditingId(null);
    setShowForm(false);
  };
  
  const handleSubmit = () => {
    if (!formPair || !formEntry) return;
    
    const entryPrice = parseFloat(formEntry);
    const tpPrice = parseFloat(formTp) || (formDirection === 'BUY' ? entryPrice * 1.02 : entryPrice * 0.98);
    const slPrice = parseFloat(formSl) || (formDirection === 'BUY' ? entryPrice * 0.99 : entryPrice * 1.01);
    
    const dummySetup = {
      type: null as any,
      direction: formDirection,
      tf1: 'H4' as Timeframe,
      tf2: 'H1' as Timeframe,
      tf3: 'M15' as Timeframe,
      tf1Signal: 'RE' as const,
      tf2Signal: 'RJB' as const,
      tf3Signal: 'MHV' as const,
      pair: formPair,
      timestamp: Date.now(),
    };
    
    if (editingId) {
      updateJournalEntry(editingId, {
        pair: formPair,
        entryPrice,
        tpPrice,
        slPrice,
        notes: formNotes,
        entryTime: new Date().toISOString(),
      });
    } else {
      const entry: JournalEntry = {
        id: `j-${Date.now()}`,
        pair: formPair,
        setup: dummySetup,
        entryPrice,
        tpPrice,
        slPrice,
        entryTime: new Date().toISOString(),
        notes: formNotes,
        images: [],
        createdAt: Date.now(),
      };
      addJournalEntry(entry);
    }
    resetForm();
  };
  
  const handleEdit = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setFormPair(entry.pair);
    setFormEntry(String(entry.entryPrice));
    setFormTp(String(entry.tpPrice));
    setFormSl(String(entry.slPrice));
    setFormNotes(entry.notes);
    setFormDirection(entry.setup.direction || 'BUY');
    setShowForm(true);
  };
  
  const handleExportImage = async (entryId: string) => {
    setTimeout(async () => {
      const el = document.getElementById(`journal-entry-${entryId}`);
      if (el && exportRef.current) {
        try {
          const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
          const dataUrl = canvas.toDataURL('image/png');
          
          // Add as image to entry
          const image: JournalImage = {
            id: `img-${Date.now()}`,
            dataUrl,
            label: 'Export',
            timeframe: 'H1',
            type: 'tf_chart',
          };
          addImageToEntry(entryId, image);
          
          // Also download
          const link = document.createElement('a');
          link.download = `bbma-journal-${entryId}.png`;
          link.href = dataUrl;
          link.click();
        } catch (e) {
          console.error('Export failed:', e);
        }
      }
    }, 100);
  };
  
  const handleImageUpload = (entryId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const image: JournalImage = {
        id: `img-${Date.now()}`,
        dataUrl,
        label: file.name.replace(/\.[^/.]+$/, ''),
        timeframe: 'H1',
        type: 'tf_chart',
      };
      addImageToEntry(entryId, image);
    };
    reader.readAsDataURL(file);
  };
  
  const handleClosePosition = (entry: JournalEntry) => {
    const exitPrice = entry.setup.direction === 'BUY' 
      ? entry.entryPrice * 1.015 
      : entry.entryPrice * 0.985;
    const pnl = entry.setup.direction === 'BUY'
      ? exitPrice - entry.entryPrice
      : entry.entryPrice - exitPrice;
    const pnlPercent = (pnl / entry.entryPrice) * 100;
    
    updateJournalEntry(entry.id, {
      exitPrice,
      exitTime: new Date().toISOString(),
      pnl,
      pnlPercent,
    });
  };
  
  const totalPnl = journalEntries.reduce((sum, e) => sum + (e.pnl || 0), 0);
  const winCount = journalEntries.filter(e => (e.pnl || 0) > 0).length;
  const lossCount = journalEntries.filter(e => (e.pnl || 0) < 0).length;
  const winRate = journalEntries.length > 0 ? ((winCount / journalEntries.length) * 100).toFixed(1) : '0';
  
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Trading Journal</h2>
          <p className="text-xs text-slate-500">BBMA Oma Ally — Entry/Exit Records</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Entry
        </button>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 px-1">
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
          <div className="text-[10px] text-slate-500 uppercase">Total Trades</div>
          <div className="text-lg font-bold text-slate-800">{journalEntries.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
          <div className="text-[10px] text-slate-500 uppercase">Win Rate</div>
          <div className="text-lg font-bold text-slate-800">{winRate}%</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
          <div className="text-[10px] text-slate-500 uppercase">W / L</div>
          <div className="text-lg font-bold text-slate-800">
            <span className="text-emerald-600">{winCount}</span>
            <span className="text-slate-400"> / </span>
            <span className="text-red-500">{lossCount}</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
          <div className="text-[10px] text-slate-500 uppercase">Total PnL</div>
          <div className={`text-lg font-bold ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </div>
        </div>
      </div>
      
      {/* Entry Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            {editingId ? 'Edit Entry' : 'New Journal Entry'}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Pair</label>
              <input
                type="text"
                value={formPair}
                onChange={e => setFormPair(e.target.value)}
                placeholder="EUR/USD"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Direction</label>
              <select
                value={formDirection}
                onChange={e => setFormDirection(e.target.value as 'BUY' | 'SELL')}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Entry Price</label>
              <input
                type="number"
                step="any"
                value={formEntry}
                onChange={e => setFormEntry(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">TP (Hi/Low BB)</label>
              <input
                type="number"
                step="any"
                value={formTp}
                onChange={e => setFormTp(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Stop Loss</label>
              <input
                type="number"
                step="any"
                value={formSl}
                onChange={e => setFormSl(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-end gap-1">
              <button
                onClick={handleSubmit}
                className="w-full px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {editingId ? 'Update' : 'Save'}
              </button>
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-xs font-medium bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Notes</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none resize-none"
              placeholder="Add notes about this trade..."
            />
          </div>
        </div>
      )}
      
      {/* Entries List */}
      <div className="space-y-3 px-1" ref={exportRef}>
        {journalEntries.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm">No journal entries yet</p>
            <p className="text-xs mt-1">Click "New Entry" or add from Dashboard setups</p>
          </div>
        )}
        
        {journalEntries.map(entry => (
          <div
            key={entry.id}
            id={`journal-entry-${entry.id}`}
            className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
              entry.pnl !== undefined 
                ? entry.pnl > 0 ? 'border-emerald-300' : 'border-red-300'
                : 'border-slate-200'
            }`}
          >
            <div className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm">{entry.pair}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    entry.setup.direction === 'BUY' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {entry.setup.direction === 'BUY' ? '▲ BUY' : '▼ SELL'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(entry.entryTime).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleExportImage(entry.id)}
                    className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                    title="Export as image"
                  >
                    📸
                  </button>
                  <button
                    onClick={() => handleEdit(entry)}
                    className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteJournalEntry(entry.id)}
                    className="px-2 py-0.5 text-[10px] bg-red-50 text-red-500 rounded hover:bg-red-100"
                  >
                    🗑
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                <div className="bg-slate-50 rounded-lg px-2 py-1 text-center">
                  <div className="text-[9px] text-slate-500">Entry</div>
                  <div className="text-xs font-bold text-slate-800">{entry.entryPrice.toFixed(5)}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg px-2 py-1 text-center">
                  <div className="text-[9px] text-emerald-600">TP (BB)</div>
                  <div className="text-xs font-bold text-emerald-700">{entry.tpPrice.toFixed(5)}</div>
                </div>
                <div className="bg-red-50 rounded-lg px-2 py-1 text-center">
                  <div className="text-[9px] text-red-500">SL</div>
                  <div className="text-xs font-bold text-red-600">{entry.slPrice.toFixed(5)}</div>
                </div>
                {entry.exitPrice !== undefined ? (
                  <div className={`rounded-lg px-2 py-1 text-center ${
                    (entry.pnl || 0) >= 0 ? 'bg-emerald-100' : 'bg-red-100'
                  }`}>
                    <div className="text-[9px] text-slate-600">PnL</div>
                    <div className={`text-xs font-bold ${
                      (entry.pnl || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}>
                      {(entry.pnl || 0) >= 0 ? '+' : ''}{entry.pnl?.toFixed(2)} ({(entry.pnlPercent || 0) >= 0 ? '+' : ''}{entry.pnlPercent?.toFixed(2)}%)
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 rounded-lg px-2 py-1 text-center">
                    <div className="text-[9px] text-amber-600">Active</div>
                    <button
                      onClick={() => handleClosePosition(entry)}
                      className="text-[10px] font-medium text-amber-700 hover:text-amber-900 underline"
                    >
                      Close Position
                    </button>
                  </div>
                )}
              </div>
              
              {entry.notes && (
                <p className="text-xs text-slate-600 mb-2 bg-slate-50 rounded-lg px-2 py-1.5">{entry.notes}</p>
              )}
              
              {/* Images */}
              {entry.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {entry.images.map(img => (
                    <div key={img.id} className="relative group">
                      <img
                        src={img.dataUrl}
                        alt={img.label}
                        className="h-20 w-auto rounded-lg border border-slate-200 object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] px-1 py-0.5 rounded-b-lg truncate">
                        {img.label}
                      </div>
                      <button
                        onClick={() => removeImageFromEntry(entry.id, img.id)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Image upload for this entry */}
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Upload Chart
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleImageUpload(entry.id, e)}
                  />
                </label>
                <span className="text-[9px] text-slate-400">Before/After/TF screenshots</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
