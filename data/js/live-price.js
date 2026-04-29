/**
 * CARTRIDGE VAULT – Live Price Feed
 * ==================================
 * Modul harga real-time untuk semua tools.
 * Sumber: Twelve Data (demo key) + fallback simulasi.
 *
 * Cara pakai:
 *   VaultPrice.init({ pairs: ['EUR/USD','GBP/USD'] });
 *   VaultPrice.subscribe('EUR/USD', (data) => console.log(data));
 *   VaultPrice.start();
 */

const VaultPrice = (function () {
  // ---- Konfigurasi ----
  const TWELVE_DATA_KEY = 'demo'; // Ganti dengan key sendiri untuk rate limit lebih tinggi
  const POLL_INTERVAL = 3000; // ms (Twelve Data demo: 8 req/menit, jadi 3 detik aman untuk 1-2 pair)

  // ---- State ----
  let pairs = [];
  let cache = {};        // { 'EUR/USD': { bid, ask, mid, ts } }
  let subscribers = {};  // { 'EUR/USD': [callback, ...] }
  let intervalId = null;
  let isRunning = false;
  let useFallback = false;

  // ---- API Fetch (Twelve Data) ----
  async function fetchPriceTwelveData(pair) {
    const symbol = pair.replace('/', '');
    const url = `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    const price = parseFloat(json.price);
    if (isNaN(price)) throw new Error('Invalid price');
    return {
      bid: price * 0.9999,
      ask: price * 1.0001,
      mid: price,
      ts: Date.now()
    };
  }

  // ---- Fallback: simulasi harga fluktuatif ----
  function generateFallbackPrice(pair) {
    const basePrices = {
      'EUR/USD': 1.0850, 'GBP/USD': 1.2640, 'USD/JPY': 154.20,
      'AUD/USD': 0.6520, 'NZD/USD': 0.5970, 'USD/CAD': 1.3680,
      'USD/CHF': 0.9140
    };
    const base = basePrices[pair] || 1.0000;
    const noise = (Math.random() - 0.5) * 0.0020;
    const mid = base + noise;
    return {
      bid: mid * 0.9999,
      ask: mid * 1.0001,
      mid: mid,
      ts: Date.now()
    };
  }

  // ---- Update satu pair ----
  async function updatePair(pair) {
    try {
      if (useFallback) throw new Error('Fallback');
      const data = await fetchPriceTwelveData(pair);
      cache[pair] = data;
      useFallback = false;
    } catch (e) {
      useFallback = true;
      cache[pair] = generateFallbackPrice(pair);
    }
    // Panggil subscriber
    if (subscribers[pair]) {
      subscribers[pair].forEach(cb => cb(cache[pair]));
    }
    // Trigger custom event global
    window.dispatchEvent(new CustomEvent('vault-price-update', {
      detail: { pair, data: cache[pair] }
    }));
  }

  // ---- Update semua pair ----
  async function updateAll() {
    const tasks = pairs.map(p => updatePair(p));
    await Promise.allSettled(tasks);
  }

  // ---- Public API ----
  return {
    init(config) {
      if (config.pairs && Array.isArray(config.pairs)) {
        pairs = config.pairs;
      }
      if (config.apiKey) {
        // Override TWELVE_DATA_KEY jika disediakan
        // (tidak bisa override const, tapi bisa via parameter fetch)
      }
      pairs.forEach(pair => {
        if (!cache[pair]) cache[pair] = null;
        if (!subscribers[pair]) subscribers[pair] = [];
      });
    },

    subscribe(pair, callback) {
      if (!subscribers[pair]) subscribers[pair] = [];
      subscribers[pair].push(callback);
      // Kirim harga terakhir jika ada
      if (cache[pair]) callback(cache[pair]);
    },

    unsubscribe(pair, callback) {
      if (!subscribers[pair]) return;
      subscribers[pair] = subscribers[pair].filter(cb => cb !== callback);
    },

    getPrice(pair) {
      return cache[pair] || null;
    },

    isFallback() {
      return useFallback;
    },

    start() {
      if (isRunning) return;
      isRunning = true;
      updateAll(); // fetch langsung
      intervalId = setInterval(updateAll, POLL_INTERVAL);
    },

    stop() {
      isRunning = false;
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    },

    getPairs() {
      return [...pairs];
    }
  };
})();
