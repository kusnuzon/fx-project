/* =============================================
   AlbionMarket – data layer untuk Silver Ops v2
   Public Gameforge API, keyless.
   Tanggung jawab: ambil data, normalisasi, cache,
   status. Tidak ada kalkulasi bisnis di sini.
   ============================================= */
(function (global) {
  'use strict';

  var HOSTS = [
    'https://game.albion-online.com/api/game/market/stats',
    'https://west.albion-online.com/api/game/market/stats',
    'https://east.albion-online.com/api/game/market/stats',
    'https://south.albion-online.com/api/game/market/stats'
  ];

  var CACHE_KEY = 'albion_market_v2';
  var CACHE_TTL = 10 * 60 * 1000;
  var TIMEOUT = 7000;
  var AUTO_REFRESH = 60 * 1000;

  var TIER_MIN = 2, TIER_MAX = 8;

  /* material codes: raw -> refined */
  var CHAINS = [
    { key:'ore',      raw:'ORE',      ref:'BAR',     label:'Ore → Bar' },
    { key:'fiber',    raw:'FIBER',    ref:'CLOTH',   label:'Fiber → Cloth' },
    { key:'hide',     raw:'HIDE',     ref:'LEATHER', label:'Hide → Leather' },
    { key:'wood',     raw:'WOOD',     ref:'PLANK',   label:'Wood → Plank' },
    { key:'stone',    raw:'STONE',    ref:'BLOCK',   label:'Stone → Block' }
  ];

  var PRETTY = {
    ORE:'Ore', FIBER:'Fiber', HIDE:'Hide', WOOD:'Wood', STONE:'Stone',
    BAR:'Bar', CLOTH:'Cloth', LEATHER:'Leather', PLANK:'Plank', BLOCK:'Block',
    REAGENT:'Reagent', ARCANE:'Arcane', RUNE:'Rune', SOUL:'Soul', RELIC:'Relic'
  };

  /* ---------- state ---------- */
  var S = { data:{}, updated:0, source:'', status:'idle', error:'' };
  var listeners = [];
  var inflight = null;

  function notify() {
    for (var i=0;i<listeners.length;i++) {
      try { listeners[i](api); } catch (e) {}
    }
  }

  /* ---------- meta item ---------- */
  function meta(id) {
    var m = /^T(\d)_?([A-Z]+)$/.exec(id || '');
    if (m) {
      var tier = parseInt(m[1], 10);
      var code = m[2];
      var kind = 'other';
      for (var i=0;i<CHAINS.length;i++) {
        if (CHAINS[i].raw === code) kind = 'raw';
        else if (CHAINS[i].ref === code) kind = 'refined';
      }
      return {
        id:id, tier:tier, code:code, kind:kind,
        label:(PRETTY[code] || prettify(code)) + ' T' + tier,
        sort:(kind === 'refined' ? 1 : 0)
      };
    }
    var m2 = /^T(\d)_(.+)$/.exec(id || '');
    if (m2) {
      return {
        id:id, tier:parseInt(m2[1],10), code:m2[2], kind:'gear',
        label:'T' + m2[1] + ' ' + prettify(m2[2]), sort:2
      };
    }
    return { id:id, tier:0, code:id || '', kind:'other', label:prettify(id || '—'), sort:3 };
  }

  function prettify(s) {
    return String(s || '')
      .replace(/^T\d_?/, '')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------- normalisasi ---------- */
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function shape(p, id) {
    return {
      id: id || p.item_id,
      sell: num(p.price_max_sell || p.sell_price_min),  // order jual terendah = beli instan
      buy:  num(p.price_min_buy || p.buy_price_max),   // order beli tertinggi = jual instan
      avg:  num(p.avg_price),
      delta: parseFloat(p.price_delta_24h_relative) || 0,
      stock: num(p.current_stock)
    };
  }

  function normalise(payload) {
    var out = {};
    if (!payload) return out;
    var items = payload.items || payload.data || payload;
    if (Object.prototype.toString.call(items) === '[object Array]') {
      for (var i=0;i<items.length;i++) {
        if (items[i] && items[i].item_id) out[items[i].item_id] = shape(items[i]);
      }
    } else if (items && typeof items === 'object') {
      var keys = Object.keys(items);
      for (var k=0;k<keys.length;k++) {
        var id = keys[k], p = items[id] || {};
        out[id] = shape(p, id);
      }
    }
    return out;
  }

  /* ---------- cache ---------- */
  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && c.data ? c : null;
    } catch (e) { return null; }
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data:S.data, updated:S.updated, source:S.source
      }));
    } catch (e) {}
  }

  /* ---------- network ---------- */
  function fetchOne(url) {
    return new Promise(function (resolve, reject) {
      if (typeof AbortController === 'undefined') return reject(new Error('AbortController unsupported'));
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      fetch(url, { signal:ctl.signal, mode:'cors', cache:'no-store' })
        .then(function (r) {
          clearTimeout(timer);
          if (!r.ok) return reject(new Error('HTTP ' + r.status));
          return r.json();
        })
        .then(resolve, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function load(opts) {
    opts = opts || {};
    if (inflight && !opts.force) return inflight;

    var cached = readCache();
    if (cached && !opts.force) {
      S.data = cached.data;
      S.updated = cached.updated;
      S.source = cached.source || '';
      var age = Date.now() - cached.updated;
      S.status = Object.keys(S.data).length ? (age < CACHE_TTL ? 'cache' : 'stale') : 'idle';
    }
    if (!Object.keys(S.data).length) S.status = 'loading';
    notify();

    var i = 0;
    function next() {
      if (i >= HOSTS.length) {
        if (!Object.keys(S.data).length) S.status = 'offline';
        S.error = S.error || 'Feed tidak bisa diakses dari jaringan ini.';
        notify();
        return Promise.resolve(api);
      }
      var url = HOSTS[i++];
      return fetchOne(url)
        .then(function (payload) {
          var d = normalise(payload);
          if (!Object.keys(d).length) throw new Error('payload kosong');
          S.data = d;
          S.updated = Date.now();
          S.source = url;
          S.status = 'live';
          S.error = '';
          writeCache();
          notify();
          return api;
        })
        .catch(function (e) {
          S.error = (S.error ? S.error + ' ' : '') + e.message;
          return next();
        });
    }

    inflight = next().then(function (a) { inflight = null; return a; });
    return inflight;
  }

  /* ---------- query ---------- */
  function rows(kindFilter) {
    var out = [];
    for (var id in S.data) {
      var p = S.data[id];
      if (!p.sell && !p.buy) continue;
      var m = meta(id);
      if (kindFilter && m.kind !== kindFilter) continue;
      m.sell = p.sell; m.buy = p.buy; m.avg = p.avg;
      m.delta = p.delta; m.stock = p.stock;
      out.push(m);
    }
    out.sort(function (a, b) {
      if (a.tier !== b.tier) return b.tier - a.tier;
      return a.code < b.code ? -1 : 1;
    });
    return out;
  }

  function search(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return rows().filter(function (m) {
      return m.id.toLowerCase().indexOf(q) > -1 || m.label.toLowerCase().indexOf(q) > -1;
    }).slice(0, 60);
  }

  /* ---------- api ---------- */
  var api = {
    CHAINS: CHAINS,
    TIER_MIN: TIER_MIN,
    TIER_MAX: TIER_MAX,
    AUTO_REFRESH: AUTO_REFRESH,
    CACHE_TTL: CACHE_TTL,

    load: load,
    meta: meta,
    search: search,
    rows: rows,
    get: function (id) {
      var p = S.data[id];
      if (!p) return null;
      var m = meta(id);
      m.sell = p.sell; m.buy = p.buy; m.avg = p.avg;
      m.delta = p.delta; m.stock = p.stock;
      return m;
    },
    id: function (tier, code) { return 'T' + tier + code; },

    status: function () {
      return {
        state:S.status, updated:S.updated, source:S.source,
        error:S.error, count:Object.keys(S.data).length
      };
    },
    subscribe: function (fn) {
      listeners.push(fn);
      fn(api);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    }
  };

  global.AlbionMarket = api;
})(window);