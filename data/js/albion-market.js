/* =============================================
   AlbionMarket v3 — data layer (Albion Online Data Project)
   ------------------------------------------------------------
   Endpoint : /api/v2/stats/prices/{ids}.json?qualities=1
   CORS     : access-control-allow-origin: *  (aman dari browser)
   Auth     : tidak perlu key
   Rate     : 180 req/menit, 300 per 5 menit, URL < 4096 char
              → satu request berisi ~70 id, refresh 60 detik
   Sentinel : 0 = tidak ada order, 999999 = tidak ada order
              → keduanya dinormalkan jadi 0 supaya tidak
                ikut terhitung sebagai harga
   Data     : PER KOTA (city), jadi arbitrage antar kota
              bisa dihitung dari sumber yang sama
   ============================================= */
(function (global) {
  'use strict';

  var REGIONS = {
    west:   { host: 'west.albion-online-data.com',   label: 'Americas (West)' },
    east:   { host: 'east.albion-online-data.com',   label: 'Asia (East)' },
    europe: { host: 'europe.albion-online-data.com', label: 'Europe' }
  };

  var ROYALS = ['Caerleon', 'Thetford', 'Lymhurst', 'Fort Sterling',
                'Martlock', 'Bridgewatch', 'Breitworth'];
  var EXTRA_CITIES = ['Black Market', 'Brecilien'];

  var TIER_MIN = 2, TIER_MAX = 8;

  /* nama id di AODP tidak seragam: CLOTH/LEATHER tunggal,
     PLANKS jamak. Raw_material selalu bentuk jamak tunggal. */
  var CHAINS = [
    { key:'ore',   raw:'ORE',   ref:'BAR',     refA:'BAR',     refB:'BARS',    label:'Ore → Bar' },
    { key:'fiber', raw:'FIBER', ref:'CLOTH',   refA:'CLOTH',   refB:'CLOTHS',  label:'Fiber → Cloth' },
    { key:'hide',  raw:'HIDE',  ref:'LEATHER', refA:'LEATHER', refB:'LEATHERS',label:'Hide → Leather' },
    { key:'wood',  raw:'WOOD',  ref:'PLANK',   refA:'PLANK',   refB:'PLANKS',  label:'Wood → Plank' },
    { key:'stone', raw:'STONE', ref:'BLOCK',   refA:'BLOCK',   refB:'BLOCKS',  label:'Stone → Block' }
  ];

  var CACHE_KEY = 'albion_market_v3';
  var CACHE_TTL = 10 * 60 * 1000;
  var TIMEOUT = 12000;
  var AUTO_REFRESH = 60 * 1000;
  var BATCH = 90;

  /* ---------- state ---------- */
  var S = {
    region: 'west',
    data: {},          /* id -> { city -> {buy, sell, buyMax, sellMax} } */
    fetched: 0,        /* epoch ms */
    status: 'idle',
    error: '',
    lastHost: ''
  };
  var listeners = [];
  var inflight = null;

  function notify() { listeners.forEach(function (fn) { try { fn(api); } catch (e) {} }); }

  /* ---------- id ---------- */
  function rawId(tier, chain) { return 'T' + tier + '_' + chain.raw; }
  function refId(tier, chain) { return 'T' + tier + '_' + chain.ref; }
  function refCandidates(tier, chain) {
    var a = 'T' + tier + '_' + chain.refA, b = 'T' + tier + '_' + chain.refB;
    return a === b ? [a] : [a, b];
  }

  /* watchlist: 5 material x 7 tier x (raw + refined) */
  function watchIds() {
    var ids = [], t, c;
    for (c = 0; c < CHAINS.length; c++) {
      for (t = TIER_MIN; t <= TIER_MAX; t++) {
        ids.push(rawId(t, CHAINS[c]));
        ids = ids.concat(refCandidates(t, CHAINS[c]));
      }
    }
    return ids.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function splitIds(ids) {
    var out = [];
    for (var i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
    return out;
  }

  /* ---------- normalisasi ---------- */
  function clean(v) {
    var n = parseFloat(v);
    if (!isFinite(n) || n <= 0 || n === 999999) return 0;
    return n;
  }

  function absorb(rows, into) {
    if (!rows || !rows.length) return 0;
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.item_id || !r.city) continue;
      var sell = clean(r.sell_price_min);   /* order jual terendah -> biaya beli instan */
      var buy  = clean(r.buy_price_max);   /* order beli tertinggi ->|jual instan */
      var sellMax = clean(r.sell_price_max);
      var buyMin  = clean(r.buy_price_min);
      if (!sell && !buy) continue;
      var bag = into[r.item_id] || (into[r.item_id] = {});
      bag[r.city] = {
        buy: buy, sell: sell,
        buyMin: buyMin, sellMax: sellMax,
        when: r.buy_price_max_date && r.buy_price_max_date > '2000'
          ? r.buy_price_max_date : (r.sell_price_min_date || '')
      };
      n++;
    }
    return n;
  }

  /* ---------- cache ---------- */
  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        region: S.region, data: S.data, fetched: S.fetched
      }));
    } catch (e) {}
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && c.data ? c : null;
    } catch (e) { return null; }
  }

  /* ---------- network ---------- */
  function request(url) {
    return new Promise(function (resolve, reject) {
      if (typeof AbortController === 'undefined') return reject(new Error('AbortController unsupported'));
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      fetch(url, { signal: ctl.signal, mode: 'cors', cache: 'no-store' })
        .then(function (r) {
          clearTimeout(timer);
          if (r.status === 429) return reject(new Error('throttle 429'));
          if (!r.ok) return reject(new Error('HTTP ' + r.status));
          return r.json();
        })
        .then(resolve, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function load(opts) {
    opts = opts || {};
    if (opts.region && opts.region !== S.region) {
      S.region = opts.region;
      S.data = {};
      S.fetched = 0;
    }
    if (inflight && !opts.force) return inflight;

    var c = readCache();
    if (c && c.region === S.region && !opts.force) {
      S.data = c.data;
      S.fetched = c.fetched;
      var age = Date.now() - c.fetched;
      S.status = hasAny() ? (age < CACHE_TTL ? 'cache' : 'stale') : 'idle';
    }
    if (!hasAny()) S.status = 'loading';
    notify();

    var host = REGIONS[S.region].host;
    var batches = splitIds(watchIds());

    inflight = batches.reduce(function (chain, batch) {
      return chain.then(function (acc) {
        var url = 'https://' + host + '/api/v2/stats/prices/' +
          encodeURIComponent(batch.join(',')) + '.json?qualities=1';
        return request(url).then(function (rows) {
          acc.n += absorb(rows, S.data);
          return acc;
        }, function (e) { acc.err = e.message; return acc; });
      });
    }, Promise.resolve({ n: 0, err: '' })).then(function (acc) {
      var n = acc.n;
      if (n > 0) {
        S.fetched = Date.now();
        S.status = 'live';
        S.error = '';
        S.lastHost = host;
        writeCache();
      } else {
        if (!hasAny()) S.status = 'offline';
        S.error = acc.err || S.error || 'tidak ada data di region ini';
      }
      notify();
      inflight = null;
      return api;
    });

    return inflight;
  }

  /* on-demand: satu item bebas (untuk tab Cari) */
  function fetchIds(ids) {
    var host = REGIONS[S.region].host;
    var uniq = ids.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (!uniq.length) return Promise.resolve(0);
    return request('https://' + host + '/api/v2/stats/prices/' +
      encodeURIComponent(uniq.join(',')) + '.json?qualities=1')
      .then(function (rows) {
        var n = absorb(rows, S.data);
        if (n) writeCache();
        notify();
        return n;
      }, function () { return 0; });
  }

  function hasAny() {
    for (var k in S.data) { if (Object.keys(S.data[k]).length) return true; }
    return false;
  }

  /* ---------- query ---------- */
  function chainOf(code) {
    for (var i = 0; i < CHAINS.length; i++) {
      if (CHAINS[i].raw === code || CHAINS[i].ref === code) return CHAINS[i];
    }
    return null;
  }

  /* meta untuk id apa pun, tanpa network */
  function meta(id) {
    var m = /^T(\d)_?([A-Z]+)$/.exec(id || '');
    if (!m) return { id:id, tier:0, code:id, kind:'other', label:String(id || '—') };
    var tier = parseInt(m[1], 10), code = m[2];
    var ch = chainOf(code);
    var kind = !ch ? 'other' : (ch.raw === code ? 'raw' : 'refined');
    var name = ch
      ? (ch.raw === code ? ch.raw.charAt(0) + ch.raw.slice(1).toLowerCase()
                         : ch.ref.charAt(0) + ch.ref.slice(1).toLowerCase())
      : code.charAt(0) + code.slice(1).toLowerCase();
    return { id:id, tier:tier, code:code, kind:kind, chain:ch ? ch.key : '',
             label:name + ' T' + tier };
  }

  function citiesOf(id) {
    return Object.keys(S.data[id] || {}).sort();
  }

  /* ambil entri kota; fallback: kota apa pun yang punya harga */
  function at(id, city) {
    var bag = S.data[id];
    if (!bag) return null;
    if (city && bag[city]) return Object.assign({ city:city }, bag[city]);
    var names = Object.keys(bag);
    for (var i = 0; i < names.length; i++) {
      if (bag[names[i]].sell || bag[names[i]].buy) {
        return Object.assign({ city:names[i] }, bag[names[i]]);
      }
    }
    return null;
  }

  /* id refined mana yang benar-benar punya data (nama id beda-beda) */
  function refLive(tier, chain, city) {
    var cands = refCandidates(tier, chain);
    for (var i = 0; i < cands.length; i++) {
      var e = at(cands[i], city);
      if (e && (e.sell || e.buy)) return { id:cands[i], entry:e };
    }
    return null;
  }

  /* daftar item unik yang punya harga, untuk tab Cari */
  function tracked() {
    var out = [];
    for (var id in S.data) {
      var bag = S.data[id];
      var cities = Object.keys(bag).filter(function (c) {
        return bag[c].sell > 0 || bag[c].buy > 0;
      });
      if (!cities.length) continue;
      var m = meta(id);
      m.cities = cities.sort();
      out.push(m);
    }
    out.sort(function (a, b) {
      if (a.tier !== b.tier) return b.tier - a.tier;
      return a.code < b.code ? -1 : 1;
    });
    return out;
  }

  function search(q, city) {
    q = String(q || '').trim().toUpperCase();
    if (q.length < 2) return [];
    return tracked().filter(function (m) {
      if (m.id.indexOf(q) === 0 || m.label.toUpperCase().indexOf(q) > -1) return true;
      return false;
    }).slice(0, 50);
  }

  /* ---------- api ---------- */
  var api = {
    REGIONS: REGIONS,
    ROYALS: ROYALS,
    EXTRA_CITIES: EXTRA_CITIES,
    CHAINS: CHAINS,
    TIER_MIN: TIER_MIN,
    TIER_MAX: TIER_MAX,
    AUTO_REFRESH: AUTO_REFRESH,
    CACHE_TTL: CACHE_TTL,

    load: load,
    fetchIds: fetchIds,
    meta: meta,
    rawId: rawId,
    refId: refId,
    refLive: refLive,
    at: at,
    citiesOf: citiesOf,
    tracked: tracked,
    search: search,
    watchIds: watchIds,
    region: function () { return S.region; },
    regionLabel: function () {
      return (REGIONS[S.region] || REGIONS.west).label;
    },
    hasAny: hasAny,

    status: function () {
      var n = 0;
      for (var id in S.data) n += Object.keys(S.data[id]).length;
      return {
        state:S.status, fetched:S.fetched, error:S.error,
        host:S.lastHost, rows:n, region:S.region
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