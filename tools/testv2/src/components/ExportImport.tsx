import { useState, useRef } from 'react';
import { useStore } from '../store/useStore';

export default function ExportImport() {
  const { exportData, importData, refreshAllSignals } = useStore();
  const [importMsg, setImportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleExportJSON = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bbma-oma-ally-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const handleExportBase64 = () => {
    const json = exportData();
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const blob = new Blob([base64], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bbma-oma-ally-backup-${new Date().toISOString().slice(0, 10)}.b64`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      let content = reader.result as string;
      
      // Try base64 decode if not valid JSON
      try {
        JSON.parse(content);
      } catch {
        try {
          content = decodeURIComponent(escape(atob(content.trim())));
        } catch {
          // not base64, try raw
        }
      }
      
      const success = importData(content);
      if (success) {
        refreshAllSignals();
        setImportMsg({ type: 'success', text: 'Data imported successfully!' });
      } else {
        setImportMsg({ type: 'error', text: 'Invalid file format. Please check your backup file.' });
      }
      setTimeout(() => setImportMsg(null), 3000);
    };
    reader.readAsText(file);
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Export / Import Data</h3>
      
      {importMsg && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${
          importMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {importMsg.text}
        </div>
      )}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Export */}
        <div className="bg-slate-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </h4>
          <p className="text-[10px] text-slate-500 mb-2">
            Save all dashboard signals, matched setups, and journal entries
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleExportJSON}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              JSON
            </button>
            <button
              onClick={handleExportBase64}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              Base64
            </button>
          </div>
        </div>
        
        {/* Import */}
        <div className="bg-slate-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import
          </h4>
          <p className="text-[10px] text-slate-500 mb-2">
            Restore from JSON or Base64 backup file
          </p>
          <label className="block w-full px-3 py-1.5 text-[11px] font-medium bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors cursor-pointer text-center">
            Choose File
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.b64,.txt"
              className="hidden"
              onChange={handleImport}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
