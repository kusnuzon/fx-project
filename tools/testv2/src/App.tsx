import { useState } from 'react';
import { useStore } from './store/useStore';
import Dashboard from './components/Dashboard';
import Journal from './components/Journal';
import ExportImport from './components/ExportImport';
import About from './components/About';

export default function App() {
  const { activeTab, setActiveTab } = useStore();
  const [mobileMenu, setMobileMenu] = useState(false);
  
  const tabs = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: '⊞' },
    { id: 'journal' as const, label: 'Journal', icon: '📓' },
    { id: 'about' as const, label: 'Guide', icon: '📖' },
  ];
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-md shadow-indigo-200">
                <span className="text-white text-sm font-bold">BB</span>
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-slate-800 leading-tight">BBMA Oma Ally</h1>
                <p className="text-[9px] sm:text-[10px] text-slate-500 hidden sm:block">MTF Dashboard & Trading Journal</p>
              </div>
            </div>
            
            {/* Desktop Tabs */}
            <nav className="hidden sm:flex items-center gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="mr-1">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
            
            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenu(!mobileMenu)}
              className="sm:hidden p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={mobileMenu ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
          </div>
          
          {/* Mobile Tabs */}
          {mobileMenu && (
            <nav className="sm:hidden mt-2 flex gap-1 pb-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setMobileMenu(false); }}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <span className="mr-1">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-3 sm:px-4 py-3 sm:py-4">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'journal' && <Journal />}
        {activeTab === 'about' && <About />}
        
        {/* Export/Import always visible at bottom */}
        <div className="mt-4">
          <ExportImport />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="text-center py-4 text-[10px] text-slate-400 border-t border-slate-200 mt-6">
        BBMA Oma Ally — MTF Dashboard & Journal v1.0 | Multi-Timeframe Signal Matrix
      </footer>
    </div>
  );
}
