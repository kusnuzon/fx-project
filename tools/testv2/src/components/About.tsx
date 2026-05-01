import { SIGNAL_LABELS } from '../constants';
import { SignalCode } from '../types';

export default function About() {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-1">BBMA Oma Ally — Panduan Mekanik</h2>
          <p className="text-xs text-slate-500">Siklus mekanik lengkap berdasarkan referensi Oma Ally</p>
        </div>
        
        {/* Komponen Utama */}
        <div>
          <h3 className="text-sm font-bold text-indigo-700 mb-2">1. Komponen Utama (Alat Kerja)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-xs font-bold text-amber-800 mb-1">Bollinger Bands (BB)</div>
              <ul className="text-[10px] text-amber-700 space-y-0.5">
                <li>• Top/Low BB: Batas harga jenuh</li>
                <li>• Mid BB: Gerbang perubahan tren (SMA 20)</li>
              </ul>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-bold text-blue-800 mb-1">WMA 5 & 10 (High/Low)</div>
              <ul className="text-[10px] text-blue-700 space-y-0.5">
                <li>• Method: Linear Weighted</li>
                <li>• Area High → Sell</li>
                <li>• Area Low → Buy</li>
              </ul>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="text-xs font-bold text-purple-800 mb-1">EMA 50</div>
              <ul className="text-[10px] text-purple-700 space-y-0.5">
                <li>• Filter tren jangka menengah</li>
                <li>• Di atas = Uptrend</li>
                <li>• Di bawah = Downtrend</li>
              </ul>
            </div>
          </div>
        </div>
        
        {/* Siklus */}
        <div>
          <h3 className="text-sm font-bold text-indigo-700 mb-2">2. Siklus Mekanik Harga (Berurutan)</h3>
          <div className="space-y-2">
            {([
              { code: 'EXT', desc: 'WMA 5/10 keluar dari Top/Low BB. Harga "terlalu mahal/murah" — karet gelang ditarik maksimal, siap memantul balik.' },
              { code: 'TPW', desc: 'Harga memantul dari Extreme menuju WMA 5/10 sebaliknya. Pendinginan harga — trader wajib tutup posisi.' },
              { code: 'MHV', desc: 'Harga gagal close di luar BB. Hanya ekor yang menyentuh BB. Bensin habis — buyer/seller tidak kuat dorong.' },
              { code: 'CSAK', desc: 'Candle close tembus Mid BB DAN tembus EMA 50. Pintu gerbang tren jebol — "Raja" EMA 50 sudah menyerah.' },
              { code: 'MOM', desc: 'Body candle pecah dinding BB (close di luar). Tren sangat kuat — BB mulai mengembang. Jangan lawan arah!' },
              { code: 'RE', desc: 'Setelah CSAK/Momentum, harga balik "numpang istirahat" di WMA 5/10. Titik entri paling aman.' },
            ] as { code: SignalCode; desc: string }[]).map((item, i) => {
              const info = SIGNAL_LABELS[item.code as SignalCode];
              return (
                <div key={item.code} className="flex items-start gap-2 bg-slate-50 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 font-mono w-4 shrink-0 mt-0.5">{i + 1}.</span>
                  <span
                    className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: info?.bg, color: info?.color }}
                  >
                    {item.code}
                  </span>
                  <span className="text-[11px] text-slate-600 leading-relaxed">{item.desc}</span>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Golden Rules */}
        <div>
          <h3 className="text-sm font-bold text-indigo-700 mb-2">3. Golden Rules</h3>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
            <p className="text-[11px] text-amber-800"><strong>No Momentum, No Re-Entry:</strong> Kalau belum ada candle yang pecah BB (Momentum), jangan paksa cari Re-entry.</p>
            <p className="text-[11px] text-amber-800"><strong>Filter EMA 50:</strong> Candle di atas EMA 50 = Fokus Buy. Candle di bawah EMA 50 = Fokus Sell.</p>
            <p className="text-[11px] text-amber-800"><strong>Kesabaran MHV:</strong> MHV adalah kunci akurasi. Menunggu formasi EXT → TPW → MHV selesai di TF konfirmasi menyelamatkan dari fakeout.</p>
          </div>
        </div>
        
        {/* MTF Combinations */}
        <div>
          <h3 className="text-sm font-bold text-indigo-700 mb-2">4. Kombinasi Multi-Timeframe</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="px-2 py-1.5 text-left">Setup</th>
                  <th className="px-2 py-1.5 text-center">TF1 (Setup RE)</th>
                  <th className="px-2 py-1.5 text-center">TF2 (Confirm RJ/RJB)</th>
                  <th className="px-2 py-1.5 text-center">TF3 (Execute)</th>
                  <th className="px-2 py-1.5 text-center">Style</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-indigo-700">SWING</td>
                  <td className="px-2 py-1.5 text-center text-orange-600 font-semibold">D1</td>
                  <td className="px-2 py-1.5 text-center text-amber-600 font-semibold">H4</td>
                  <td className="px-2 py-1.5 text-center text-green-600 font-semibold">H1</td>
                  <td className="px-2 py-1.5 text-center text-[9px] text-slate-500">Long hold</td>
                </tr>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <td className="px-2 py-1.5 font-semibold text-cyan-700">INTRADAY</td>
                  <td className="px-2 py-1.5 text-center text-amber-600 font-semibold">H4</td>
                  <td className="px-2 py-1.5 text-center text-green-600 font-semibold">H1</td>
                  <td className="px-2 py-1.5 text-center text-blue-600 font-semibold">M15</td>
                  <td className="px-2 py-1.5 text-center text-[9px] text-slate-500">Daily</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold text-amber-700">SCALPING</td>
                  <td className="px-2 py-1.5 text-center text-green-600 font-semibold">H1</td>
                  <td className="px-2 py-1.5 text-center text-blue-600 font-semibold">M15</td>
                  <td className="px-2 py-1.5 text-center text-purple-600 font-semibold">M5</td>
                  <td className="px-2 py-1.5 text-center text-[9px] text-slate-500">Fast</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Signal Codes */}
        <div>
          <h3 className="text-sm font-bold text-indigo-700 mb-2">5. Kode Sinyal Dashboard</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SIGNAL_LABELS).map(([code, info]) => (
              <div key={code} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                  style={{ backgroundColor: info.bg, color: info.color }}
                >
                  {code}
                </span>
                <span className="text-[10px] text-slate-600">{info.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
