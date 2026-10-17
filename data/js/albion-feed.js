/* =============================================
   AOFeed – Albion Online live market feed
   Public Gameforge API, keyless, CORS-permissive.
   Berisi fallback multi-host, cache localStorage,
   dan status transparan supaya UI tetap jalan
   saat feed tidak bisa diakses.
   ============================================= */
(function (global) {
  'use strict';

  var HOSTS = [
    'https://game.albion-online.com/api/game/market/stats',
    'https://west.albion-online.com/api/game/market/stats',
    'https://east.albion-online.com/api/game/market/stats',
    'https://south.albion-online.com/api/game/market/stats'
  ];

  var CACHE_KEY = 'ao_market_v1';
  var CACHE_TTL = 10 * 60 * 1000;
  var TIMEOUT = 7000;
  var AUTO_REFRESH = 60 * 1000;

  var TYPES = {
    ORE: 'Ore', FIBER: 'Fiber', HIDE: 'Hide', WOOD: 'Wood', STONE: 'Stone',
    BAR: 'Bar', CLOTH: 'Cloth', LEATHER: 'Leather', PLANK: 'Plank', BLOCK: 'Block'
  };

  var RAW = ['ORE', 'FIBER', 'HIDE', 'WOOD', 'STONE'];
  var REF = ['BAR', 'CLOTH', 'LEATHER', 'PLANK', 'BLOCK'];

  var state = { data: {}, updated: 0, source: '', state: 'idle', error: '' };
  var listeners = [];
  var inflight = null;

  /* ---------- helpers ---------- */
  function itemMeta(id) {
    var m = /^T(\d)([A-Z]+)$/.exec(id);
    if (!m) return { id: id, tier: 0, type: '', label: id, cat: 'other' };
    var type = m[2];
    var cat = RAW.indexOf(type) > -1 ? 'raw' : REF.indexOf(type) > -1 ? 'refined' : 'other';
    return {
      id: id, tier: parseInt(m[1], 10), type: type,
      label: (TYPES[type] || type) + ' T' + m[1], cat: cat
    };
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /*_stats accepts {items:[…]} and {items:{ID:{…}}} */
  function normalise(payload) {
    var out = {};
    if (!payload) return out;
    var items = payload.items || payload.data || payload;
    if (Array.isArray(items)) {
      items.forEach(function (p) {
        if (!p || !p.item_id) return;
        out[p.item_id] = pick(p);
      });
    } else if (items && typeof items === 'object') {
      Object.keys(items).forEach(function (id) {
        var p = items[id] || {};
        p.item_id = p.item_id || id;
        out[p.item_id] = pick(p);
      });
    }
    return out;
  }

  function pick(p) {
    return {
      sell: num(p.price_max_sell || p.sell_price_min || p.sell),  // harga jual order terendah = beli instan
      buy: num(p.price_min_buy || p.buy_price_max || p.buy),      // harga beli order tertinggi = jual instan
      avg: num(p.avg_price),
      delta: parseFloat(p.price_delta_24h_relative != null ? p.price_delta_24h_relative : 0) || 0,
      stock: num(p.current_stock)
    };
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.data) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache(d, source) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data: d, updated: Date.now(), source: source
      }));
    } catch (e) { /* storage penuh / private mode */ }
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(api); } catch (e) {} });
  }

  function fetchFrom(url) {
    return new Promise(function (resolve, reject) {
      if (typeof AbortController === 'undefined') { return reject(new Error('no AbortController')); }
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      fetch(url, { signal: ctl.signal, mode: 'cors', cache: 'no-store' })
        .then(function (r) {
          clearTimeout(timer);
          if (!r.ok) { return reject(new Error('HTTP ' + r.status)); }
          return r.json();
        })
        .then(resolve)
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* ---------- public API ---------- */
  function load(opts) {
    opts = opts || {};
    if (inflight && !opts.force) { return inflight; }

    var cached = readCache();
    if (cached && !opts.force) {
      state.data = cached.data;
      state.updated = cached.updated;
      state.source = cached.source;
      var age = Date.now() - cached.updated;
      state.state = age < CACHE_TTL ? 'cache' : 'stale';
      state.error = '';
    }

    state.state = (Object.keys(state.data).length) ? state.state : 'loading';
    emit();

    var i = 0;
    function attempt() {
      if (i >= HOSTS.length) {
        if (!Object.keys(state.data).length) { state.state = 'offline'; }
        state.error = state.error || 'Feed live tidak bisa diakses dari jaringan ini.';
        emit();
        return Promise.resolve(api);
      }
      var url = HOSTS[i++];
      return fetchFrom(url)
        .then(function (payload) {
          var d = normalise(payload);
          var n = Object.keys(d).length;
          if (!n) { throw new Error('payload kosong'); }
          state.data = d;
          state.updated = Date.now();
          state.source = url;
          state.state = 'live';
          state.error = '';
          writeCache(d, url);
          emit();
          return api;
        })
        .catch(function (e) {
          state.error = (state.error ? state.error + ' ' : '') + e.message;
          return attempt();
        });
    }

    inflight = attempt().then(function (a) { inflight = null; return a; });
    return inflight;
  }

  function get(id) { return state.data[id] || null; }
  function item(id) { return state.data[id] ? Object.assign(itemMeta(id), state.data[id]) : null; }
  function status() { return { state: state.state, updated: state.updated, source: state.source, error: state.error }; }
  function subscribe(fn) { listeners.push(fn); fn(api); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

  var api = {
    load: load,
    get: get,
    item: item,
    status: status,
    subscribe: subscribe,
    itemMeta: itemMeta,
    AUTO_REFRESH: AUTO_REFRESH,
    CACHE_TTL: CACHE_TTL,
    RAW: RAW,
    REF: REF,
    list: function () {
      return Object.keys(state.data)
        .map(item)
        .filter(function (x) { return x.cat !== 'other' && (x.sell > 0 || x.buy > 0); })
        .sort(function (a, b) {
          if (a.tier !== b.tier) return b.tier - a.tier;
          return a.type.localeCompare(b.type);
        });
    }
  };

  global.AOFeed = api;
})(window);