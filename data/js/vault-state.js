/**
 * CARTRIDGE VAULT – Shared State Module
 * ======================================
 * Pusat preferensi & profil risiko yang dipakai seluruh tools.
 * Disimpan di localStorage, bisa di-subscribe.
 *
 * Keys standar:
 *   balance, riskPercent, leverage, maxDailyLoss, preferredPair
 * 
 * Cara pakai:
 *   VaultState.init();
 *   VaultState.set('balance', 2000);
 *   VaultState.get('balance'); // 2000
 *   VaultState.subscribe((newState) => { ... });
 */

const VaultState = (function() {
  const STORAGE_KEY = 'vault_state';

  const DEFAULTS = {
    balance: 1000,
    riskPercent: 2,
    leverage: 400,
    maxDailyLoss: 5,
    preferredPair: 'EUR/USD'
  };

  let state = { ...DEFAULTS };
  let listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = { ...DEFAULTS, ...JSON.parse(raw) };
      } else {
        state = { ...DEFAULTS };
      }
    } catch(e) {
      state = { ...DEFAULTS };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e) {}
  }

  function notify() {
    const snapshot = { ...state };
    listeners.forEach(cb => cb(snapshot));
    window.dispatchEvent(new CustomEvent('vault-state-changed', { detail: snapshot }));
  }

  load(); // langsung muat saat script dieksekusi

  return {
    init(defaults) {
      if (defaults) {
        state = { ...DEFAULTS, ...defaults };
        save();
        notify();
      }
    },

    get(key) {
      if (key === undefined) return { ...state };
      return state[key] !== undefined ? state[key] : DEFAULTS[key];
    },

    set(keyOrObj, value) {
      if (typeof keyOrObj === 'object') {
        Object.keys(keyOrObj).forEach(k => {
          if (DEFAULTS.hasOwnProperty(k)) {
            state[k] = keyOrObj[k];
          }
        });
      } else if (typeof keyOrObj === 'string') {
        if (DEFAULTS.hasOwnProperty(keyOrObj)) {
          state[keyOrObj] = value;
        }
      }
      save();
      notify();
    },

    reset() {
      state = { ...DEFAULTS };
      save();
      notify();
    },

    subscribe(callback) {
      listeners.push(callback);
    },

    unsubscribe(callback) {
      listeners = listeners.filter(cb => cb !== callback);
    }
  };
})();
