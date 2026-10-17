/* =============================================
   AOFeed – live market feed untuk halaman Albion (v1)
   Sumber: Albion Online Data Project (keyless, CORS *)
   Sumber lama game.albion-online.com sudah mati —
   sertifikat TLS-nya invalid global, jadi tidak bisa dipakai.
   API publik v3 dipakai ulang di sini, DI-flatten per item
   supaya kontrak get()/item() milik halaman v1 tidak berubah.
   ============================================= */
(function (global) {
  'use strict';

  var HOSTS = [
    'https://west.albion-online-data.com/api/v2/stats/prices/',
    'https://east.albion-online-data.com/api/v2/stats/prices/',
    'https://europe.albion-online-data.com/api/v2/stats/prices/'
  ];
  var TIMEOUT = 12000;
  var AUTO_REFRESH = 60 * 1000;
  var CACHE_TTL = 10 * 60 * 1000;
  var CACHE_KEY = 'ao_market_v3_flat';
  var BATCH = 90;

  var CHAINS = [
    { key:'ore',   raw:'ORE',   refs:['BARS', 'BAR'] },
    { key:'fiber', raw:'FIBER', refs:['CLOTH'] },
    { key:'hide',  raw:'HIDE',  refs:['LEATHER'] },
    { key:'wood',  raw:'WOOD',  refs:['PLANKS'] },
    { key:'stone', raw:'STONE', refs:['BLOCKS'] }
  ];

  var RAW = ['ORE', 'FIBER', 'HIDE', 'WOOD', 'STONE'];
  var REF = ['BAR', 'CLOTH', 'LEATHER', 'PLANK', 'BLOCK'];

  var TYPES = {
    ORE:'Ore', FIBER:'Fiber', HIDE:'Hide', WOOD:'Wood', STONE:'Stone',
    BAR:'Bar', BARS:'Bar', CLOTH:'Cloth', CLOTHS:'Cloth', LEATHER:'Leather',
    LEATHERS:'Leather', PLANK:'Plank', PLANKS:'Plank', BLOCK:'Block', BLOCKS:'Block'
  };

  var S = { data:{}, updated:0, source:'', state:'idle', error:'' };
  var listeners = [];
  var inflight = null;

  function clean(v) {
    var n = parseFloat(v);
    if (!isFinite(n) || n <= 0 || n === 999999) return 0;
    return n;
  }

  /* id yang diminta API + alias tanpa underscore yang dipakai halaman */
  function watchIds() {
    var pairs = [];
    CHAINS.forEach(function (c) {
      for (var t = 2; t <= 8; t++) {
        pairs.push({ api:'T' + t + '_' + c.raw, alias:'T' + t + c.raw });
        c.refs.forEach(function (r) {
          pairs.push({ api:'T' + t + '_' + r, alias:'T' + t + t0(r) });
        });
      }
    });
    return pairs;
  }

  /* alias refined: BARS->BAR, CLOTH->CLOTH, PLANKS->PLANK, BLOCKS->BLOCK */
  function t0(code) {
    if (code === 'BARS') return 'BAR';
    if (code === 'CLOTHS') return 'CLOTH';
    if (code === 'LEATHERS') return 'LEATHER';
    if (code === 'PLANKS') return 'PLANK';
    if (code === 'BLOCKS') return 'BLOCK';
    return code;
  }

  function absorb(rows) {
    var n = 0, map = {};
    watchIds().forEach(function (p) { map[p.api] = p.alias; });
    if (!rows || !rows.length) return 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.item_id || !r.city) continue;
      var sell = clean(r.sell_price_min);
      var buy  = clean(r.buy_price_max);
      if (!sell && !buy) continue;

      var apiId = r.item_id;
      var key = map[apiId];
      /* id tak dikenal tetap disimpan pakai id aslinya */
      var store = key || apiId;
      var prev = S.data[store];
      /* pilih kota dengan spread paling masuk akal:sell > 0 */
      if (prev && prev.sell > 0 && sell === 0) continue;
      S.data[store] = {
        id: store,
        sell: sell,
        buy: buy,
        avg: (sell && buy) ? (sell + buy) / 2 : (sell || buy),
        delta: 0,
        stock: 0,
        city: r.city
      };
      if (key) S.data[apiId] = S.data[store];
      n++;
    }
    return n;
  }

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

  function fetchOne(url) {
    return new Promise(function (resolve, reject) {
      if (typeof AbortController === 'undefined') return reject(new Error('AbortController unsupported'));
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      fetch(url, { signal:ctl.signal, mode:'cors', cache:'no-store' })
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
    if (inflight && !opts.force) return inflight;

    var c = opts.force ? null : readCache();
    if (c) {
      S.data = c.data; S.updated = c.updated; S.source = c.source || '';
      var age = Date.now() - c.updated;
      S.state = Object.keys(S.data).length ? (age < CACHE_TTL ? 'cache' : 'stale') : 'idle';
    }
    if (!Object.keys(S.data).length) S.state = 'loading';
    emit();

    var ids = watchIds().map(function (p) { return p.api; });
    ids = ids.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var batches = [];
    for (var i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));

    var hi = 0;
    function next(acc) {
      if (hi >= HOSTS.length) return Promise.resolve(acc);
      var host = HOSTS[hi];
      function run() {
        return batches.reduce(function (ch, batch) {
          return ch.then(function (a) {
            return fetchOne(host + batch.join(',') + '.json?qualities=1')
              .then(function (rows) { a.n += absorb(rows); return a; },
                    function (e) { a.err = e.message; return a; });
          });
        }, Promise.resolve({ n:0, err:'' })).then(function (a) {
          if (a.n > 0) return { n:a.n, host:host };
          hi++;
          return next({ n:0, err:a.err });
        });
      }
      return run().then(function (res) {
        if (res.n > 0) { acc.n += res.n; acc.host = res.host; return acc; }
        return acc;
      });
    }

    inflight = next({ n:0, host:'' }).then(function (acc) {
      if (acc.n > 0) {
        S.updated = Date.now();
        S.source = acc.host;
        S.state = 'live';
        S.error = '';
        writeCache();
      } else {
        if (!Object.keys(S.data).length) S.state = 'offline';
        S.error = S.error || 'Feed tidak bisa diakses dari jaringan ini.';
      }
      emit();
      inflight = null;
      return api;
    });

    return inflight;
  }

  function itemMeta(id) {
    var m = /^T(\d)([A-Z]+)$/.exec(id || '');
    if (!m) return { id:id, tier:0, type:'', label:id || '—', cat:'other' };
    var type = m[2];
    var cat = RAW.indexOf(type) > -1 ? 'raw' : REF.indexOf(type) > -1 ? 'refined' : 'other';
    return {
      id:id, tier:parseInt(m[1],10), type:type,
      label:(TYPES[type] || type) + ' T' + m[1], cat:cat
    };
  }

  function get(id) { return S.data[id] || null; }

  function item(id) {
    var p = S.data[id];
    if (!p) return null;
    var m = itemMeta(id);
    m.sell = p.sell; m.buy = p.buy; m.avg = p.avg;
    m.delta = p.delta; m.stock = p.stock; m.city = p.city;
    return m;
  }

  function status() {
    return { state:S.state, updated:S.updated, source:S.source, error:S.error };
  }

  function emit() { listeners.forEach(function (fn) { try { fn(api); } catch (e) {} }); }

  function subscribe(fn) { listeners.push(fn); fn(api); return function () {
    listeners = listeners.filter(function (f) { return f !== fn; });
  }; }

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
      return Object.keys(S.data).map(item)
        .filter(function (x) { return x.cat !== 'other' && (x.sell > 0 || x.buy > 0); })
        .sort(function (a, b) { return b.tier - a.tier || (a.type < b.type ? -1 : 1); });
    }
  };

  global.AOFeed = api;
})(window);