/**
 * CARTRIDGE VAULT – Connection Indicator
 * ========================================
 * Memantau status koneksi data: Price Feed & Economic Calendar.
 * 
 * Cara pakai:
 *   VaultConnection.init();
 *   VaultConnection.onChange(callback);
 *   VaultConnection.getStatus() → { price: 'live'|'fallback'|'offline', calendar: 'live'|'cache'|'simulasi'|'offline' }
 */

const VaultConnection = (function() {
  let status = {
    price: 'offline',     // 'live' | 'fallback' | 'offline'
    calendar: 'offline'   // 'live' | 'cache' | 'simulasi' | 'offline'
  };
  let listeners = [];
  let checkInterval = null;

  function detectPriceStatus() {
    if (typeof VaultPrice === 'undefined') return 'offline';
    if (!VaultPrice.isFallback || !VaultPrice.getPrice) return 'offline';
    try {
      return VaultPrice.isFallback() ? 'fallback' : 'live';
    } catch(e) {
      return 'offline';
    }
  }

  function detectCalendarStatus() {
    if (typeof VaultCalendar === 'undefined') return 'offline';
    if (!VaultCalendar.getStatus) return 'offline';
    try {
      const s = VaultCalendar.getStatus();
      if (s === 'live') return 'live';
      if (s === 'cache') return 'cache';
      if (s === 'simulasi') return 'simulasi';
      return 'offline';
    } catch(e) {
      return 'offline';
    }
  }

  function updateStatus() {
    const newStatus = {
      price: detectPriceStatus(),
      calendar: detectCalendarStatus()
    };
    const changed = (newStatus.price !== status.price || newStatus.calendar !== status.calendar);
    status = newStatus;
    if (changed) {
      listeners.forEach(cb => cb(status));
      window.dispatchEvent(new CustomEvent('vault-connection-update', { detail: status }));
    }
  }

  return {
    init(options = {}) {
      updateStatus();
      if (checkInterval) clearInterval(checkInterval);
      checkInterval = setInterval(updateStatus, 3000);
      // Dengarkan update dari modul lain
      window.addEventListener('vault-price-update', () => updateStatus());
      window.addEventListener('vault-calendar-ready', () => updateStatus());
    },

    onChange(callback) {
      listeners.push(callback);
    },

    getStatus() {
      return { ...status };
    },

    getStatusLabel(key) {
      const labels = {
        price: { live: 'LIVE', fallback: 'SIMULASI', offline: 'OFFLINE' },
        calendar: { live: 'LIVE', cache: 'CACHE', simulasi: 'SIMULASI', offline: 'OFFLINE' }
      };
      return labels[key]?.[status[key]] || 'UNKNOWN';
    },

    destroy() {
      if (checkInterval) clearInterval(checkInterval);
      listeners = [];
    }
  };
})();
