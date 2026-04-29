/**
 * CARTRIDGE VAULT – Economic Calendar Feed
 * =========================================
 * Sumber: nfs.faireconomy.media (gratis, JSON)
 * Fallback: localStorage cache → simulasi.
 * 
 * Cara pakai:
 *   VaultCalendar.init({ forceRefresh: false });
 *   VaultCalendar.getEvents() → Promise<Array>
 *   VaultCalendar.getStatus() → 'live' | 'cache' | 'simulasi'
 */

const VaultCalendar = (function() {
  const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const CACHE_KEY = 'vault_calendar_cache';
  const CACHE_AGE_MS = 60 * 60 * 1000; // 1 jam

  let events = [];
  let status = 'loading'; // 'live', 'cache', 'simulasi', 'error'
  let initPromise = null;

  function getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      if (Date.now() - cache.timestamp > CACHE_AGE_MS) return null; // expired
      return cache.data;
    } catch(e) { return null; }
  }

  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch(e) {}
  }

  async function fetchWithRetry(url, retries=3) {
    for (let i=0; i<retries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error('HTTP '+res.status);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
        throw new Error('Empty response');
      } catch(e) {
        if (i === retries-1) throw e;
        await new Promise(r => setTimeout(r, 1000 * (i+1))); // backoff
      }
    }
  }

  function generateSimulatedEvents() {
    const now = new Date();
    const templates = [
      { title:'Non-Farm Payrolls', country:'USD', impact:'High', forecast:'180K', previous:'210K' },
      { title:'Unemployment Rate', country:'USD', impact:'High', forecast:'3.8%', previous:'3.9%' },
      { title:'CPI m/m', country:'EUR', impact:'High', forecast:'0.3%', previous:'0.2%' },
      { title:'GDP q/q', country:'GBP', impact:'High', forecast:'0.5%', previous:'0.6%' },
      { title:'Interest Rate Decision', country:'AUD', impact:'High', forecast:'4.35%', previous:'4.35%' },
      { title:'Retail Sales m/m', country:'USD', impact:'High', forecast:'0.5%', previous:'0.4%' },
      { title:'Industrial Production m/m', country:'EUR', impact:'Medium', forecast:'0.5%', previous:'0.3%' },
      { title:'PPI m/m', country:'USD', impact:'Medium', forecast:'0.2%', previous:'0.1%' },
      { title:'Trade Balance', country:'CAD', impact:'Medium', forecast:'2.1B', previous:'1.8B' },
      { title:'BOE Gov Bailey Speaks', country:'GBP', impact:'Medium', forecast:'-', previous:'-' },
      { title:'Building Permits', country:'USD', impact:'Low', forecast:'1.2%', previous:'0.8%' },
      { title:'NZD Visitor Arrivals', country:'NZD', impact:'Low', forecast:'1.1%', previous:'0.9%' }
    ];
    const hours = [1,6,8,10,12,14,16,18,20,23];
    const sim = [];
    for (let i=0; i<7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate()+i);
      const dayStr = d.toISOString().slice(0,10);
      const n = 2 + Math.floor(Math.random()*3); // 2-4 event per hari
      for (let j=0; j<n; j++) {
        const tpl = templates[(i*2+j) % templates.length];
        const hour = hours[Math.floor(Math.random()*hours.length)];
        const date = new Date(`${dayStr}T${String(hour).padStart(2,'0')}:00:00Z`);
        sim.push({
          date: date.toISOString(),
          country: tpl.country,
          title: tpl.title,
          impact: tpl.impact,
          forecast: tpl.forecast,
          previous: tpl.previous
        });
      }
    }
    return sim.sort((a,b)=>new Date(a.date)-new Date(b.date));
  }

  async function init(options={}) {
    if (initPromise) return initPromise;
    initPromise = (async ()=>{
      // 1. coba cache dulu sebagai fallback pertama
      const cached = getCache();
      
      try {
        events = await fetchWithRetry(CALENDAR_URL);
        status = 'live';
        setCache(events);
      } catch(e) {
        console.warn('FX Calendar API gagal:', e.message);
        if (cached && cached.length>0) {
          events = cached;
          status = 'cache';
        } else {
          events = generateSimulatedEvents();
          status = 'simulasi';
        }
      }
      // Trigger event global
      window.dispatchEvent(new CustomEvent('vault-calendar-ready', { detail: { status, events } }));
      return events;
    })();
    return initPromise;
  }

  return {
    async getEvents(options) {
      await init(options);
      return events;
    },
    getStatus() {
      return status;
    },
    getStatusLabel() {
      const map = { live:'LIVE', cache:'CACHE', simulasi:'SIMULASI', error:'ERROR', loading:'LOADING' };
      return map[status] || status;
    },
    refresh() {
      localStorage.removeItem(CACHE_KEY);
      initPromise = null;
      return init({ forceRefresh: true });
    }
  };
})();
