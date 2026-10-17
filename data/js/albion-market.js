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
    west:   { host: 'west.albion-online-data.com',   label: 'US / Americas (West)', short: 'West (US)' },
    east:   { host: 'east.albion-online-data.com',   label: 'Asia (East)',         short: 'East (Asia)' },
    europe: { host: 'europe.albion-online-data.com', label: 'Europe',              short: 'Europe' }
  };
  var REGION_ORDER = ['west', 'east', 'europe'];

  var ROYALS = ['Caerleon', 'Thetford', 'Lymhurst', 'Fort Sterling',
                'Martlock', 'Bridgewatch', 'Breitworth'];
  var EXTRA_CITIES = ['Black Market', 'Brecilien'];

  var TIER_MIN = 2, TIER_MAX = 8;

  /* Id item resmi dari daftar AODP (ao-bin-dumps/formatted/items.txt).
     Penting: metal refined = METALBAR, stone mentah = ROCK,
     stone refined = STONEBLOCK. Menebak BAR/STONE membuat feed kosong. */
  var CHAINS = [
    { key:'ore',   raw:'ORE',       ref:'METALBAR',   label:'Ore → Bar' },
    { key:'fiber', raw:'FIBER',     ref:'CLOTH',      label:'Fiber → Cloth' },
    { key:'hide',  raw:'HIDE',      ref:'LEATHER',    label:'Hide → Leather' },
    { key:'wood',  raw:'WOOD',      ref:'PLANKS',     label:'Wood → Plank' },
    { key:'stone', raw:'ROCK',      ref:'STONEBLOCK', label:'Stone → Block' }
  ];

  var FISH_COMMON = ['FISH_FRESHWATER_ALL_COMMON', 'FISH_SALTWATER_ALL_COMMON'];
  var FISH_RARE_BIOME = ['FOREST_RARE', 'MOUNTAIN_RARE', 'HIGHLANDS_RARE',
                         'SWAMP_RARE', 'STEPPE_RARE'];
  var FISH_RARE_TIERS = [3, 5, 7];

  var FISH_NAMES = {
      "T1_FISH_FRESHWATER_ALL_COMMON": "Common Rudd",
      "T2_FISH_FRESHWATER_ALL_COMMON": "Striped Carp",
      "T3_FISH_FRESHWATER_ALL_COMMON": "Albion Perch",
      "T3_FISH_FRESHWATER_FOREST_RARE": "Greenriver Eel",
      "T3_FISH_FRESHWATER_HIGHLANDS_RARE": "Stonestream Lurcher",
      "T3_FISH_FRESHWATER_MOUNTAIN_RARE": "Upland Coldeye",
      "T3_FISH_FRESHWATER_STEPPE_RARE": "Lowriver Crab",
      "T3_FISH_FRESHWATER_SWAMP_RARE": "Greenmoor Clam",
      "T4_FISH_FRESHWATER_ALL_COMMON": "Bluescale Pike",
      "T5_FISH_FRESHWATER_ALL_COMMON": "Spotted Trout",
      "T5_FISH_FRESHWATER_FOREST_RARE": "Redspring Eel",
      "T5_FISH_FRESHWATER_HIGHLANDS_RARE": "Rushwater Lurcher",
      "T5_FISH_FRESHWATER_MOUNTAIN_RARE": "Mountain Blindeye",
      "T5_FISH_FRESHWATER_STEPPE_RARE": "Drybrook Crab",
      "T5_FISH_FRESHWATER_SWAMP_RARE": "Murkwater Clam",
      "T6_FISH_FRESHWATER_ALL_COMMON": "Brightscale Zander",
      "T7_FISH_FRESHWATER_ALL_COMMON": "Danglemouth Catfish",
      "T7_FISH_FRESHWATER_FOREST_RARE": "Deadwater Eel",
      "T7_FISH_FRESHWATER_HIGHLANDS_RARE": "Thunderfall Lurcher",
      "T7_FISH_FRESHWATER_MOUNTAIN_RARE": "Frostpeak Deadeye",
      "T7_FISH_FRESHWATER_STEPPE_RARE": "Dusthole Crab",
      "T7_FISH_FRESHWATER_SWAMP_RARE": "Blackbog Clam",
      "T8_FISH_FRESHWATER_ALL_COMMON": "River Sturgeon",
      "T1_FISH_SALTWATER_ALL_COMMON": "Common Herring",
      "T2_FISH_SALTWATER_ALL_COMMON": "Striped Mackerel",
      "T3_FISH_SALTWATER_ALL_COMMON": "Flatshore Plaice",
      "T4_FISH_SALTWATER_ALL_COMMON": "Bluescale Cod",
      "T5_FISH_SALTWATER_ALL_COMMON": "Spotted Wolffish",
      "T6_FISH_SALTWATER_ALL_COMMON": "Strongfin Salmon",
      "T7_FISH_SALTWATER_ALL_COMMON": "Bluefin Tuna",
      "T8_FISH_SALTWATER_ALL_COMMON": "Steelscale Swordfish"
  };

  var CACHE_KEY = 'albion_market_v3';
  var CACHE_TTL = 10 * 60 * 1000;
  var TIMEOUT = 12000;
  var AUTO_REFRESH = 60 * 1000;
  var BATCH = 90;

  /* ---------- state ---------- */
  var S = {
    region: 'west',
    data: {},          /* id -> { city -> {buy, sell, buyMin, sellMax} } */
    fetched: 0,        /* epoch ms */
    status: 'idle',
    error: '',
    lastHost: '',
    usedRegion: 'west' /* region yang benar-benar melayani data */
  };
  var listeners = [];
  var inflight = null;

  function notify() { listeners.forEach(function (fn) { try { fn(api); } catch (e) {} }); }

  /* ---------- id ---------- */
  function rawId(tier, chain) { return 'T' + tier + '_' + chain.raw; }
  function refId(tier, chain) { return 'T' + tier + '_' + chain.ref; }

  /* watchlist: material T2-T8 (raw + refined) + ikan */
  function watchIds() {
    var ids = [], t, c, i;
    for (c = 0; c < CHAINS.length; c++) {
      for (t = TIER_MIN; t <= TIER_MAX; t++) {
        ids.push(rawId(t, CHAINS[c]));
        ids.push(refId(t, CHAINS[c]));
      }
    }
    for (i = 0; i < FISH_COMMON.length; i++) {
      for (t = 1; t <= TIER_MAX; t++) ids.push('T' + t + '_' + FISH_COMMON[i]);
    }
    for (i = 0; i < FISH_RARE_BIOME.length; i++) {
      for (t = 0; t < FISH_RARE_TIERS.length; t++) {
        ids.push('T' + FISH_RARE_TIERS[t] + '_FISH_FRESHWATER_' + FISH_RARE_BIOME[i]);
      }
    }
    return ids.filter(function (v, i2, a) { return a.indexOf(v) === i2; });
  }

  function isFish(id) { return /_FISH_/.test(id || ''); }

  function splitIds(ids) {
    var out = [];
    for (var i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
    return out;
  }

  /* URL untuk AODP.
     PENTING: koma pemisah id harus tetap polos. Kalau di-encode jadi %2C,
     Rails memecah path menjadi segmen terpisah (T4%2CORE -> T4, ORE) dan
     semua harga balik 0. Jadi encode per-id, lalu join dengan koma biasa. */
  function pricesUrl(host, ids) {
    return 'https://' + host + '/api/v2/stats/prices/' +
      ids.map(encodeURIComponent).join(',') + '.json?qualities=1';
  }

  /* ---------- normalisasi ---------- */
  function clean(v) {
    var n = parseFloat(v);
    if (!isFinite(n) || n <= 0 || n === 999999) return 0;
    return n;
  }

  var KNOWN = null;
  function knownSet() {
    if (!KNOWN) {
      KNOWN = {};
      watchIds().forEach(function (id) { KNOWN[id] = 1; });
    }
    return KNOWN;
  }

  function absorb(rows, into) {
    if (!rows || !rows.length) return 0;
    var n = 0;
    var known = knownSet();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.item_id || !r.city) continue;
      if (!known[r.item_id]) S.badShape = true;
      var sell = clean(r.sell_price_min);   /* order jual terendah -> biaya beli instan */
      var buy  = clean(r.buy_price_max);   /* order beli tertinggi -> pendapatan jual instan */
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
        region: S.region, usedRegion: S.usedRegion,
        data: S.data, fetched: S.fetched
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

    var c = opts.force ? null : readCache();
    if (c && c.region === S.region) {
      S.data = c.data;
      S.usedRegion = c.usedRegion || c.region;
      S.fetched = c.fetched;
      var age = Date.now() - c.fetched;
      S.status = hasAny() ? (age < CACHE_TTL ? 'cache' : 'stale') : 'idle';
    }
    if (!hasAny()) S.status = 'loading';
    notify();

    /* region terpilih dulu, sisanya sebagai cadangan supaya
       halaman tidak pernah kosong hanya karena satu region sepi */
    var order = [S.region].concat(REGION_ORDER.filter(function (r) { return r !== S.region; }));
    var ids = watchIds();
    var batches = splitIds(ids);
    var note = '';

    function attemptRegion(region) {
      var host = REGIONS[region].host;
      return batches.reduce(function (chain, batch) {
        return chain.then(function (acc) {
          return request(pricesUrl(host, batch)).then(function (rows) {
            acc.n += absorb(rows, S.data);
            return acc;
          }, function (e) { acc.err = e.message; return acc; });
        });
      }, Promise.resolve({ n: 0, err: '' })).then(function (acc) {
        return { n: acc.n, err: acc.err, region: region, host: host };
      });
    }

    var i = 0;
    function walk() {
      if (i >= order.length) return Promise.resolve({ n: 0, err: note });
      var region = order[i++];
      return attemptRegion(region).then(function (res) {
        if (res.n > 0) return res;
        note = (note ? note + ' · ' : '') + res.region + ' kosong';
        S.data = {};
        return walk();
      });
    }

    inflight = walk().then(function (res) {
      var n = res.n;
      if (n > 0) {
        S.fetched = Date.now();
        S.usedRegion = res.region;
        S.status = 'live';
        S.error = res.region === S.region ? '' : ('data ' + S.region + ' kosong, pakai ' + res.region);
        S.lastHost = res.host;
        writeCache();
      } else {
        if (!hasAny()) S.status = 'offline';
        S.error = note
          || (S.badShape ? 'format respons tidak dikenali (kemungkinan URL salah)' : '')
          || S.error || 'tidak ada data di region ini';
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
    return request(pricesUrl(host, uniq))
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

  /* item gatherable: 5 material mentah */
  function isGather(id) {
    var m = meta(id);
    return m.kind === 'raw';
  }

  /* meta untuk id apa pun, tanpa network */
  function meta(id) {
    if (isFish(id)) {
      var f = /^T(\d)_FISH_(.+)$/.exec(id);
      var tier = f ? parseInt(f[1], 10) : 0;
      var kindTxt = f ? f[2] : '';
      var rare = /RARE/.test(kindTxt);
      return {
        id:id, tier:tier, code:'FISH', kind:'fish', chain:'',
        label:(FISH_NAMES[id] || id) + (tier ? ' T' + tier : ''),
        water:/SALTWATER/.test(kindTxt) ? 'Salt' : 'Fresh',
        rare:rare
      };
    }
    var m = /^T(\d)_?([A-Z]+)$/.exec(id || '');
    if (!m) return { id:id, tier:0, code:id, kind:'other', label:String(id || '—') };
    var t = parseInt(m[1], 10), code = m[2];
    var ch = chainOf(code);
    if (!ch) return { id:id, tier:t, code:code, kind:'other', chain:'',
                       label:code + ' T' + t };
    var kind = (ch.raw === code) ? 'raw' : 'refined';
    var nice = kind === 'raw'
      ? (code.charAt(0) + code.slice(1).toLowerCase())
      : ({ METALBAR:'Bar', CLOTH:'Cloth', LEATHER:'Leather',
           PLANKS:'Plank', STONEBLOCK:'Block' }[code] || code);
    return { id:id, tier:t, code:code, kind:kind, chain:ch.key,
             label:nice + ' T' + t };
  }

  function citiesOf(id) {
    return Object.keys(S.data[id] || {}).sort();
  }

  /* semua entri harga sebuah item per kota */
  function byCity(id) {
    var bag = S.data[id] || {};
    return Object.keys(bag)
      .filter(function (c) { return bag[c].sell > 0 || bag[c].buy > 0; })
      .sort()
      .map(function (c) { return Object.assign({ city:c }, bag[c]); });
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

  function refLive(tier, chain, city) {
    var id = refId(tier, chain);
    var e = at(id, city);
    return e ? { id:id, entry:e } : null;
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
    REGION_ORDER: REGION_ORDER,
    ROYALS: ROYALS,
    EXTRA_CITIES: EXTRA_CITIES,
    CHAINS: CHAINS,
    FISH_NAMES: FISH_NAMES,
    isFish: isFish,
    isGather: isGather,
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
    byCity: byCity,
    tracked: tracked,
    search: search,
    watchIds: watchIds,
    region: function () { return S.region; },
    regionLabel: function () {
      return (REGIONS[S.region] || REGIONS.west).label;
    },
    /* region yang benar-benar melayani data (bisa beda dari pilihan) */
    servingRegion: function () { return S.usedRegion; },
    servingLabel: function () {
      return (REGIONS[S.usedRegion] || REGIONS.west).label;
    },
    isFallback: function () { return S.usedRegion !== S.region; },
    regionShort: function (key) {
      return ((REGIONS[key || S.region]) || REGIONS.west).short;
    },
    hasAny: hasAny,

    status: function () {
      var n = 0;
      for (var id in S.data) n += Object.keys(S.data[id]).length;
      return {
        state:S.status, fetched:S.fetched, error:S.error,
        host:S.lastHost, rows:n, region:S.region, serving:S.usedRegion,
        fallback:S.usedRegion !== S.region
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