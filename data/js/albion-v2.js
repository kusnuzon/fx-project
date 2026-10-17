/* =============================================
   SILVER OPS v2 — app logic (AODP / per-kota)
   Semua harga dari AlbionMarket v3.
   ============================================= */
(function () {
  'use strict';

  var M = window.AlbionMarket;
  var LS_CFG = 'so_cfg_v2', LS_SESS = 'so_sess_v2', LS_VIEW = 'so_view_v2';
  var BUILD = '3.1';
  var LIMIT = 60;

  var RAW_PER = { 2:1, 3:2, 4:2, 5:3, 6:4, 7:5, 8:5 };
  var TX_TIER = { 5:[1070,2130,4270,8530], 6:[1600,3200,6400,12800],
                  7:[2560,5120,10240,20480], 8:[5120,10240,20480,40960] };
  var TX_ENCH = { 4:[1800,3600,7200], 5:[1600,3200,6400],
                  6:[2400,4800,9600], 7:[3840,7680,15360], 8:[7680,15360,30720] };

  var CFG = {
    premium: true, blackMarket: false, sellOrder: true, buyOrder: false,
    setupFee: 2.5, yieldBonus: 58, focus: false, throughput: 600,
    region: 'west', city: 'Thetford', transport: 0
  };

  var STATE = {
    view: 'scan', chain: 'ore', tier: 4,
    qtyRefine: 100, qtyFlip: 100,
    selected: null, query: '', left: 60, searching: false,
    zTier: 3, zProf: 'ore',
    aSortRefine: 'profit', aSortFlip: 'roi', seFocus: null,
    craftProf: 'Smithing', craftTier: 4, craftItem: null, craftEnch: 0,
    craftCity: '', craftQty: 10, craftSort: 'profit', craftBought: {},
    craftDepth: 0, tdTier: 3
  };

  var sessions = [];

  /* ---------- util ---------- */
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function silver(n) {
    n = Math.round(num(n));
    return n.toLocaleString('en-US').replace(/,/g, '.');
  }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + silver(Math.abs(n)); }
  function pct(n) { return (Math.round(n * 10) / 10).toFixed(1) + '%'; }
  function money(n) { return silver(n) + ' ✦'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- fee model ---------- */
  function sellFactor() {
    if (CFG.blackMarket) return 1;
    var tax = CFG.premium ? 0.04 : 0.08;
    var setup = CFG.sellOrder ? CFG.setupFee / 100 : 0;
    return (1 - tax) * (1 - setup);
  }
  function buyFactor() {
    if (CFG.blackMarket) return 1;
    return 1 + (CFG.buyOrder ? CFG.setupFee / 100 : 0);
  }
  function netSell(p) { return p * sellFactor(); }
  function costBuy(p) { return p * buyFactor(); }
  function rrr() {
    var b = num(CFG.yieldBonus) + (CFG.focus ? 59 : 0);
    return 1 - (1 / (1 + b / 100));
  }

  /* harga bahan di kota terpilih; 0 = tidak ada data */
  function matPrice(tier, chain) {
    var e = M.at(M.rawId(tier, chain), CFG.city);
    return e ? e.sell : 0;
  }

  function refineCost(tier, chain) {
    var keep = 1 - rrr(), total = 0, missing = 0, rows = [];
    for (var t = 2; t <= tier; t++) {
      var px = matPrice(t, chain), need = RAW_PER[t] || 0;
      if (px <= 0) missing++;
      var c = need * keep * px;
      total += c;
      rows.push({ tier:t, need:need, price:px, cost:c });
    }
    return { total:total, missing:missing, rows:rows };
  }

  /* ---------- strategi ---------- */
  function flipOpp(m, e) {
    if (!e.sell || !e.buy) return null;
    var profit = netSell(e.buy) - costBuy(e.sell);
    var capital = costBuy(e.sell);
    return {
      kind:'flip', id:m.id, name:m.label, tag:e.city,
      profit:profit, roi:capital > 0 ? (profit / capital) * 100 : 0,
      capital:capital, sph:profit * num(CFG.throughput),
      cells:[
        ['Beli', money(costBuy(e.sell))],
        ['Jual', money(netSell(e.buy))],
        ['Modal', money(capital)]
      ]
    };
  }

  /* arbitrage: beli di kota termurah, jual di kota termahal */
  function arbOpp(m, bag) {
    var cities = Object.keys(bag).filter(function (c) {
      return bag[c].sell > 0 || bag[c].buy > 0;
    });
    var best = null;
    for (var i = 0; i < cities.length; i++) {
      for (var j = 0; j < cities.length; j++) {
        if (i === j) continue;
        var from = bag[cities[i]], to = bag[cities[j]];
        if (!from.sell || !to.buy) continue;
        var spend = costBuy(from.sell) + num(CFG.transport);
        var profit = netSell(to.buy) - spend;
        if (!best || profit > best.profit) {
          best = {
            kind:'arb', id:m.id, name:m.label,
            tag:cities[i] + ' → ' + cities[j],
            profit:profit, roi:spend > 0 ? (profit / spend) * 100 : 0,
            capital:spend, sph:profit * num(CFG.throughput),
            cells:[
              ['Beli di ' + cities[i], money(from.sell)],
              ['Jual di ' + cities[j], money(to.buy)],
              ['Transport', money(num(CFG.transport))]
            ]
          };
        }
      }
    }
    return best;
  }

  function refineOpp(chain, tier) {
    var rl = M.refLive(tier, chain, CFG.city);
    if (!rl || !rl.entry.sell) return null;
    var rc = refineCost(tier, chain);
    if (rc.missing > 0) return null;
    var revenue = netSell(rl.entry.sell);
    var profit = revenue - rc.total;
    return {
      kind:'refine', id:rl.id, name:M.meta(rl.id).label,
      tag:chain.label + ' T' + tier,
      profit:profit, roi:rc.total > 0 ? (profit / rc.total) * 100 : 0,
      capital:rc.total, sph:profit * num(CFG.throughput),
      cells:[
        ['Bahan', money(rc.total)],
        ['Jual/unit', money(revenue)],
        ['Modal', money(rc.total)]
      ]
    };
  }

  function spreadOpp(chain, tier, mode, city) {
    city = city || CFG.city;
    var src = M.refLive(tier, chain, city);
    var dstTier = mode === 'tier' ? tier + 1 : tier;
    var dst = M.refLive(dstTier, chain, city);
    if (!src || !dst || !src.entry.sell || !dst.entry.sell) return null;

    var fee = 0;
    if (mode === 'tier') {
      var a = TX_TIER[tier];
      if (!a) return null;
      fee = a[0];
    } else {
      var b = TX_ENCH[tier];
      if (!b) return null;
      fee = b[0];
    }

    var spend = costBuy(src.entry.sell) + fee;
    var revenue = netSell(dst.entry.sell);
    var profit = revenue - spend;
    return {
      kind:'spread', id:dst.id, name:M.meta(dst.id).label, city:city,
      chain:chain.key, tier:dstTier,
      how:M.meta(src.id).label + ' → ' + (mode === 'tier' ? 'T' + dstTier : '.1') + ' di ' + city,
      tag:M.meta(src.id).label + ' → ' + (mode === 'tier' ? 'T' + dstTier : '.1'),
      profit:profit, roi:spend > 0 ? (profit / spend) * 100 : 0,
      capital:spend, sph:profit * num(CFG.throughput),
      cells:[
        ['Beli + fee', money(spend)],
        ['Jual', money(revenue)],
        ['Modal', money(spend)]
      ]
    };
  }

  /* ---------- strategi: perbandingan kota ---------- */
  function cityOpp() {
    var thru = num(CFG.throughput);
    var list = M.tracked();
    var map = {};
    M.ROYALS.concat(M.EXTRA_CITIES).forEach(function (c) {
      map[c] = { flipWin:0, flipLose:0, bestFlip:0, bestFlipRoi:0,
                 gather:0, fish:0, destBest:0, buyBest:0,
                 destTop:0, buyTop:0, destItem:'', buyItem:'' };
    });

    /* pass 1:hitung puncak harga tiap item per kota */
    var topDest = {}, topBuy = {};
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var rows = M.byCity(m.id);
      var bd = null, bb = null;
      for (var j = 0; j < rows.length; j++) {
        var e = rows[j];
        if (e.buy > 0 && (!bd || e.buy > bd.buy)) bd = e;
        if (e.sell > 0 && (!bb || e.sell < bb.sell)) bb = e;
      }
      if (bd) topDest[m.id] = bd;
      if (bb) topBuy[m.id] = bb;
    }

    /* pass 2:isi per kota */
    for (var k = 0; k < list.length; k++) {
      var it = list[k];
      var rows2 = M.byCity(it.id);
      var dest = topDest[it.id], buyc = topBuy[it.id];
      var isRaw = (it.kind === 'raw'), isFish = (it.kind === 'fish');

      for (var x = 0; x < rows2.length; x++) {
        var en = rows2[x];
        var bag = map[en.city];
        if (!bag) continue;

        if (isRaw && en.buy > 0) {
          var g = netSell(en.buy);
          if (g > bag.gather) bag.gather = g;
        }
        if (isFish && en.buy > 0) {
          var f = netSell(en.buy);
          if (f > bag.fish) bag.fish = f;
        }
        if (dest && dest.city === en.city && dest.buy > 0) {
          bag.destBest++;
          var dv = netSell(dest.buy);
          if (dv > bag.destTop) { bag.destTop = dv; bag.destItem = it.label; }
        }
        if (buyc && buyc.city === en.city && buyc.sell > 0) {
          bag.buyBest++;
          if (buyc.sell < bag.buyTop || !bag.buyTop) { bag.buyTop = buyc.sell; bag.buyItem = it.label; }
        }
        if (en.sell > 0 && en.buy > 0) {
          var pf = netSell(en.buy) - costBuy(en.sell);
          if (pf > 0) {
            bag.flipWin++;
            if (pf > bag.bestFlip) bag.bestFlip = pf;
            var rf = pf / costBuy(en.sell) * 100;
            if (rf > bag.bestFlipRoi) bag.bestFlipRoi = rf;
          } else {
            bag.flipLose++;
          }
        }
      }
    }

    return Object.keys(map).map(function (c) {
      var b = map[c];
      return {
        kind:'city', id:c, name:c,
        tag:b.destBest + ' puncak harga · ' + b.buyBest + ' beli termurah',
        profit:b.destTop, roi:0, capital:0, sph:b.destTop * thru,
        cells:[
          ['Gather terbaik', b.gather > 0 ? money(b.gather) : '—'],
          ['Ikan terbaik', b.fish > 0 ? money(b.fish) : '—'],
          ['Flip 1 kota', b.flipWin + ' untung / ' + b.flipLose + ' rugi']
        ]
      };
    });
  }

  /* ---------- render ---------- */
  function rowHtml(o) {
    var p = o.profit >= 0 ? 'var(--pos)' : 'var(--neg)';
    var roiTxt = o.roiTxt || (o.capital > 0 ? pct(o.roi) + ' ROI' : pct(o.roi) + ' beda kota');
    var badges = (o.badges || []).map(function (b) {
      return '<span class="badge ' + b.cls + '">' + esc(b.t) + '</span> ';
    }).join('');
    var cells = o.cells.map(function (c) {
      return '<span class="r-cell"><span class="r-cell-k">' + esc(c[0]) +
        '</span><span class="r-cell-v">' + esc(c[1]) + '</span></span>';
    }).join('');
    return '<button type="button" class="row' + (STATE.selected === o.id ? ' sel' : '') +
      '" data-id="' + esc(o.id) + '" data-kind="' + esc(o.kind) + '">' +
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span>' +
        (o.how ? '<span class="r-how">' + esc(o.how) + '</span>' : '') + badges + '</span>' +
      '<span class="r-right"><span class="r-profit" style="color:' + p + '">' +
        (o.head || signed(o.profit)) +
        '</span><span class="r-roi">' + roiTxt + ' · ' + money(o.sph) + '/jam</span></span>' +
      '<span class="r-grid">' + cells + '</span></button>';
  }

  
/* ---------- modal 0: apa yang dilakukan saat modal 0 ----------
     Semua baris di sini modalnya 0: barang datang dari node atau sungai
     sendiri, jadi yang dibandingkan adalah kota dengan jual INSTAN
     (buy order tertinggi) paling tinggi. Bonus refine = refined instan
     - mentah instan di kota yang sama. Kalau minus, refining hanya
     membuang waktu. */
  var ZERO_PROF = {
    ore:   { prof:'Mining',           doWhat:'Mine ore' },
    wood:  { prof:'Logging',          doWhat:'Chop wood' },
    fiber: { prof:'Gather/Herbalist', doWhat:'Harvest fiber' },
    hide:  { prof:'Skinning',         doWhat:'Skin animals' },
    stone: { prof:'Stonecutting',     doWhat:'Mine stone' }
  };
  /* average units per node: 1-3 + lucky strike */
  var NODE_YIELD = 2.6;

  /* best city by a price field, already net of tax/setup.
     Kota PK sengaja dilewati: transport bolak-balik ke sana tidak
     masuk akal buat pemain modal 0 dan buy order di sana bukan
     tempat yang aman. */
  var ZERO_SKIP = { 'Brecilien':1, 'Black Market':1 };

  function bestCity(rows, field) {
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][field] <= 0 || ZERO_SKIP[rows[i].city]) continue;
      var v = netSell(rows[i][field]);
      if (!best || v > best.v) best = { city:rows[i].city, v:v, px:rows[i][field] };
    }
    return best;
  }

  function zeroChain(ch, t) {
    var rawId = M.rawId(t, ch), refId = M.refId(t, ch);
    var rawI = bestCity(M.byCity(rawId), 'buy');
    var refI = bestCity(M.byCity(refId), 'buy');
    if (!rawI && !refI) return null;

    /* Bonus refine per kota. Raw jadi opportunity cost: pakai buy order kalau
       ada, kalau tidak pakai sell order supaya premium tidak terlihat murah
       palsu di kota yang buy order bahan mentahnya kosong. */
    var prem = null;
    var refRows = M.byCity(refId);
    for (var i = 0; i < refRows.length; i++) {
      var e = refRows[i];
      if (e.buy <= 0 || ZERO_SKIP[e.city]) continue;
      var r = M.at(rawId, e.city);
      var base = r ? (r.buy > 0 ? r.buy : r.sell) : 0;
      if (base <= 0) continue;
      var v = netSell(e.buy) - netSell(base);
      if (!prem || v > prem.v) prem = { city:e.city, v:v };
    }

    var prof = ZERO_PROF[ch.key] || { prof:'Gather', doWhat:'Gather' };
    var rm = M.meta(refId);
    var doRefine = !!(prem && prem.v > 0);
    var city, net, how, cells, badges;

    if (doRefine) {
      city = prem.city;
      net = netSell(M.at(refId, city).buy);
      how = prof.doWhat + ' T' + t + ' → refine di ' + city + ', jual instan di sana';
      badges = [{ cls:'thin', t:'refine untung' }];
    } else if (rawI) {
      city = rawI.city;
      net = rawI.v;
      how = prof.doWhat + ' T' + t + ' → jual MENTAH instan di ' + city + ', jangan refine';
      badges = [{ cls:'risk', t:'jangan refine' }];
    } else {
      city = refI.city;
      net = 0;
      how = prof.doWhat + ' T' + t + ' → belum ada buy order di region ini, refined harus dipasang order dulu';
      badges = [{ cls:'deep', t:'tidak ada buyer' }];
    }

    cells = [
      ['Raw ' + (rawI ? rawI.city : '—'), money(rawI ? rawI.v : 0)],
      ['Refined ' + (refI ? refI.city : '—'), refI ? money(refI.v) : '—'],
      ['Bonus refine', prem ? signed(prem.v) : '—']
    ];

    return {
      id:refId, kind:'zero', chain:ch.key, tier:t,
      tag:city, name:rm.label + ' · ' + prof.prof, how:how,
      prof:prof.prof, doWhat:prof.doWhat,
      rawLabel:M.meta(rawId).label, refLabel:rm.label,
      mode:doRefine ? 'refine' : (rawI ? 'raw' : 'none'),
      prem:prem ? prem.v : 0,
      profit:net, roi:0, capital:0, sph:net * num(CFG.throughput),
      head:money(net) + ' /unit',
      roiTxt:'≈ ' + money(net * NODE_YIELD) + ' /node',
      badges:badges
    };
  }

  /* fishing: needs food + bait, so flagged as not truly 0 capital */
  function zeroFish(t) {
    var ids = ['T' + t + '_FISH_FRESHWATER_ALL_COMMON',
               'T' + t + '_FISH_SALTWATER_ALL_COMMON'];
    var best = null, side = [];
    for (var i = 0; i < ids.length; i++) {
      var b = bestCity(M.byCity(ids[i]), 'buy');
      side.push(b);
      if (b && (!best || b.v > best.v)) best = { city:b.city, v:b.v, id:ids[i] };
    }
    if (!best) return null;
    return {
      id:best.id, kind:'zero-fish', chain:'', tier:t,
      tag:best.city, name:M.meta(best.id).label + ' · Mancing',
      how:'Pancing T' + t + ' di ' + best.city + ' → jual instan di sana (butuh makanan)',
      prof:'Mancing', doWhat:'Pancing T' + t,
      rawLabel:'Ikan ' + M.meta(best.id).label, refLabel:M.meta(best.id).label,
      mode:'fish', prem:0,
      profit:best.v, roi:0, capital:0, sph:best.v * num(CFG.throughput),
      head:money(best.v) + ' /unit',
      roiTxt:'≈ ' + money(best.v * 1.4) + ' /trip',
      badges:[{ cls:'deep', t:'bukan 0 silver · butuh makanan' }],
      cells:[
        ['Air tawar', side[0] ? money(side[0].v) : '—'],
        ['Air laut', side[1] ? money(side[1].v) : '—'],
        ['Modal', 'makanan + umpan']
      ]
    };
  }

  /* ---------- baris untuk profesi pilihan + cari tier paling murah ---------- */
  var ZERO_TIERS = [2, 3, 4, 5, 6, 7, 8];

  function zeroRowFor(prof, t) {
    if (prof === 'fish') return zeroFish(t);
    var ch = M.CHAINS.filter(function (c) { return c.key === prof; })[0];
    return ch ? zeroChain(ch, t) : null;
  }

  /* tier paling rendah yang masih ada pembelinya — ini yang direkomendasikan
     ke pemain yang alatnya masih kecil */
  function zeroFirstLive(prof) {
    for (var i = 0; i < ZERO_TIERS.length; i++) {
      var r = zeroRowFor(prof, ZERO_TIERS[i]);
      if (r && r.profit > 0) return { tier:ZERO_TIERS[i], row:r };
    }
    return null;
  }

  function zeroRowHtml(o) {
    var badges = (o.badges || []).map(function (b) {
      return '<span class="badge ' + b.cls + '">' + esc(b.t) + '</span> ';
    }).join('');
    var cells = o.cells.map(function (c) {
      return '<span class="r-cell"><span class="r-cell-k">' + esc(c[0]) +
        '</span><span class="r-cell-v">' + esc(c[1]) + '</span></span>';
    }).join('');
    var inner =
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span>' +
        '<span class="r-how">' + esc(o.how) + '</span>' + badges + '</span>' +
      '<span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
        esc(o.head) + '</span><span class="r-roi">' + esc(o.roiTxt) +
        ' · ' + money(o.sph) + '/jam</span></span>' +
      '<span class="r-grid">' + cells + '</span>';
    return o.chain
      ? '<button type="button" class="row" data-chain="' + esc(o.chain) +
        '" data-tier="' + esc(o.tier) + '" data-city="' + esc(o.tag) + '">' + inner + '</button>'
      : '<div class="row">' + inner + '</div>';
  }

  function statBox(k, v, s, cls) {
    return '<div class="stat ' + (cls || '') + '"><span class="stat-k">' + esc(k) +
      '</span><span class="stat-v">' + esc(v) + '</span><span class="stat-s">' +
      esc(s) + '</span></div>';
  }

/* baris pembanding: aksi global terbaik + tier pertama yang ada buyer */
  function zeroAltHtml(o) {
    var inner =
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span>' +
        '<span class="r-how">' + esc(o.how) + '</span>' +
        '<span class="badge deep">' + esc(o.cta) + '</span></span>' +
      '<span class="r-right"><span class="r-profit" style="color:var(--muted)">' +
        esc(o.head) + '</span><span class="r-roi">' + esc(o.roiTxt) + '</span></span>';
    return '<button type="button" class="row" data-zp="' + esc(o.zp) +
      '" data-zt="' + esc(o.zt) + '">' + inner + '</button>';
  }

  function altRow(zp, zt, tag, name, how, cta, r) {
    return {
      zp:zp, zt:zt, tag:tag, name:name, how:how, cta:cta,
      head:money(r.profit) + ' /unit',
      roiTxt:'≈ ' + money(r.mode === 'fish' ? r.profit * 1.4 : r.profit * NODE_YIELD) +
        (r.mode === 'fish' ? ' per trip' : ' per node')
    };
  }

  function zeroAltRows(you, globalBest) {
    var out = [], prof = STATE.zProf;

    if (globalBest && (!you || globalBest.id !== you.id)) {
      out.push(altRow(
        globalBest.chain, globalBest.tier, globalBest.tag, globalBest.name,
        'Paling untung hari ini · ' + globalBest.how, 'pilih ' + globalBest.prof, globalBest));
    }

    /* kalau tier sekarang sepi: arahkan ke tier pertama yang ada buyer.
       kalau sudah untung: tunjukkan satu tingkat di atas yang lebih<'_thick' */
    var first = zeroFirstLive(prof);
    var t = STATE.zTier;
    if (!you || you.profit <= 0) {
      if (first && (!you || first.tier !== t)) {
        out.push(altRow(
          prof, first.tier, first.row.tag, first.row.name,
          'Tier pertama untuk ' + first.row.prof + ' yang ada buyer-nya · ' + first.row.how,
          'pakai ini', first.row));
      }
      return out;
    }
    for (var i = 0; i < ZERO_TIERS.length; i++) {
      var up = ZERO_TIERS[i];
      if (up <= t) continue;
      var r = zeroRowFor(prof, up);
      if (r && r.profit > you.profit) {
        out.push(altRow(
          prof, up, r.tag, r.name,
          'Satu tingkat lebih tinggi · ' + r.how, 'naik ke sini', r));
        break;
      }
    }
    return out;
  }

  /* tier berapa saja yang punya buyer untuk profesi ini */
  function zeroLiveTiers(prof) {
    return ZERO_TIERS.filter(function (t) {
      var r = zeroRowFor(prof, t);
      return r && r.profit > 0;
    });
  }

  /* langkah konkret, disusun dari baris rekomendasi milik user */
  function zeroSteps(you, globalBest, cae) {
    var steps = [
      ['Ambil quest kota + system quest',
        'silver dan item gratis — sumber terbaik saat modal 0'],
      ['Ambil mount gratis Crypt of the Immortals',
        'transport ke ' + cae + ' gratis, jadi refine + jual di sana tanpa ongkos']
    ];

    if (you && you.profit > 0 && you.mode === 'fish') {
      steps.push(['Siapkan makanan + umpan',
        'craft umpan dari fiber; mancing bukan modal 0 karena makanannya dimethyl — ' +
        money(you.profit) + '/ikan instan di ' + you.tag]);
      steps.push(['Pancing ' + you.doWhat + ', jual di ' + you.tag,
        money(you.profit) + '/ikan ≈ ' + money(you.profit * 1.4) + ' per trip']);
    } else if (you && you.profit > 0 && you.mode === 'refine') {
      steps.push([you.doWhat + ' T' + you.tier + ', jangan beli bahannya',
        'bahan mentah gratis dari node']);
      steps.push(['Refine ' + you.refLabel + ' di ' + you.tag,
        'premium ' + signed(you.prem) + '/unit dibanding jual mentah; refine T3+ memakai focus']);
      steps.push(['Jual refined ke buy order di ' + you.tag,
        money(you.profit) + '/unit instan ≈ ' + money(you.profit * NODE_YIELD) + ' per node']);
    } else if (you && you.profit > 0) {
      steps.push([you.doWhat + ' T' + you.tier + ', jangan beli bahannya',
        'bahan mentah gratis dari node']);
      steps.push(['Jual MENTAH ke buy order di ' + you.tag,
        money(you.profit) + '/unit instan ≈ ' + money(you.profit * NODE_YIELD) + ' per node']);
      steps.push(['Jangan refine di tier ini',
        'refined di ' + you.tag + ' lebih murah daripada bahan mentahnya']);
    } else {
      steps.push(['Profesi ini belum bisa dijual di T' + STATE.zTier,
        'pilih tier lain atau profesi lain — daftar di bawah menunjukkan mana yang ada buyer-nya']);
    }

    if (globalBest) {
      steps.push(['Bandingkan dengan aksi terbaik hari ini',
        globalBest.doWhat + ' T' + globalBest.tier + ' di ' + globalBest.tag + ' = ' +
        money(globalBest.profit) + '/unit ≈ ' + money(globalBest.profit * NODE_YIELD) + ' per node']);
    }
    steps.push(['Naik ke node T3 setelah modal sekitar 5.000',
      'premium refine T1–T2 sering minus, di T3 ke atas barulah konsisten']);
    steps.push(['Jangan',
      'flip tanpa modal, farming T4 di Caerleon sebelum gear 4.1, refine T1–T2']);
    return steps.map(function (s, i) {
      return '<li><b>' + (i + 1) + '</b> <b>' + esc(s[0]) + '</b> — ' + esc(s[1]) + '</li>';
    }).join('');
  }

  function renderZero() {
    var t = STATE.zTier;
    var rows = [];
    M.CHAINS.forEach(function (ch) {
      var r = zeroChain(ch, t);
      if (r) rows.push(r);
    });
    var fish = zeroFish(t);
    if (fish) rows.push(fish);
    rows.sort(function (a, b) { return b.profit - a.profit; });

    var you = zeroRowFor(STATE.zProf, t);
    var mats = rows.filter(function (r) { return r.kind === 'zero' && r.profit > 0; });
    var globalBest = mats[0] || null;
    var first = zeroFirstLive(STATE.zProf);
    var st = M.status();
    var cae = 'Caerleon';

    $('zeroStats').innerHTML =
      statBox('Kota untukmu', you ? you.tag : '—',
        you ? you.prof + ' · T' + t : 'tunggu feed', 'pos') +
      statBox('Per node',
        you ? money(you.mode === 'fish' ? you.profit * 1.4 : you.profit * NODE_YIELD) : '—',
        you ? (you.mode === 'fish' ? 'per trip' : silver(NODE_YIELD) + ' unit/node') : 'tunggu feed') +
      statBox('Bonus refine',
        you && you.mode === 'refine' ? signed(you.prem)
          : (you && you.mode === 'fish' ? 'butuh makan' : (you ? 'jangan' : '—')),
        you && you.mode === 'refine' ? 'vs jual mentah' : 'di tier ini',
        you && you.mode === 'refine' ? 'pos' : (you && you.mode === 'raw' ? 'neg' : '')) +
      statBox('Tier siap pakai', first ? 'T' + first.tier : '—',
        first ? (first.tier === t ? 'sudah di tier ini' : 'pertama yang ada buyer')
              : 'belum ada di feed');

    /* hero = rekomendasi untuk profesi + tier milik user */
    var hero = $('zeroHero');
    if (!you) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada data</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Feed belum punya harga T' + t + ' untuk profesi ini di ' +
        esc(M.regionLabel()) + '. Ganti region di atas atau pilih tier lain.</span>';
    } else if (you.profit <= 0) {
      hero.innerHTML =
        '<span class="hero-k">Belum bisa dijual · ' + esc(you.prof) + ' T' + t + '</span>' +
        '<span class="hero-h">Tidak ada buy order</span>' +
        '<span class="hero-s">' + esc(you.how) +
        (first
          ? '. Untuk ' + esc(you.prof) + ' yang paling cepat buat duit: T' + first.tier +
            ' di ' + esc(first.row.tag) + ' (' + money(first.row.profit) + '/unit).'
          : '. Feed belum punya harga di tier mana pun untuk profesi ini.') +
        '</span>';
    } else {
      var what = you.mode === 'refine'
        ? 'Refine ' + you.refLabel + ' di ' + you.tag
        : (you.mode === 'fish'
            ? 'Pancing ' + you.refLabel + ', jual di ' + you.tag
            : 'Jual ' + you.rawLabel + ' di ' + you.tag);
      hero.innerHTML =
        '<span class="hero-k">Rekomendasi · ' + esc(you.prof) + ' T' + t + ' · modal 0</span>' +
        '<span class="hero-h">' + esc(what) + '</span>' +
        '<span class="hero-s">' + esc(you.how) + '</span>' +
        '<span class="hero-money">' +
          money(you.mode === 'fish' ? you.profit * 1.4 : you.profit * NODE_YIELD) +
          (you.mode === 'fish' ? ' per trip' : ' per node') + '</span>' +
        '<span class="hero-meta">' + money(you.profit) + '/unit' +
          (you.mode === 'refine' ? ' · refine ' + signed(you.prem) + ' vs mentah' : '') +
          (you.mode === 'fish' ? ' · bukan modal 0, butuh makanan' : ' · modal 0 ✦') +
          '</span>' +
        '<span class="hero-go">Ketuk baris material di bawah untuk buka kalkulator refine di kota ini.</span>';
    }

    var alts = zeroAltRows(you, globalBest);
    var live = zeroLiveTiers(STATE.zProf);
    $('zYouSub').textContent = live.length
      ? 'buy order ada di T' + live.join(' · T')
      : 'belum ada buy order di tier mana pun';
    $('zAltCount').textContent = alts.length ? alts.length + ' alternatif' : '';
    $('zAltList').innerHTML = alts.map(zeroAltHtml).join('');

    $('zCount').textContent = rows.length + ' opsi';
    $('zList').innerHTML = rows.length
      ? rows.map(zeroRowHtml).join('')
      : '<div class="state">Belum ada harga T' + t + ' di region ini. Ganti region atau tier.</div>';

    $('zSteps').innerHTML = zeroSteps(you, globalBest, cae);

    $('znLadder').innerHTML = tierLadderHtml(ladderCuan(), 'Belum ada gather yang untung.');
  }

  function riskBadges(kind, thin, value) {
    var out = [];
    if (thin) out.push({ cls:'thin', t:'pasar tipis' });
    if (value >= 5000 && (kind === 'arb' || kind === 'fish')) out.push({ cls:'risk', t:'risiko ambush' });
    return out;
  }


/* ---------- auto: perbandingan otomatis ----------
     Semua dihitung dari harga live yang sudah ada di memori, jadi tidak menambah
     request sama sekali. Tujuannya: user sekali lihat langsung tahu harus
     ngapain, tanpa harus pilih kota dulu. */
  function cityList() {
    return M.ROYALS.concat(M.EXTRA_CITIES).filter(function (c) {
      return !ZERO_SKIP[c];
    });
  }

  /* refine di satu kota: bahan dibeli di pasar kota itu */
  function refineOppAt(chain, tier, city) {
    var rl = M.refLive(tier, chain, city);
    if (!rl || !rl.entry.sell) return null;
    var keep = 1 - rrr(), total = 0, missing = 0;
    for (var t = 2; t <= tier; t++) {
      var e = M.at(M.rawId(t, chain), city);
      var px = e ? e.sell : 0;
      if (px <= 0) { missing++; continue; }
      total += (RAW_PER[t] || 0) * keep * px;
    }
    if (missing > 0) return null;
    var revenue = netSell(rl.entry.sell);
    var rawTop = M.at(M.rawId(tier, chain), city);
    var prem = (rawTop && rawTop.buy > 0 && rl.entry.buy > 0)
      ? netSell(rl.entry.buy) - netSell(rawTop.buy) : 0;
    return {
      kind:'refine', id:rl.id, name:M.meta(rl.id).label,
      tag:chain.label + ' T' + tier, city:city, chain:chain.key, tier:tier,
      prem:prem, inst:rl.entry.buy > 0,
      profit:revenue - total,
      roi:total > 0 ? (revenue - total) / total * 100 : 0,
      capital:total, sph:(revenue - total) * num(CFG.throughput),
      cells:[
        ['Bahan/unit', money(total)],
        ['Jual/unit', money(revenue)],
        ['Modal', money(total)]
      ]
    };
  }

  function autoRefine() {
    var out = [], cs = cityList(), t, i;
    M.CHAINS.forEach(function (ch) {
      for (t = M.TIER_MIN; t <= M.TIER_MAX; t++) {
        for (i = 0; i < cs.length; i++) {
          var o = refineOppAt(ch, t, cs[i]);
          if (o && o.profit > 0) {
            o.head = money(o.profit) + ' /unit';
            o.roiTxt = pct(o.roi) + ' ROI · modal ' + money(o.capital);
            o.how = 'Beli bahan di ' + o.city + ', refine, jual refined di ' + o.city;
            o.badges = o.inst ? [] : [{ cls:'thin', t:'tanpa buy order' }];
            out.push(o);
          }
        }
      }
    });
    out.sort(STATE.aSortRefine === 'roi'
      ? function (a, b) { return b.roi - a.roi; }
      : function (a, b) { return b.profit - a.profit; });
    return out;
  }

  /* flip: arbitrage antar kota + flip satu kota di kota acuan */
  function autoFlip() {
    var out = [], list = M.tracked(), i, j;
    for (i = 0; i < list.length; i++) {
      var m = list[i];
      var rows = M.byCity(m.id), bag = {};
      for (j = 0; j < rows.length; j++) {
        if (ZERO_SKIP[rows[j].city]) continue;
        bag[rows[j].city] = rows[j];
      }
      var thin = Object.keys(bag).length <= 2;
      var a = arbOpp(m, bag);
      if (a && a.profit > 0) {
        a.city = a.tag.split(' → ')[1];
        a.how = 'Beli di ' + a.tag.split(' → ')[0] +
          ', jual ke buy order di ' + a.city;
        a.badges = riskBadges('arb', thin, a.profit);
        a.buyPx = Math.round(M.at(m.id, a.tag.split(' → ')[0]).sell || 0);
        a.sellPx = Math.round(M.at(m.id, a.city).buy || 0);
        a.head = money(a.profit) + ' /unit';
        a.roiTxt = pct(a.roi) + ' ROI · modal ' + money(a.capital);
        out.push(a);
      }
      var f = flipOpp(m, M.at(m.id, CFG.city));
      if (f && f.profit > 0) {
        f.how = 'Beli dan jual di ' + CFG.city + ', tanpa transport';
        f.badges = riskBadges('flip', false, f.profit);
        var fe = M.at(m.id, CFG.city);
        f.buyPx = Math.round(fe ? fe.sell : 0);
        f.sellPx = Math.round(fe ? fe.buy : 0);
        f.head = money(f.profit) + ' /unit';
        f.roiTxt = pct(f.roi) + ' ROI · modal ' + money(f.capital);
        out.push(f);
      }
    }
    var k = STATE.aSortFlip;
    out.sort(k === 'profit' ? function (a, b) { return b.profit - a.profit; }
      : k === 'sph' ? function (a, b) { return b.sph - a.sph; }
      : function (a, b) { return b.roi - a.roi; });
    return out;
  }

  /* analisis satu item untuk tab Cari: jual instan, arbitrage, refine */
  function autoItem(m) {
    var rows = M.byCity(m.id).filter(function (e) { return !ZERO_SKIP[e.city]; });
    if (!rows.length) return null;
    var bag = {};
    rows.forEach(function (e) { bag[e.city] = e; });
    var inst = bestCity(rows, 'buy');
    var ord = bestCity(rows, 'sell');
    var arb = arbOpp(m, bag);
    if (arb && arb.profit <= 0) arb = null;

    var ref = null;
    if (m.kind === 'raw' && m.chain) {
      var ch = M.CHAINS.filter(function (c) { return c.key === m.chain; })[0];
      var cs = cityList(), i;
      for (i = 0; i < cs.length; i++) {
        var o = refineOppAt(ch, m.tier, cs[i]);
        if (o && o.profit > 0 && (!ref || o.profit > ref.profit)) ref = o;
      }
    }
    return { inst:inst, ord:ord, arb:arb, ref:ref, thin:Object.keys(bag).length <= 2 };
  }

  /* kalimat verdict: aksi paling menguntungkan untuk item ini */
  function autoVerdict(m, a) {
    if (a.arb && (!a.inst || a.arb.profit > a.inst.v)) {
      var p = a.arb.tag.split(' → ');
      return {
        head:'Beli di ' + p[0] + ', jual instan di ' + p[1],
        money:a.arb.profit, city:a.arb.city,
        meta:pct(a.arb.roi) + ' ROI · modal ' + money(a.arb.capital),
        buy:Math.round(M.at(m.id, p[0]).sell || 0),
        sell:Math.round(M.at(m.id, p[1]).buy || 0)
      };
    }
    if (a.inst) {
      return {
        head:'Jual instan di ' + a.inst.city,
        money:a.inst.v, city:a.inst.city,
        meta:'tanpa transport · ' + (a.ord
          ? 'pasang order di ' + a.ord.city + ' = ' + money(a.ord.v)
          : 'tidak ada kota lain yang punya order'),
        buy:Math.round(M.at(m.id, CFG.city).sell || 0),
        sell:Math.round(a.inst.px)
      };
    }
    return {
      head:'Belum ada buy order di region ini',
      money:0, city:'—',
      meta:a.ord ? 'sell order termurah ' + a.ord.city + ' ' + money(a.ord.v) : 'tidak ada harga sama sekali',
      buy:a.ord ? Math.round(a.ord.px) : 0, sell:0
    };
  }

  /* renderer baris auto; mode refine mengisi chain/tier/kota,
     mode flip mengisi harga beli/jual supaya kalkulator langsung jadi */
  function autoRowHtml(o, mode) {
    var badges = (o.badges || []).map(function (b) {
      return '<span class="badge ' + b.cls + '">' + esc(b.t) + '</span> ';
    }).join('');
    var cells = o.cells.map(function (c) {
      return '<span class="r-cell"><span class="r-cell-k">' + esc(c[0]) +
        '</span><span class="r-cell-v">' + esc(c[1]) + '</span></span>';
    }).join('');
    var attr = mode === 'refine'
      ? ' data-chain="' + esc(o.chain) + '" data-tier="' + esc(o.tier) +
        '" data-city="' + esc(o.city) + '"'
      : ' data-id="' + esc(o.id) + '" data-buy="' + (o.buyPx || 0) +
        '" data-sell="' + (o.sellPx || 0) + '"';
    return '<button type="button" class="row' +
      (STATE.selected === o.id ? ' sel' : '') + '"' + attr + '>' +
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span>' +
        (o.how ? '<span class="r-how">' + esc(o.how) + '</span>' : '') + badges + '</span>' +
      '<span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
        esc(o.head) + '</span><span class="r-roi">' + esc(o.roiTxt) +
        ' · ' + money(o.sph) + '/jam</span></span>' +
      '<span class="r-grid">' + cells + '</span></button>';
  }

  function autoHiddenNote(n) {
    return n > LIMIT
      ? '<p class="hint" style="text-align:center;padding:8px 0">' +
        silver(n - LIMIT) + ' peluang lain disembunyikan.</p>'
      : '';
  }

  function renderRefineAuto() {
    var data = autoRefine();
    var best = data[0];
    var cheap = null;
    data.forEach(function (o) {
      if (o.capital > 0 && (!cheap || o.capital < cheap.capital)) cheap = o;
    });
    $('rfAutoCount').textContent = data.length + ' kombinasi untung';
    $('rfStats').innerHTML =
      statBox('Paling untung', best ? money(best.profit) : '—',
        best ? best.name : 'tunggu feed', 'pos') +
      statBox('Kota', best ? best.city : '—', best ? best.tag : '—') +
      statBox('Modal terkecil', cheap ? money(cheap.capital) : '—',
        cheap ? cheap.name : '—') +
      statBox('Kombinasi', silver(data.length),
        'T' + M.TIER_MIN + '–T' + M.TIER_MAX + ' × ' + cityList().length + ' kota');

    var hero = $('rfAutoHero');
    if (!best) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada kombinasi refine untung</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Feed belum punya harga bahan + refined yang lengkap. ' +
        'Tunggu sinkron atau ganti region.</span>';
      $('rfAutoList').innerHTML = '';
      return;
    }
    hero.innerHTML =
      '<span class="hero-k">Lakukan dulu · refine otomatis</span>' +
      '<span class="hero-h">' + esc(best.name) + ' di ' + esc(best.city) + '</span>' +
      '<span class="hero-s">Beli bahan di ' + esc(best.city) + ', refine, jual refined. ' +
      (best.inst
        ? 'Kalau bahannya kamu gather sendiri, premium di kota itu ' + signed(best.prem) + '/unit.'
        : 'Refined di kota itu belum ada buy order — harus dipasang sell order dan menunggu buyer.') +
      '</span>' +
      '<span class="hero-money">' + money(best.profit) + ' / unit</span>' +
      '<span class="hero-meta">' + pct(best.roi) + ' ROI · modal ' + money(best.capital) +
      ' · ' + money(best.sph) + '/jam</span>' +
      '<span class="hero-go">Ketuk baris di bawah untuk isi kalkulator refine.</span>';
    $('rfAutoList').innerHTML = data.slice(0, LIMIT).map(function (o) {
      return autoRowHtml(o, 'refine');
    }).join('') + autoHiddenNote(data.length);

    /* ladder: refine + transmute dalam satu daftar, semua tier */
    var spread = autoSpread().slice(0, 1).map(function (o) {
      return {
        tier:M.meta(o.id).tier, city:o.city || CFG.city, name:o.name, how:o.how,
        profit:o.profit, roi:o.roi, capital:o.capital, go:'refine',
        goLabel:'Refine', chain:o.chain, id:o.id
      };
    });
    $('rfLadder').innerHTML = tierLadderHtml(
      ladderRefine().concat(spread).sort(function (x, y) { return x.tier - y.tier; }),
      'Belum ada refine yang untung.');
  }

  function renderFlipAuto() {
    var data = autoFlip();
    var best = data[0];
    var cheap = null;
    data.forEach(function (o) {
      if (o.capital > 0 && (!cheap || o.capital < cheap.capital)) cheap = o;
    });
    $('flAutoCount').textContent = data.length + ' peluang untung';
    $('flStats').innerHTML =
      statBox('Paling untung', best ? money(best.profit) : '—',
        best ? best.name : 'tunggu feed', 'pos') +
      statBox('Rute', best ? best.tag : '—',
        best ? 'kota acuan ' + CFG.city + ' · transport ' + money(CFG.transport) : '—') +
      statBox('Modal terkecil', cheap ? money(cheap.capital) : '—',
        cheap ? cheap.name : '—') +
      statBox('Peluang', silver(data.length), M.tracked().length + ' item dipantau');

    var hero = $('flAutoHero');
    if (!best) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada flip untung</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Tidak ada sebaran harga yang beats tax + setup di ' +
        esc(M.regionLabel()) + '. Tunggu feed atau ganti region.</span>';
      $('flAutoList').innerHTML = '';
      return;
    }
    hero.innerHTML =
      '<span class="hero-k">Lakukan dulu · flip otomatis</span>' +
      '<span class="hero-h">' + esc(best.name) + '</span>' +
      '<span class="hero-s">' + esc(best.how) + '</span>' +
      '<span class="hero-money">' + money(best.profit) + ' / unit</span>' +
      '<span class="hero-meta">' + best.roiTxt + ' · ' + money(best.sph) + '/jam' +
      ' · ' + silver(CFG.throughput) + ' unit/jam</span>' +
      '<span class="hero-go">Ketuk baris di bawah untuk isi kalkulator flip.</span>';
    $('flAutoList').innerHTML = data.slice(0, LIMIT).map(function (o) {
      return autoRowHtml(o, 'flip');
    }).join('') + autoHiddenNote(data.length);

    $('flLadder').innerHTML = tierLadderHtml(ladderFlip(), 'Belum ada flip yang untung.');
  }

  function renderSearchAuto(hits) {
    var box = $('seAuto'), btns = $('seAutoBtns');
    if (!hits.length) {
      box.innerHTML = '';
      btns.style.display = 'none';
      return;
    }
    var m = null, i;
    for (i = 0; i < hits.length; i++) {
      if (hits[i].id === STATE.seFocus) { m = hits[i]; break; }
    }
    if (!m) m = hits[0];

    var a = autoItem(m);
    if (!a) {
      box.innerHTML = '<div class="state">Belum ada harga di region ini untuk ' + esc(m.label) + '.</div>';
      btns.style.display = 'none';
      return;
    }
    var v = autoVerdict(m, a);
    var extra = [];
    if (a.ref) {
      extra.push('Refine ' + M.meta(M.refId(m.tier, m.chain)).label + ' di ' + a.ref.city +
        ' = ' + signed(a.ref.prem) + '/unit dari bahan sendiri');
    } else if (m.kind === 'raw') {
      extra.push('Di tier ini refined lebih murah dari bahan mentahnya — jangan refine');
    }
    if (a.thin) extra.push('pasar tipis: item cuma ada di 1–2 kota, harga bisa hilang');

    box.innerHTML =
      '<span class="hero-k">Otomatis · ' + esc(m.label) + '</span>' +
      '<span class="hero-h">' + esc(v.head) + '</span>' +
      '<span class="hero-s">' + esc(v.meta) + '</span>' +
      '<span class="hero-money">' + money(v.money) + ' / unit</span>' +
      '<span class="hero-meta">' + esc(extra.join(' · ') || 'Bandingkan manual di bawah') + '</span>' +
      '<span class="hero-go">Pakai hasil ini: isi Flip atau Refine tanpa ketik ulang.</span>';

    btns.style.display = 'grid';
    $('seToRefine').style.display = a.ref ? '' : 'none';
  }
  function renderRefine() {
    renderRefineAuto();
    var chain = M.CHAINS.filter(function (c) { return c.key === STATE.chain; })[0] || M.CHAINS[0];
    var tier = STATE.tier;
    var rl = M.refLive(tier, chain, CFG.city);
    var rc = refineCost(tier, chain);
    var qty = Math.max(1, STATE.qtyRefine);
    var outSell = rl ? rl.entry.sell : 0;
    var revenue = netSell(outSell);
    var profit = revenue - rc.total;
    var total = profit * qty;
    var be = sellFactor() > 0 ? rc.total / sellFactor() : 0;
    var roi = rc.total > 0 ? (profit / rc.total) * 100 : 0;

    var rowsHtml = rc.rows.slice().reverse().map(function (r) {
      return '<dt>' + esc(chain.raw.charAt(0) + chain.raw.slice(1).toLowerCase()) +
        ' T' + r.tier + ' ×' + r.need + (r.price ? '' : ' (kosong)') +
        '</dt><dd>' + money(r.cost) + '</dd>';
    }).join('');

    $('rfOut').innerHTML =
      '<span class="read big ' + (profit >= 0 ? 'ok' : 'no') + '">' +
        (profit >= 0 ? '▲ Untung ' : '▼ Rugi ') + signed(profit) + ' / unit</span>' +
      '<dl class="kv">' +
      '<dt>Kota</dt><dd>' + esc(CFG.city) + '</dd>' +
      '<dt>Harga jual refined (live)</dt><dd>' + (outSell ? money(outSell) : '—') + '</dd>' +
      '<dt>Setelah tax + setup</dt><dd>' + money(revenue) + '</dd>' +
      '<dt>Biaya bahan / unit</dt><dd>' + money(rc.total) + '</dd>' +
      '<dt>Modal ' + silver(qty) + ' unit</dt><dd>' + money(rc.total * qty) + '</dd>' +
      '<dt>Profit total</dt><dd class="' + (total >= 0 ? 'ok' : 'no') + '">' + signed(total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (roi >= 0 ? 'ok' : 'no') + '">' + pct(roi) + '</dd>' +
      '<dt>Break-even harga jual</dt><dd class="wa">' + money(be) + '</dd>' +
      '<dt>Perkiraan / jam</dt><dd>' + money(profit * num(CFG.throughput)) + '</dd>' +
      '</dl>' +
      (rc.missing ? '<p class="note" style="color:var(--warn)">' + rc.missing +
        ' tier bahan tidak punya harga di ' + esc(CFG.city) +
        ' — hasil ini belum valid, ganti kota atau tunggu feed.</p>' : '') +
      '<details class="hint" style="margin-top:8px"><summary>Rincian rantai bahan</summary>' +
      '<dl class="kv" style="margin-top:6px">' + rowsHtml +
      '<dt>Total</dt><dd>' + money(rc.total) + '</dd></dl></details>' +
      '<p class="hint">RRR ' + pct(rrr() * 100) + ' · yield ' + silver(CFG.yieldBonus) +
      (CFG.focus ? ' +59 focus' : '') + ' · ' + silver(qty) + ' unit.</p>';
  }

  function renderFlip() {
    renderFlipAuto();
    var m = STATE.selected ? M.meta(STATE.selected) : null;
    $('flName').textContent = m ? m.label + ' (' + m.id + ')' : 'belum ada item — cari di tab CARI';

    var buy = num($('flBuy').value), sell = num($('flSell').value);
    var qty = Math.max(1, STATE.qtyFlip);

    if (!buy && !sell) {
      $('flOut').innerHTML = '<div class="state">Isi harga manual, atau pilih item di tab CARI lalu tekan isi.</div>';
      return;
    }
    var netS = netSell(sell), costB = costBuy(buy), profit = netS - costB;
    var total = profit * qty, capital = costB * qty;
    var roi = capital > 0 ? (profit / costB) * 100 : 0;
    var be = sellFactor() > 0 ? costB / sellFactor() : 0;

    $('flOut').innerHTML =
      '<span class="read big ' + (profit >= 0 ? 'ok' : 'no') + '">' +
        (profit >= 0 ? '▲ Untung ' : '▼ Rugi ') + signed(profit) + ' / unit</span>' +
      '<dl class="kv">' +
      '<dt>Harga beli / unit</dt><dd>' + money(costB) + '</dd>' +
      '<dt>Harga jual / unit</dt><dd>' + money(netS) + '</dd>' +
      '<dt>Break-even harga jual</dt><dd class="wa">' + money(be) + '</dd>' +
      '<dt>Modal ' + silver(qty) + ' unit</dt><dd>' + money(capital) + '</dd>' +
      '<dt>Profit total</dt><dd class="' + (total >= 0 ? 'ok' : 'no') + '">' + signed(total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (roi >= 0 ? 'ok' : 'no') + '">' + pct(roi) + '</dd>' +
      '<dt>Perkiraan / jam</dt><dd>' + money(profit * num(CFG.throughput)) + '</dd>' +
      '</dl><p class="hint">Faktor jual ×' + (Math.round(sellFactor() * 1000) / 1000) +
      ' · faktor beli ×' + (Math.round(buyFactor() * 1000) / 1000) + '.</p>';
  }

  function renderSearch() {
    var q = STATE.query, box = $('seList');
    if (q.length < 2) {
      renderSearchAuto([]);
      box.innerHTML = '<div class="state">Ketik minimal 2 huruf. Contoh: <b>ORE</b>, <b>CLOTH</b>, ' +
        '<b>WOOD</b>, atau id bebas seperti <b>T6_SWORD</b> — item di luar watchlist diambil on-demand.</div>';
      return;
    }
    var hits = M.search(q);
    if (STATE.searching) {
      renderSearchAuto([]);
      box.innerHTML = '<div class="state">Mengambil harga “' + esc(q) + '” dari feed…</div>';
      return;
    }
    if (!hits.length) {
      renderSearchAuto([]);
      box.innerHTML = '<div class="state">Tidak ada “' + esc(q) + '”. Coba id persis, misal <b>T6_CLOTH</b>.</div>';
      return;
    }
    renderSearchAuto(hits);
    box.innerHTML = hits.map(function (m) {
      var a = autoItem(m);
      if (!a) {
        return '<div class="state">' + esc(m.label) + ': belum ada harga di region ini.</div>';
      }
      var v = autoVerdict(m, a);
      var p = v.money > 0 ? 'var(--pos)' : 'var(--muted)';
      return '<button type="button" class="row" data-id="' + esc(m.id) + '"' +
        ' data-buy="' + v.buy + '" data-sell="' + v.sell + '">' +
        '<span class="r-main"><span class="r-tag">' + esc(v.city) + '</span>' +
        '<span class="r-name">' + esc(m.label) + '</span>' +
        '<span class="r-how">' + esc(v.head) + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:' + p + '">' +
          (v.money > 0 ? signed(v.money) : '—') +
        '</span><span class="r-roi">per unit</span></span>' +
        '<span class="r-grid">' +
        '<span class="r-cell"><span class="r-cell-k">Beli</span><span class="r-cell-v">' + (v.buy ? money(v.buy) : '—') + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Jual</span><span class="r-cell-v">' + (v.sell ? money(v.sell) : '—') + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Id</span><span class="r-cell-v">' + esc(m.id) + '</span></span>' +
        '</span></button>';
    }).join('');
  }

/* peluang terbaik lintas semua strategi. Tidak bergantung mode di tab Scan,
     supaya angka pembanding di tab Catatan selalu konsisten. */
  function bestOppNow(pre) {
    pre = pre || {};
    var best = null;
    function take(o) {
      if (!o || !(o.sph > 0)) return;
      if (!best || o.sph > best.sph) best = o;
    }
    var fl = pre.flip || autoFlip();
    if (fl.length) take(fl[0]);
    var rf = pre.refine || autoRefine();
    if (rf.length) take(rf[0]);
    var t = STATE.zTier, i;
    for (i = 0; i < M.CHAINS.length; i++) take(zeroChain(M.CHAINS[i], t));
    take(zeroFish(t));
    if (!best) return null;
    /* asalkan tab tujuan supaya tombol bisa langsung membuka tempatnya */
    best.go = best.kind === 'refine' ? 'refine'
      : (best.kind === 'zero' || best.kind === 'zero-fish') ? 'zero' : 'flip';
    return best;
  }

  function rateOf(s) { return s.min > 0 ? s.silver / (s.min / 60) : 0; }

  function renderSession() {
    var box = $('snList'), tot = 0, min = 0, best = null;
    sessions.forEach(function (s) {
      tot += s.silver; min += s.min;
      if (!best || rateOf(s) > rateOf(best)) best = s;
    });
    var rate = min > 0 ? tot / (min / 60) : 0;
    /* daftar dihitung sekali lalu dipakai untuk hero, stat, dan saran aktivitas */
    var flAll = autoFlip(), rfAll = autoRefine();
    var top = bestOppNow({ flip:flAll, refine:rfAll });
    var topRate = top ? top.sph : 0;
    var gap = rate > 0 && topRate > 0 ? (rate / topRate) * 100 : 0;

    $('snStats').innerHTML =
      statBox('Kecepatan kamu', rate > 0 ? money(rate) : '—',
        rate > 0 ? silver(sessions.length) + ' sesi · ' + (min / 60).toFixed(1) + ' jam'
                 : 'belum ada catatan', rate > 0 ? 'pos' : '') +
      statBox('Peluang terbaik', topRate > 0 ? money(topRate) : '—',
        top ? top.name + ' · ' + top.tag : 'tunggu feed') +
      statBox('Selisih', rate > 0 && topRate > 0 ? pct(gap) : '—',
        rate > 0 && topRate > 0
          ? (gap >= 100 ? 'kamu sudah lebih cepat' : 'peluang ' + pct(100 - gap) + ' lebih tinggi')
          : 'isi catatan dulu',
        rate > 0 && topRate > 0 ? (gap >= 100 ? 'pos' : 'neg') : '') +
      statBox('Terbaik kamu', best ? money(rateOf(best)) : '—',
        best ? esc(best.act) : '—');

    /* hero: kesimpulan otomatis, tidak perlu user paham rumus */
    var hero = $('snHero');
    if (!top) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada peluang yang bisa dihitung</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Tunggu feed harga selesai sync, atau ganti region di atas.</span>';
    } else if (!rate) {
      hero.innerHTML =
        '<span class="hero-k">Mulai dari yang ini</span>' +
        '<span class="hero-h">' + esc(top.name) + '</span>' +
        '<span class="hero-s">' + esc(top.how || top.tag) + '</span>' +
        '<span class="hero-money">' + money(topRate) + ' / jam</span>' +
        '<span class="hero-meta">perkiraan dengan ' + silver(CFG.throughput) +
        ' unit/jam · modal ' + (top.capital > 0 ? money(top.capital) : '0 ✦') + '</span>' +
        '<span class="hero-go">Catat silver yang benar-benar kamu dapat, lalu ulangi — ' +
        'nanti muncul perbandingan kecepatan kamu vs peluang.</span>';
    } else if (gap >= 100) {
      hero.innerHTML =
        '<span class="hero-k">Catatan kamu · lebih cepat dari peluang</span>' +
        '<span class="hero-h">' + esc(best.act) + '</span>' +
        '<span class="hero-s">' + money(rateOf(best)) + ' per jam, peluang terbaik di scanner ' +
        money(topRate) + ' per jam (' + esc(top.name) + ' di ' + esc(top.tag) + ').</span>' +
        '<span class="hero-money">' + money(rate) + ' / jam</span>' +
        '<span class="hero-meta">' + pct(gap) + ' dari peluang terbaik · ' +
        silver(sessions.length) + ' sesi tercatat</span>' +
        '<span class="hero-go">Pertahankan aktivitas ini.</span>';
    } else {
      hero.innerHTML =
        '<span class="hero-k">Catatan kamu · belumARNING secepat peluang</span>' +
        '<span class="hero-h">' + esc(top.name) + '</span>' +
        '<span class="hero-s">' + esc(top.how || top.tag) +
        ' — peluang ini ' + pct(100 - gap) + ' lebih tinggi dari kecepatan catatamu (' +
        money(rate) + ' per jam).</span>' +
        '<span class="hero-money">' + money(topRate) + ' / jam</span>' +
        '<span class="hero-meta">' + money(rate) + ' per jam sekarang · modal ' +
        (top.capital > 0 ? money(top.capital) : '0 ✦') +
        ' · ketuk tombol di bawah untuk membukanya</span>' +
        '<span class="hero-go">Coba satu siklus, lalu catat hasilnya di sini untuk dibandingkan.</span>';
    }

    /* saran aktivitas supaya tidak perlu ketik dari nol */
    var acts = [], i;
    for (i = 0; i < Math.min(3, rfAll.length); i++) {
      acts.push('refine ' + rfAll[i].chain + ' T' + rfAll[i].tier + ' di ' + rfAll[i].city);
    }
    for (i = 0; i < Math.min(3, flAll.length); i++) {
      acts.push('flip ' + flAll[i].name + ' ' + flAll[i].tag);
    }
    $('snActs').innerHTML = acts.map(function (a) {
      return '<option value="' + esc(a) + '"></option>';
    }).join('');
    $('snAct').setAttribute('list', 'snActs');

    box.innerHTML = sessions.length
      ? sessions.map(function (s) {
          var r = rateOf(s);
          var d = topRate > 0 && r > 0 ? (r / topRate) * 100 : 0;
          var cmp = topRate > 0 && r > 0
            ? '<span class="sess-m"> · ' + (d >= 100 ? 'lebih cepat dari peluang' : 'di bawah peluang ' + pct(d)) + '</span>'
            : '';
          return '<div class="sess"><span class="sess-a">' +
            '<span class="sess-n">' + esc(s.act) + '</span>' +
            '<span class="sess-m">' + silver(s.min) + ' mnt · ' + money(r) + '/jam' + cmp + '</span>' +
            '</span><span class="sess-v" style="color:' + (s.silver >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
            signed(s.silver) + '</span>' +
            '<button type="button" class="x" data-i="' + i + '" aria-label="Hapus catatan">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>';
        }).join('')
      : '<div class="state">Belum ada catatan. Isi aktivitas + silver bersih + durasi, lalu tekan ' +
        '<b>Tambah catatan</b> — setelah itu bagian ini otomatis membandingkan kecepatanmu dengan ' +
        'peluang terbaik dan memberi tahu kalau ada yang lebih cepat.</div>';
  }
/* ---------- crafting: resep + harga live ----------
     Semua recipe sudah dibundel di data/js/albion-crafting.js (hasil kurasi
     dari ao-bin-dumps, hanya item yang punya harga pasar di AODP). Untung,
     ROI, dan bahan dihitung ulang di sini dari harga live per kota, jadi
     angka ikut berubah tiap refresh. */
  var C = window.AlbionCrafting || { items:[], prof:[], cities:[], watch:[] };
  var CRAFT_TIERS = [1, 2, 3, 4, 5, 6, 7, 8];
  var CRAFT_MAX_MULT = C.maxMult || 25;   /* batas atas harga jual vs biaya bahan */
  var CRAFT_MED_MULT = C.medMult || 3;   /* batas harga vs median kota lain */

  function craftItems(prof, tier) {
    return C.items.filter(function (it) {
      return (prof === 'all' || it.prof === prof) &&
             (tier === 'all' || it.tier === tier);
    });
  }

  /* harga jual hasil craft; varian .1/.2 punya id sendiri di AODP */
  function craftPriceId(item, v) {
    return v.ench > 0 ? item.id + '@' + v.ench : item.id;
  }

  /* harga gila (salah ketik / sentinel AODP) dianggap tidak ada */
  function craftPx(e, field) {
    if (!e) return 0;
    var v = num(e[field]);
    return (v <= 0 || v >= 999999) ? 0 : v;
  }

  /* median harga jual item di semua kota; dipakai mendeteksi harga gila
     yang cuma muncul di satu kota */
  function craftMedian(item, v) {
    var id = craftPriceId(item, v), vals = [], i;
    for (i = 0; i < C.cities.length; i++) {
      var e = M.at(id, C.cities[i]);
      var p = craftPx(e, 'sell'), b = craftPx(e, 'buy');
      var m = Math.max(p, b);
      if (m > 0) vals.push(m);
    }
    if (!vals.length) return 0;
    vals.sort(function (x, y) { return x - y; });
    return vals[Math.floor(vals.length / 2)];
  }

  /* berapa kota yang punya harga untuk hasil craft; 1-2 kota = pasar tipis */
  function craftDepth(item, v) {
    var id = craftPriceId(item, v), n = 0, i;
    for (i = 0; i < C.cities.length; i++) {
      var e = M.at(id, C.cities[i]);
      if (craftPx(e, 'sell') > 0 || craftPx(e, 'buy') > 0) n++;
    }
    return n;
  }

  /* biaya bahan + harga jual di satu kota. missing = bahan tanpa harga */
  function craftEval(item, v, city, qty) {
    qty = qty > 0 ? qty : 1;
    var keep = 1 - rrr(), missing = [], cost = 0;
    for (var i = 0; i < v.res.length; i++) {
      var rid = v.res[i][0], n = v.res[i][1];
      var e = M.at(rid, city);
      var px = craftPx(e, 'sell');
      if (px <= 0) { missing.push(rid); continue; }
      cost += n * keep * px;
    }
    var pid = craftPriceId(item, v);
    var pe = M.at(pid, city);
    var sell = netSell(craftPx(pe, 'sell'));
    var buy = netSell(craftPx(pe, 'buy'));
    /* harga di atas median kota lain = data anomaly, abaikan */
    var med = craftMedian(item, v);
    if (med > 0 && Math.max(sell, buy) > med * CRAFT_MED_MULT) sell = 0, buy = 0;
    /* harga jual lebih dari maxMult x biaya bahan juga tidak masuk akal */
    if (cost > 0 && Math.max(sell, buy) > cost * CRAFT_MAX_MULT) sell = 0, buy = 0;
    var rev = Math.max(sell, buy);
    var profit = (missing.length || rev <= 0) ? 0 : rev - cost;
    return {
      city:city, qty:qty, cost:cost, sell:sell, buy:buy, rev:rev,
      profit:profit, total:profit * qty,
      roi:cost > 0 ? (profit / cost) * 100 : 0,
      missing:missing, instant:buy >= sell && buy > 0,
      capital:cost * qty
    };
  }

  /* baris crafting terbaik: per item ambil varian + kota paling untung */
  function craftRow(item, qty) {
    var best = null, bv = null, rows = [];
    for (var i = 0; i < item.v.length; i++) {
      var v = item.v[i], bc = null;
      for (var j = 0; j < C.cities.length; j++) {
        var ev = craftEval(item, v, C.cities[j], qty);
        if (ev.missing.length || ev.rev <= 0) continue;
        if (!bc || ev.profit > bc.profit) bc = ev;
      }
      if (!bc || bc.profit <= 0) continue;
      rows.push({ v:v, ev:bc });
      if (!best || bc.profit > best.profit) { best = bc; bv = v; }
    }
    if (!best) return null;
    return {
      kind:'craft', id:item.id, chain:item.id, item:item, v:bv, ev:best, rows:rows,
      name:item.name, tier:item.tier, prof:item.prof,
      tag:item.prof + ' · ' + item.tier + (bv.ench ? '.' + bv.ench : ''),
      city:best.city, profit:best.profit, roi:best.roi, capital:best.capital,
      sph:best.total * num(CFG.throughput),
      head:money(best.profit) + ' /unit',
      roiTxt:pct(best.roi) + ' ROI · modal ' + money(best.capital),
      how:'Bahan di ' + best.city + ' → craft di ' + best.city + ', jual di ' + best.city +
         ' · focus ' + silver(bv.focus) + (bv.silver ? ' + silver ' + money(bv.silver) : ''),
      thin:craftDepth(item, bv) <= 2
    };
  }

  function craftList(prof, tier, qty) {
    var items = craftItems(prof, tier), out = [], i;
    for (i = 0; i < items.length; i++) {
      var r = craftRow(items[i], qty);
      if (r) out.push(r);
    }
    var key = STATE.craftSort;
    out.sort(key === 'roi' ? function (a, b) { return b.roi - a.roi; }
      : key === 'total' ? function (a, b) { return b.ev.total - a.ev.total; }
      : function (a, b) { return b.profit - a.profit; });
    return out;
  }

  /* rincian bahan untuk satu item di kota tertentu */
  function craftDetail(item, v, city, qty) {
    var keep = 1 - rrr(), rows = [], cost = 0, missing = 0;
    for (var i = 0; i < v.res.length; i++) {
      var rid = v.res[i][0], n = v.res[i][1];
      var e = M.at(rid, city);
      var px = e ? e.sell : 0;
      var c = px > 0 ? n * keep * px : 0;
      if (px <= 0) missing++;
      cost += c;
      rows.push({
        id:rid, name:M.meta(rid).label, need:n, price:px, cost:c,
        share:0, missing:px <= 0
      });
    }
    for (var j = 0; j < rows.length; j++) {
      rows[j].share = cost > 0 ? (rows[j].cost / cost) * 100 : 0;
    }
    rows.sort(function (a, b) { return b.cost - a.cost; });
    return { rows:rows, cost:cost, missing:missing, qty:qty };
  }

  function renderCraftDetail() {
    var it = stateCraftItem();
    var box = $('cfDetail');
    if (!it) {
      box.innerHTML = '<div class="state">Ketuk salah satu item di atas untuk melihat rincian bahan.</div>';
      return;
    }
    var v = stateCraftVariant(it);
    var city = STATE.craftCity || CFG.city;
    if (C.cities.indexOf(city) < 0) city = C.cities[0] || CFG.city;
    var d = craftDetail(it, v, city, STATE.craftQty);
    var ev = craftEval(it, v, city, STATE.craftQty);
    var pid = craftPriceId(it, v);

    box.innerHTML =
      '<span class="read big ' + (ev.profit >= 0 && !d.missing ? 'ok' : 'no') + '">' +
        (d.missing ? 'Bahan belum punya harga'
          : ev.profit >= 0 ? '▲ Untung ' + signed(ev.total) + ' total'
          : '▼ Rugi ' + signed(ev.total) + ' total') + '</span>' +
      '<dl class="kv">' +
      '<dt>Item</dt><dd>' + esc(it.name) + (v.ench ? ' .' + v.ench : '') + '</dd>' +
      '<dt>Id</dt><dd>' + esc(pid) + '</dd>' +
      '<dt>Profesi</dt><dd>' + esc(it.prof) + ' · T' + it.tier + '</dd>' +
      '<dt>Kota</dt><dd>' + esc(city) + '</dd>' +
      '<dt>Harga jual (live)</dt><dd>' +
        (ev.sell > 0 ? money(ev.sell) : '—') +
        (ev.instant ? ' <span class="badge thin">instan</span>' : '') + '</dd>' +
      '<dt>Harga jual via order</dt><dd>' + (ev.buy > 0 ? money(ev.buy) : '—') + '</dd>' +
      '<dt>Biaya bahan / unit</dt><dd>' + money(d.cost) + '</dd>' +
      '<dt>Jumlah craft</dt><dd>' + silver(STATE.craftQty) + '</dd>' +
      '<dt>Modal total</dt><dd>' + money(d.cost * STATE.craftQty) + '</dd>' +
      '<dt>Untung / unit</dt><dd class="' + (ev.profit >= 0 ? 'ok' : 'no') + '">' + signed(ev.profit) + '</dd>' +
      '<dt>Untung total</dt><dd class="' + (ev.total >= 0 ? 'ok' : 'no') + '">' + signed(ev.total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (ev.roi >= 0 ? 'ok' : 'no') + '">' + pct(ev.roi) + '</dd>' +
      '<dt>Focus per craft</dt><dd class="wa">' + silver(v.focus) + '</dd>' +
      (v.silver ? '<dt>Silver per craft</dt><dd>' + money(v.silver) + '</dd>' : '') +
      '<dt>Waktu craft</dt><dd>' + v.time.toFixed(2) + ' detik</dd>' +
      '</dl>' +
      (d.missing ? '<p class="note" style="color:var(--warn)">' + d.missing +
        ' bahan tidak punya harga di ' + esc(city) +
        ' — feed AODP crowd-sourced, tunggu sinkron atau ganti region.</p>' : '') +
      '<details class="hint" style="margin-top:8px"><summary>Bahan yang dibutuhkan (' +
        d.rows.length + ')</summary><dl class="kv" style="margin-top:6px">' +
      d.rows.map(function (r) {
        return '<dt>' + esc(r.name) + ' ×' + silver(r.need) +
          (r.missing ? ' (kosong)' : '') + '</dt><dd' +
          (r.missing ? ' class="no"' : '') + '>' + money(r.cost) +
          (r.cost > 0 ? ' · ' + Math.round(r.share) + '%' : '') + '</dd>';
      }).join('') +
      '<dt>Total bahan</dt><dd>' + money(d.cost) + '</dd></dl>' +
      '<p class="hint">Biaya bahan sudah dikali RRR ' + pct(rrr() * 100) +
      ' (yield ' + silver(CFG.yieldBonus) +
      (CFG.focus ? ' +59 focus' : '') + ') — sebagian bahan kembali sebagai material tier bawah.</p></details>';
  }

  function stateCraftItem() {
    var want = STATE.craftItem;
    if (!want) return null;
    for (var i = 0; i < C.items.length; i++) {
      if (C.items[i].id === want) return C.items[i];
    }
    return null;
  }

  function stateCraftVariant(it) {
    var want = STATE.craftEnch;
    for (var i = 0; i < it.v.length; i++) {
      if (it.v[i].ench === want) return it.v[i];
    }
    return it.v[0];
  }

  function renderCraft() {
    var prof = STATE.craftProf, tier = STATE.craftTier;
    var qty = Math.max(1, STATE.craftQty);
    var data = craftList(prof, tier, qty);
    var best = data[0];

    /* tier yang benar-benar punya data untuk profesi terpilih */
    var tiers = CRAFT_TIERS.filter(function (t) {
      return craftItems(prof, t).length > 0;
    });

    $('cfTier').querySelectorAll('.chip').forEach(function (x) {
      x.style.display = tiers.indexOf(num(x.dataset.ct)) > -1 ? '' : 'none';
    });
    if (tiers.length && tiers.indexOf(tier) < 0) STATE.craftTier = tiers[0];

    $('cfStats').innerHTML =
      statBox('Paling untung', best ? money(best.profit) : '—',
        best ? best.name : 'belum ada harga', 'pos') +
      statBox('Kota', best ? best.city : '—', best ? best.prof + ' T' + best.tier : '—') +
      statBox('ROI', best ? pct(best.roi) : '—',
        best ? 'modal ' + money(best.capital) : '—') +
      statBox('Item terhitung', silver(data.length),
        (prof === 'all' ? 'semua profesi' : prof) +
        (tier === 'all' ? ' · semua tier' : ' · T' + tier));

    var hero = $('cfHero');
    if (!best) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada yang bisa dihitung</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Resep crafting tersedia, tapi harga bahan atau harga jualnya belum ada di ' +
        esc(M.regionLabel()) + '. Ganti region atau tunggu feed.</span>';
    } else {
      hero.innerHTML =
        '<span class="hero-k">Craft dulu · ' + esc(best.prof) + ' T' + best.tier + '</span>' +
        '<span class="hero-h">' + esc(best.name) + (best.v.ench ? ' .' + best.v.ench : '') +
        ' di ' + esc(best.city) + '</span>' +
        '<span class="hero-s">' + esc(best.how) + '</span>' +
        '<span class="hero-money">' + money(best.profit) + ' / unit</span>' +
        '<span class="hero-meta">' + pct(best.roi) + ' ROI · untung ' + signed(best.ev.total) +
        ' untuk ' + silver(qty) + ' unit · ' + money(best.sph) + '/jam</span>' +
        '<span class="hero-go">Ketuk item untuk melihat bahan, harga jual, dan perbandingan kota.</span>';
    }

    $('cfCount').textContent = data.length + ' item untung';
    $('cfList').innerHTML = data.length
      ? data.slice(0, LIMIT).map(function (o) {
          return '<button type="button" class="row' +
            (STATE.craftItem === o.id ? ' sel' : '') +
            '" data-craft="' + esc(o.id) + '" data-ench="' + (o.v ? o.v.ench : 0) + '">' +
            '<span class="r-main"><span class="r-tag">' + esc(o.city) + '</span>' +
            '<span class="r-name">' + esc(o.name) + (o.v.ench ? ' .' + o.v.ench : '') + '</span>' +
            '<span class="r-how">' + esc(o.prof) + ' T' + o.tier + ' · modal ' + money(o.capital) + '</span>' +
            (o.thin ? '<span class="badge thin">harga tipis</span>' : '') +
            '</span><span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
            esc(o.head) + '</span><span class="r-roi">' + esc(o.roiTxt) + '</span></span>' +
            '<span class="r-grid">' +
            '<span class="r-cell"><span class="r-cell-k">Bahan</span><span class="r-cell-v">' +
              money(o.ev.cost) + '</span></span>' +
            '<span class="r-cell"><span class="r-cell-k">Jual</span><span class="r-cell-v">' +
              money(o.ev.rev) + '</span></span>' +
            '<span class="r-cell"><span class="r-cell-k">Untung ' + silver(qty) + 'x</span>' +
              '<span class="r-cell-v" style="color:var(--pos)">' + signed(o.ev.total) + '</span></span>' +
            '</span></button>';
        }).join('') + autoHiddenNote(data.length)
      : '<div class="state">Belum ada crafting yang untung di ' + esc(prof === 'all' ? 'profesi ini' : prof) +
        ' T' + tier + ' untuk region ' + esc(M.regionLabel()) + '.</div>';

    renderCraftDetail();
    renderCraftCities();
    renderCraftShop();
    $('cfLadder').innerHTML = tierLadderHtml(ladderCraft(qty), 'Belum ada crafting yang untung.');
  }

  /* perbandingan kota untuk item yang sedang dipilih */
  function renderCraftCities() {
    var box = $('cfCityList');
    var it = stateCraftItem();
    if (!it) {
      $('cfCityCount').textContent = '';
      box.innerHTML = '';
      return;
    }
    var v = stateCraftVariant(it), qty = Math.max(1, STATE.craftQty);
    var rows = [], i;
    STATE.craftDepth = craftDepth(it, v);
    for (i = 0; i < C.cities.length; i++) {
      var ev = craftEval(it, v, C.cities[i], qty);
      if (ev.missing.length) continue;
      rows.push({
        city:ev.city, cost:ev.cost, rev:ev.rev, profit:ev.profit,
        roi:ev.roi, total:ev.total, instant:ev.instant
      });
    }
    rows.sort(function (a, b) { return b.profit - a.profit; });
    $('cfCityCount').textContent = rows.length ? rows.length + ' kota terhitung' : 'tidak ada kota';
    box.innerHTML = rows.length
      ? rows.map(function (r) {
          return '<button type="button" class="row' +
            (STATE.craftCity === r.city ? ' sel' : '') +
            '" data-craft-city="' + esc(r.city) + '">' +
            '<span class="r-main"><span class="r-tag">' + esc(r.city) + '</span>' +
            '<span class="r-name">' + esc(it.name) + (v.ench ? ' .' + v.ench : '') + '</span>' +
            (r.instant ? '<span class="badge thin">jual instan</span>' : '') +
            (STATE.craftDepth <= 2 ? '<span class="badge risk">hanya ' + STATE.craftDepth + ' kota</span>' : '') +
            '</span>' +
            '<span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
            signed(r.profit) + '</span><span class="r-roi">' + pct(r.roi) + ' ROI</span></span>' +
            '<span class="r-grid">' +
            '<span class="r-cell"><span class="r-cell-k">Bahan</span><span class="r-cell-v">' +
              money(r.cost) + '</span></span>' +
            '<span class="r-cell"><span class="r-cell-k">Jual</span><span class="r-cell-v">' +
              money(r.rev) + '</span></span>' +
            '<span class="r-cell"><span class="r-cell-k">Untung total</span>' +
              '<span class="r-cell-v" style="color:var(--pos)">' + signed(r.total) + '</span></span>' +
            '</span></button>';
        }).join('')
      : '<div class="state">Belum ada kota yang punya harga bahan lengkap untuk item ini.</div>';
  }
/* ---------- crafting: daftar belanja bahan ----------
     Dipisah dari kalkulator untung supaya dua pertanyaan terpisah:
     "berapa untung" (angka) dan "apa yang harus dibeli" (lista belanja). */
  function craftBestBuy(id) {
    var best = null, i, p, e;
    for (i = 0; i < C.cities.length; i++) {
      p = craftPx(M.at(id, C.cities[i]), 'sell');
      if (p > 0 && (!best || p < best.price)) best = { city:C.cities[i], price:p };
    }
    return best;
  }

  function craftBuyList(item, v, city, qty) {
    var keep = 1 - rrr(), rows = [], cost = 0, missing = 0, i;
    for (i = 0; i < v.res.length; i++) {
      var rid = v.res[i][0], n = v.res[i][1];
      var e = M.at(rid, city);
      var px = craftPx(e, 'sell');
      var need = n * keep * qty;
      var done = num(STATE.craftBought[rid]);
      var left = Math.max(0, need - done);
      var c = px > 0 ? px * need : 0;
      var best = px > 0 ? craftBestBuy(rid) : null;
      cost += c;
      if (px <= 0) missing++;
      rows.push({
        id:rid, name:M.meta(rid).label, raw:n, need:need, left:left, price:px,
        cost:c, share:0, missing:px <= 0,
        done:need > 0 && done >= need,
        cheaper:!!(best && px > 0 && best.city !== city && best.price < px * 0.95),
        cheapest:best
      });
    }
    rows.sort(function (a, b) { return b.cost - a.cost; });
    for (i = 0; i < rows.length; i++) {
      rows[i].share = cost > 0 ? (rows[i].cost / cost) * 100 : 0;
    }
    return { rows:rows, cost:cost, missing:missing };
  }

  function craftShopHtml(d, city) {
    return d.rows.map(function (r) {
      var priceTxt = r.missing
        ? '<span style="color:var(--warn)">belum ada harga di ' + esc(city) + '</span>'
        : money(r.price) + ' <span style="color:var(--dim)">/unit</span>';
      var qtyTxt = r.done
        ? '<span style="color:var(--pos)">sudah lengkap</span>'
        : '<b>' + silver(Math.ceil(r.left)) + '</b>' +
          (r.left !== r.need ? '<span style="color:var(--dim)"> dari ' + silver(Math.ceil(r.need)) + '</span>' : '');
      return '<button type="button" class="row' + (r.done ? ' sel' : '') +
        '" data-buy="' + esc(r.id) + '">' +
        '<span class="r-main"><span class="r-tag">' + (r.done ? '✓' : Math.round(r.share) + '%') + '</span>' +
        '<span class="r-name">' + esc(r.name) + '</span>' +
        '<span class="r-how">' + esc(r.id) + ' · resep ×' + silver(r.raw) +
        (r.cheaper ? ' · <span style="color:var(--warn)">lebih murah di ' + esc(r.cheapest.city) +
          ' ' + money(r.cheapest.price) + '</span>' : '') + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:' +
          (r.missing ? 'var(--warn)' : 'var(--pos)') + '">' + qtyTxt + '</span>' +
        '<span class="r-roi">' + (r.missing ? '—' : money(r.cost)) + '</span></span>' +
        '<span class="r-grid">' +
        '<span class="r-cell"><span class="r-cell-k">Harga</span><span class="r-cell-v">' + priceTxt + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Sisa</span><span class="r-cell-v">' +
          silver(Math.ceil(r.left)) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Total</span><span class="r-cell-v">' +
          (r.missing ? '—' : money(r.cost)) + '</span></span>' +
        '</span></button>';
    }).join('');
  }

  function craftShopText(d, item, v, city, qty) {
    var lines = ['Belanja untuk ' + item.name + (v.ench ? ' .' + v.ench : '') +
      ' ×' + silver(qty) + ' di ' + city];
    d.rows.forEach(function (r) {
      lines.push('- ' + r.id + ' x' + silver(Math.ceil(r.need)) +
        ' (' + r.name + ')' + (r.price > 0 ? ' @ ' + silver(r.price) : ' [harga belum ada]'));
    });
    lines.push('Total bahan: ' + silver(Math.round(d.cost)) + ' silver');
    lines.push('Fokus total: ' + silver(Math.round(v.focus * qty)));
    return lines.join('\n');
  }

  function renderCraftShop() {
    var it = stateCraftItem();
    var box = $('cfShop'), head = $('cfShopHead');
    if (!it) {
      head.textContent = '';
      box.innerHTML = '<div class="state">Pilih dulu item di daftar atas — daftar belanjanya muncul di sini.</div>';
      return;
    }
    var v = stateCraftVariant(it);
    var city = STATE.craftCity || CFG.city;
    if (C.cities.indexOf(city) < 0) city = C.cities[0] || CFG.city;
    var qty = Math.max(1, STATE.craftQty);
    var d = craftBuyList(it, v, city, qty);
    var done = d.rows.filter(function (r) { return r.done; }).length;
    var ev = craftEval(it, v, city, qty);

    head.textContent = d.rows.length + ' bahan · ' + done + '/' + d.rows.length + ' siap';
    box.innerHTML = craftShopHtml(d, city);

    $('cfShopTotal').innerHTML =
      '<div class="read big ' + (ev.total >= 0 && !d.missing ? 'ok' : 'no') + '">' +
      (d.missing ? 'Bahan belum lengkap'
        : ev.total >= 0 ? '▲ Bersih ' + signed(ev.total)
        : '▼ Rugi ' + signed(ev.total)) + '</div>' +
      '<dl class="kv">' +
      '<dt>Total bahan (' + silver(qty) + ' craft)</dt><dd>' + money(d.cost) + '</dd>' +
      '<dt>Harga jual hasil</dt><dd>' + (ev.rev > 0 ? money(ev.rev) + ' /unit' : '—') + '</dd>' +
      '<dt>Pendapatan total</dt><dd>' + (ev.rev > 0 ? money(ev.rev * qty) : '—') + '</dd>' +
      '<dt>Untung bersih</dt><dd class="' + (ev.total >= 0 ? 'ok' : 'no') + '">' +
        signed(d.missing ? 0 : ev.total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (ev.roi >= 100 ? 'ok' : 'wa') + '">' + pct(ev.roi) + '</dd>' +
      '<dt>Fokus total</dt><dd class="wa">' + silver(Math.round(v.focus * qty)) + '</dd>' +
      '<dt>Waktu craft total</dt><dd>' + (v.time * qty / 60).toFixed(1) + ' menit</dd>' +
      '</dl>';

    $('cfPlanSteps').innerHTML =
      '<li><b>1</b> Beli <b>' + silver(d.rows.length) + ' bahan</b> di ' + esc(city) +
        ' — total <b>' + money(d.cost) + '</b>' +
        (d.missing ? ' (' + d.missing + ' bahan belum ada harga)' : '') + '</li>' +
      '<li><b>2</b> Craft <b>' + silver(qty) + '×</b> ' + esc(it.name) +
        (v.ench ? ' .' + v.ench : '') + ' — fokus ' + silver(Math.round(v.focus * qty)) +
        ', waktu ' + (v.time * qty / 60).toFixed(1) + ' menit</li>' +
      '<li><b>3</b> Jual di <b>' + esc(city) + '</b> — ' +
        (ev.rev > 0 ? money(ev.rev) + ' /unit, terima ' + money(ev.rev * qty) : 'belum ada harga jual') +
        (ev.rev > 0 ? ', bersih ' + signed(d.missing ? 0 : ev.total) : '') + '</li>';
  }
/* ---------- ladder tier: paling untung di T1-T8 ----------
     Satu komponen untuk semua tab. Tujuannya: user di tier rendah tetap
     melihat opsi yang benar-benar bisa dikerjakannya, bukan cuma T7-T8.
     Setiap baris bisa diketuk untuk membuka tab kegiatannya. */
  function tierLadderHtml(rows, emptyTxt) {
    if (!rows.length) {
      return '<div class="state">' + esc(emptyTxt || 'Belum ada data di feed.') + '</div>';
    }
    return rows.map(function (r) {
      var right = r.perNode
        ? money(r.profit * NODE_YIELD) + ' /node'
        : money(r.profit) + ' /unit';
      var attr = ' data-go="' + esc(r.go) + '" data-tier="' + esc(r.tier) + '"' +
        (r.id ? ' data-id="' + esc(r.id) + '"' : '') +
        (r.chain ? ' data-chain="' + esc(r.chain) + '"' : '') +
        (r.ench != null ? ' data-ench="' + esc(r.ench) + '"' : '') +
        (r.city ? ' data-city="' + esc(r.city) + '"' : '');
      return '<button type="button" class="row"' + attr + '>' +
        '<span class="r-main"><span class="r-tag">T' + r.tier + '</span>' +
        '<span class="r-name">' + esc(r.name) + (r.ench ? ' .' + r.ench : '') + '</span>' +
        '<span class="r-how">' + esc(r.how) + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
          right + '</span><span class="r-roi">' +
          (r.roi != null ? pct(r.roi) + ' ROI' : 'modal ' + money(r.capital || 0)) +
          '</span></span>' +
        '<span class="r-grid">' +
          '<span class="r-cell"><span class="r-cell-k">Kota</span><span class="r-cell-v">' +
            esc(r.city) + '</span></span>' +
          '<span class="r-cell"><span class="r-cell-k">Modal</span><span class="r-cell-v">' +
            esc(r.capital > 0 ? money(r.capital) : '0 ✦') + '</span></span>' +
          '<span class="r-cell"><span class="r-cell-k">Buka</span><span class="r-cell-v">' +
            esc(r.goLabel) + '</span></span>' +
        '</span></button>';
    }).join('');
  }

  /* modal 0: gather + mancing, terbaik tiap tier */
  function ladderCuan() {
    var out = [], i, k, t, best;
    for (i = 0; i < ZERO_TIERS.length; i++) {
      t = ZERO_TIERS[i];
      best = null;
      for (k = 0; k < M.CHAINS.length; k++) {
        var z = zeroChain(M.CHAINS[k], t);
        if (z && z.profit > 0 && (!best || z.profit > best.profit)) best = z;
      }
      var f = zeroFish(t);
      if (f && f.profit > 0 && (!best || f.profit > best.profit)) best = f;
      if (!best) continue;
      out.push({
        tier:t, city:best.tag, name:best.name, how:best.how, profit:best.profit,
        perNode:best.mode !== 'fish', capital:0, go:'zero', goLabel:'Cuan',
        id:best.id, chain:best.chain
      });
    }
    return out;
  }

  /* crafting: terbaik tiap tier */
  function ladderCraft(qty) {
    var out = [], i;
    for (i = 0; i < CRAFT_TIERS.length; i++) {
      var t = CRAFT_TIERS[i];
      var data = craftList('all', t, qty);
      if (!data.length) continue;
      var b = data[0];
      out.push({
        tier:t, city:b.city, name:b.name, ench:b.v.ench, how:b.how, profit:b.profit,
        roi:b.roi, capital:b.capital, go:'craft', goLabel:'Craft', id:b.id
      });
    }
    return out;
  }

  /* refine: terbaik tiap tier (bahan dibeli di kota yang sama) */
  function ladderRefine() {
    var data = autoRefine(), by = {};
    data.forEach(function (o) {
      if (!by[o.tier] || o.profit > by[o.tier].profit) by[o.tier] = o;
    });
    return Object.keys(by).map(function (t) {
      var o = by[t];
      return {
        tier:o.tier, city:o.city, name:o.name, how:o.how, profit:o.profit,
        roi:o.roi, capital:o.capital, go:'refine', goLabel:'Refine',
        chain:o.chain, id:o.id
      };
    }).sort(function (a, b) { return a.tier - b.tier; });
  }

  /* transmute: tier -> tier dan enchant, biaya fee dari tabel */
  function autoSpread() {
    var out = [], cs = cityList(), t, i, mode;
    for (t = M.TIER_MIN + 1; t <= M.TIER_MAX; t++) {
      for (i = 0; i < M.CHAINS.length; i++) {
        for (mode = 0; mode < 2; mode++) {
          var best = null;
          for (var c = 0; c < cs.length; c++) {
            var o = spreadOpp(M.CHAINS[i], t, mode === 0 ? 'tier' : 'ench', cs[c]);
            if (o && o.profit > 0 && (!best || o.profit > best.profit)) best = o;
          }
          if (best) out.push(best);
        }
      }
    }
    out.sort(function (a, b) { return b.profit - a.profit; });
    return out;
  }

  function ladderSpread() {
    var data = autoSpread(), by = {};
    data.forEach(function (o) {
      var tier = M.meta(o.id).tier;
      if (!by[tier] || o.profit > by[tier].profit) by[tier] = o;
    });
    return Object.keys(by).map(function (t) {
      var o = by[t];
      return {
        tier:num(t), city:o.city || CFG.city, name:o.name, how:o.how,
        profit:o.profit, roi:o.roi, capital:o.capital, go:'refine', goLabel:'Refine',
        chain:o.chain, id:o.id
      };
    }).sort(function (a, b) { return a.tier - b.tier; });
  }

  /* flip antar kota: terbaik tiap tier */
  function ladderFlip() {
    var data = autoFlip(), by = {};
    data.forEach(function (o) {
      var tier = M.meta(o.id).tier || 0;
      if (!by[tier] || o.profit > by[tier].profit) by[tier] = o;
    });
    return Object.keys(by).map(function (t) {
      var o = by[t];
      return {
        tier:num(t), city:o.tag, name:o.name, how:o.how, profit:o.profit,
        roi:o.roi, capital:o.capital, go:'flip', goLabel:'Flip', id:o.id
      };
    }).sort(function (a, b) { return a.tier - b.tier; });
  }

  /* ---------- hari ini: satu jawaban untuk tier yang dipilih ---------- */
  function renderToday() {
    var tier = STATE.tdTier;
    var qty = Math.max(1, STATE.craftQty);
    var st = M.status();

    $('tdTier').querySelectorAll('.chip').forEach(function (x) {
      x.setAttribute('aria-pressed', String(num(x.dataset.tt) === tier));
    });

    var cuan = ladderCuan(), craft = ladderCraft(qty);
    var refine = ladderRefine(), flip = ladderFlip(), spread = ladderSpread();

    function at(list) {
      for (var i = 0; i < list.length; i++) if (list[i].tier === tier) return list[i];
      return null;
    }
    var opts = [at(cuan), at(craft), at(refine), at(flip), at(spread)].filter(Boolean);
    /* bandingkan per unit yang sama: gather dibalik jadi per node */
    opts.sort(function (a, b) {
      var x = a.perNode ? a.profit * NODE_YIELD : a.profit;
      var y = b.perNode ? b.profit * NODE_YIELD : b.profit;
      return y - x;
    });
    var top = opts[0] || null;

    $('tdStats').innerHTML =
      statBox('Paling untung T' + tier, top ? money(top.perNode ? top.profit * NODE_YIELD : top.profit) : '—',
        top ? top.name : 'belum ada data', 'pos') +
      statBox('Kota', top ? top.city : '—', top ? top.goLabel : '—') +
      statBox('Modal', top ? (top.capital > 0 ? money(top.capital) : '0 ✦') : '—',
        top ? (top.capital > 0 ? 'per unit' : 'barang dari node') : '—') +
      statBox('Data feed', silver(st.rows), M.servingLabel());

    var hero = $('tdHero');
    if (!top) {
      hero.innerHTML =
        '<span class="hero-k">Belum ada peluang di T' + tier + '</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Feed belum punya harga untuk tier ini di ' + esc(M.regionLabel()) +
        '. Coba tier lain atau ganti region di atas.</span>';
    } else {
      hero.innerHTML =
        '<span class="hero-k">Lakukan dulu · ' + esc(top.goLabel) + ' · T' + tier + '</span>' +
        '<span class="hero-h">' + esc(top.name) + (top.ench ? ' .' + top.ench : '') + '</span>' +
        '<span class="hero-s">' + esc(top.how) + '</span>' +
        '<span class="hero-money">' +
          money(top.perNode ? top.profit * NODE_YIELD : top.profit) +
          (top.perNode ? ' / node' : ' / unit') + '</span>' +
        '<span class="hero-meta">' + (top.roi != null ? pct(top.roi) + ' ROI · ' : '') +
          'modal ' + (top.capital > 0 ? money(top.capital) : '0 ✦') +
          ' · ketuk baris di bawah untuk membuka ' + esc(top.goLabel) + '</span>' +
        '<span class="hero-go">Kalau ini belum cocok dengan alatmu, pilih tier lain di atas.</span>';
    }

    $('tdCuan').innerHTML = tierLadderHtml(cuan, 'Belum ada gather yang untung.');
    $('tdCraft').innerHTML = tierLadderHtml(craft, 'Belum ada crafting yang untung.');
    $('tdRefine').innerHTML = tierLadderHtml(refine, 'Belum ada refine yang untung.');
    $('tdSpread').innerHTML = tierLadderHtml(spread, 'Belum ada transmute yang untung.');
    $('tdFlip').innerHTML = tierLadderHtml(flip, 'Belum ada flip antar kota yang untung.');

    /* kota: bukan tier, jadi format barisnya sendiri */
    var cities = cityOpp().slice().sort(function (a, b) { return b.profit - a.profit; })
      .slice(0, LIMIT);
    $('tdCity').innerHTML = cities.length ? cities.map(function (c) {
      return '<div class="row"><span class="r-main">' +
        '<span class="r-tag">' + esc(c.name) + '</span>' +
        '<span class="r-how">' + esc(c.tag) + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:var(--pos)">' +
          money(c.profit) + '</span><span class="r-roi">gather terbaik di kota</span></span>' +
        '<span class="r-grid">' + c.cells.map(function (x) {
          return '<span class="r-cell"><span class="r-cell-k">' + esc(x[0]) +
            '</span><span class="r-cell-v">' + esc(x[1]) + '</span></span>';
        }).join('') + '</span></div>';
    }).join('') : '<div class="state">Belum ada data kota.</div>';
  }
  /* ---------- shell ---------- */
  var VIEWS = ['scan', 'zero', 'craft', 'refine', 'flip', 'session', 'search'];

  function setView(v) {
    STATE.view = v;
    VIEWS.forEach(function (x) {
      var n = $('view-' + x);
      if (n) n.classList.toggle('on', x === v);
    });
    document.querySelectorAll('.nav button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.v === v));
    });
    try { localStorage.setItem(LS_VIEW, v); } catch (e) {}
    renderAll();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    if (STATE.view === 'scan') renderToday();
    else if (STATE.view === 'zero') renderZero();
    else if (STATE.view === 'craft') renderCraft();
    else if (STATE.view === 'refine') renderRefine();
    else if (STATE.view === 'flip') renderFlip();
    else if (STATE.view === 'session') renderSession();
    else if (STATE.view === 'search') renderSearch();
    updateFeed();
  }

  function updateFeed() {
    var s = M.status();
    var map = {
      live:['LIVE', 'on'], cache:['CACHE', 'warn'], stale:['STALE', 'warn'],
      loading:['SYNC', 'load'], offline:['OFFLINE', 'off'], idle:['IDLE', '']
    };
    var m = map[s.state] || map.idle;
    $('feedPill').textContent = m[0];
    $('feedPill').className = 'pill ' + m[1];
    $('feedDot').className = 'dot ' + m[1];
    var when = s.fetched
      ? new Date(s.fetched).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      : '—';
    $('feedNote').textContent =
      (s.state === 'live' ? 'live' : s.state === 'offline' ? 'gagal' : 'cache') +
      ' · ' + M.servingLabel() + ' · ' + CFG.city + ' · update ' + when +
      ' · next ' + STATE.left + 's · ' + silver(s.rows) + ' baris harga';

    var rn = $('regionNote');
    if (rn) {
      rn.textContent = s.fallback && s.state === 'live'
        ? '⚠ ' + M.regionLabel() + ' sedang kosong di feed — harga di bawah memakai data ' + M.servingLabel() + '.'
        : M.regionLabel() + ' · ' + CFG.city;
      rn.style.color = (s.fallback && s.state === 'live') ? 'var(--warn)' : 'var(--dim)';
    }
    var banner = $('offBanner');
    banner.style.display = s.state === 'offline' ? 'block' : 'none';
    banner.textContent = 'Feed live gagal: ' + (s.error || 'tidak diketahui') +
      '. Angka memakai cache terakhir atau diisi manual — semua kalkulator tetap jalan. ' +
      'Kalau ini tetap muncul, kirimkan build ' + BUILD + ' beserta pesan ini.';
  }

  function syncRegionSeg() {
    var seg = $('regionSeg');
    if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.r === CFG.region));
    });
  }

  function fillCfgInputs() {
    syncRegionSeg();
    $('cCity').value = CFG.city;
    $('cPremium').checked = CFG.premium;
    $('cBM').checked = CFG.blackMarket;
    $('cSell').checked = CFG.sellOrder;
    $('cBuy').checked = CFG.buyOrder;
    $('cSetup').value = CFG.setupFee;
    $('cYield').value = CFG.yieldBonus;
    $('cFocus').checked = CFG.focus;
    $('cThru').value = CFG.throughput;
    $('cTransport').value = CFG.transport;
  }

  function saveCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify(CFG)); } catch (e) {} }

  function readCfg() {
    CFG.city = $('cCity').value;
    CFG.premium = $('cPremium').checked;
    CFG.blackMarket = $('cBM').checked;
    CFG.sellOrder = $('cSell').checked;
    CFG.buyOrder = $('cBuy').checked;
    CFG.setupFee = num($('cSetup').value);
    CFG.yieldBonus = num($('cYield').value);
    CFG.focus = $('cFocus').checked;
    CFG.throughput = num($('cThru').value);
    CFG.transport = num($('cTransport').value);
    if (CFG.blackMarket) { CFG.sellOrder = false; CFG.buyOrder = false; }
    saveCfg();
    fillCfgInputs();
    renderAll();
  }

  function setRegion(key) {
    if (!key || key === CFG.region) return;
    CFG.region = key;
    STATE.selected = null;
    saveCfg();
    syncRegionSeg();
    renderAll();
    M.load({ region: key, force: true });
  }

  /* ---------- init ---------- */
  function init() {
    try { Object.assign(CFG, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch (e) {}
    try { sessions = JSON.parse(localStorage.getItem(LS_SESS) || '[]') || []; } catch (e) {}
    try { STATE.view = localStorage.getItem(LS_VIEW) || 'scan'; } catch (e) {}
    if (VIEWS.indexOf(STATE.view) < 0) STATE.view = 'scan';

    fillCfgInputs();

    /* tombol region: west / east / europe */
    var rseg = $('regionSeg');
    M.REGION_ORDER.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.r = k;
      b.textContent = M.regionShort(k);
      b.setAttribute('aria-selected', String(k === CFG.region));
      rseg.appendChild(b);
    });
    rseg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) setRegion(b.dataset.r);
    });

    /* isi dropdown kota */
    var citySel = $('cCity');
    M.ROYALS.concat(M.EXTRA_CITIES).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      citySel.appendChild(o);
    });
    citySel.value = CFG.city;

    document.querySelectorAll('.nav button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.v); });
    });

    /* chip tier di Hari Ini */
    $('tdTier').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.tdTier = num(c.dataset.tt);
      renderToday();
    });

    /* ketuk baris ladder -> buka tab kegiatannya dengan tier yang sama */
    ['tdCuan', 'tdCraft', 'tdRefine', 'tdSpread', 'tdFlip'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var b = e.target.closest('button.row');
        if (!b) return;
        var go = b.dataset.go, tier = num(b.dataset.tier), view = go;
        if (go === 'zero') {
          STATE.zTier = tier;
          $('zTier').querySelectorAll('.chip').forEach(function (x) {
            x.setAttribute('aria-pressed', String(num(x.dataset.zt) === tier));
          });
        } else if (go === 'craft') {
          STATE.craftTier = tier;
          if (b.dataset.id) STATE.craftItem = b.dataset.id;
          if (b.dataset.ench != null) STATE.craftEnch = num(b.dataset.ench);
          $('cfTier').querySelectorAll('.chip').forEach(function (x) {
            x.setAttribute('aria-pressed', String(num(x.dataset.ct) === tier));
          });
        } else if (go === 'refine') {
          if (b.dataset.chain) {
            STATE.chain = b.dataset.chain;
            $('rfChain').value = STATE.chain;
          }
          if (tier) {
            STATE.tier = tier;
            $('rfTier').value = String(tier);
          }
          if (b.dataset.city && M.ROYALS.indexOf(b.dataset.city) > -1) {
            CFG.city = b.dataset.city;
            saveCfg();
            fillCfgInputs();
          }
        } else if (go === 'flip') {
          STATE.selected = b.dataset.id || null;
          if (b.dataset.city && M.ROYALS.indexOf(b.dataset.city) > -1) {
            CFG.city = b.dataset.city;
            saveCfg();
            fillCfgInputs();
          }
        } else {
          return;
        }
        setView(view);
      });
    });

    $('zProf').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.zProf = c.dataset.zp;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderZero();
    });

    $('zAltList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.zProf = b.dataset.zp;
      STATE.zTier = num(b.dataset.zt) || STATE.zTier;
      $('zProf').querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x.dataset.zp === STATE.zProf));
      });
      $('zTier').querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(num(x.dataset.zt) === STATE.zTier));
      });
      renderZero();
    });

    $('zTier').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.zTier = num(c.dataset.zt) || 3;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderZero();
    });

    $('zList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.chain = b.dataset.chain;
      STATE.tier = num(b.dataset.tier);
      $('rfChain').value = STATE.chain;
      $('rfTier').value = String(STATE.tier);
      /* buka kalkulator di kota yang direkomendasikan baris itu */
      if (b.dataset.city && M.ROYALS.indexOf(b.dataset.city) > -1 && b.dataset.city !== CFG.city) {
        CFG.city = b.dataset.city;
        saveCfg();
        fillCfgInputs();
      }
      setView('refine');
    });

    $('rfChain').addEventListener('change', function () { STATE.chain = this.value; renderRefine(); });
    $('rfTier').addEventListener('change', function () { STATE.tier = num(this.value); renderRefine(); });
    $('rfQty').addEventListener('input', function () { STATE.qtyRefine = num(this.value) || 1; renderRefine(); });

    $('flBuy').addEventListener('input', renderFlip);
    $('flSell').addEventListener('input', renderFlip);
    $('flQty').addEventListener('input', function () { STATE.qtyFlip = num(this.value) || 1; renderFlip(); });
    $('flFromSel').addEventListener('click', function () {
      var e = M.at(STATE.selected, CFG.city);
      if (!e) { alert('Pilih item dulu di tab CARI.'); return; }
      $('flBuy').value = Math.round(e.sell || 0);
      $('flSell').value = Math.round(e.buy || 0);
      renderFlip();
    });

    /* cari: id di luar watchlist diambil on-demand (1 request) */
    var t = null;
    /* ketuk baris bahan -> tandai sudah dibeli (bisa di-undo) */
    $('cfShop').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      var it = stateCraftItem();
      if (!it) return;
      var v = stateCraftVariant(it);
      var city = STATE.craftCity || CFG.city;
      if (C.cities.indexOf(city) < 0) city = C.cities[0] || CFG.city;
      var id = b.dataset.buy;
      var need = 0;
      for (var i = 0; i < v.res.length; i++) {
        if (v.res[i][0] === id) need = v.res[i][1] * (1 - rrr()) * Math.max(1, STATE.craftQty);
      }
      if (STATE.craftBought[id] >= need) delete STATE.craftBought[id];
      else STATE.craftBought[id] = need;
      renderCraftShop();
    });

    $('cfPreset').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.craftPreset = num(c.dataset.cp);
      STATE.craftQty = STATE.craftPreset;
      $('cfQty').value = STATE.craftQty;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderCraft();
    });

    $('cfCopy').addEventListener('click', function () {
      var it = stateCraftItem();
      if (!it) return;
      var v = stateCraftVariant(it);
      var city = STATE.craftCity || CFG.city;
      if (C.cities.indexOf(city) < 0) city = C.cities[0] || CFG.city;
      var qty = Math.max(1, STATE.craftQty);
      var txt = craftShopText(craftBuyList(it, v, city, qty), it, v, city, qty);
      var done = function () {
        var btn = this;
        var old = btn.textContent;
        btn.textContent = 'Tersalin';
        setTimeout(function () { btn.textContent = old; }, 1400);
      }.bind(this);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () {});
      } else {
        var ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });

    $('cfShopReset').addEventListener('click', function () {
      STATE.craftBought = {};
      renderCraftShop();
    });

    $('cfProf').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.craftProf = c.dataset.cp;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderCraft();
    });

    $('cfTier').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.craftTier = num(c.dataset.ct);
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderCraft();
    });

    $('cfSort').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.craftSort = c.dataset.cs;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderCraft();
    });

    $('cfQty').addEventListener('input', function () {
      STATE.craftQty = num(this.value) || 1;
      renderCraft();
    });

    /* ketuk item crafting -> buka rincian bahan */
    $('cfList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.craftItem = b.dataset.craft;
      STATE.craftEnch = num(b.dataset.ench);
      renderCraft();
      renderCraftCities();
    });

    /* ketuk kota -> pakai kota itu untuk rincian */
    $('cfCityList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.craftCity = b.dataset.craftCity;
      if (M.ROYALS.indexOf(STATE.craftCity) > -1) {
        CFG.city = STATE.craftCity;
        saveCfg();
        fillCfgInputs();
      }
      renderCraft();
    });

    $('rfSort').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.aSortRefine = c.dataset.v;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderRefine();
    });

    $('flSort').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.aSortFlip = c.dataset.v;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderFlip();
    });

    /* ketuk baris refine otomatis -> isi kalkulator refine */
    $('rfAutoList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.chain = b.dataset.chain;
      STATE.tier = num(b.dataset.tier);
      $('rfChain').value = STATE.chain;
      $('rfTier').value = String(STATE.tier);
      if (b.dataset.city && M.ROYALS.indexOf(b.dataset.city) > -1) {
        CFG.city = b.dataset.city;
        saveCfg();
        fillCfgInputs();
      }
      renderRefine();
    });

    /* ketuk baris flip otomatis -> isi kalkulator flip */
    $('flAutoList').addEventListener('click', function (e) {
      var b = e.target.closest('button.row');
      if (!b) return;
      STATE.selected = b.dataset.id;
      if (num(b.dataset.buy)) $('flBuy').value = num(b.dataset.buy);
      if (num(b.dataset.sell)) $('flSell').value = num(b.dataset.sell);
      renderFlip();
    });

    /* tombol di kartu otomatis tab Cari */
    $('seToFlip').addEventListener('click', function () {
      var m = STATE.seFocus ? M.meta(STATE.seFocus) : null;
      var hits = m ? M.search(m.id) : [];
      var a = m && hits.length ? autoItem(hits[0]) : null;
      if (!a) return;
      var v = autoVerdict(hits[0], a);
      STATE.selected = hits[0].id;
      $('flBuy').value = v.buy;
      $('flSell').value = v.sell;
      setView('flip');
    });

    $('seToRefine').addEventListener('click', function () {
      var m = STATE.seFocus ? M.meta(STATE.seFocus) : null;
      var hits = m ? M.search(m.id) : [];
      var a = m && hits.length ? autoItem(hits[0]) : null;
      if (!a || !a.ref) return;
      STATE.chain = a.ref.chain;
      STATE.tier = a.ref.tier;
      $('rfChain').value = STATE.chain;
      $('rfTier').value = String(a.ref.tier);
      if (a.ref.city && M.ROYALS.indexOf(a.ref.city) > -1) {
        CFG.city = a.ref.city;
        saveCfg();
        fillCfgInputs();
      }
      setView('refine');
    });

    $('seInput').addEventListener('input', function () {
      STATE.query = this.value;
      STATE.seFocus = null;
      var q = STATE.query.trim().toUpperCase();
      renderSearch();
      if (q.length < 2) return;
      clearTimeout(t);
      t = setTimeout(function () {
        if (M.tracked().some(function (m) { return m.id.indexOf(q) === 0 || m.label.toUpperCase().indexOf(q) > -1; })) return;
        STATE.searching = true;
        renderSearch();
        M.fetchIds([q]).then(function () {
          STATE.searching = false;
          renderSearch();
        });
      }, 700);
    });

    $('seList').addEventListener('click', function (e) {
      var row = e.target.closest('button.row');
      if (!row) return;
      STATE.selected = row.dataset.id;
      STATE.seFocus = row.dataset.id;
      var buy = num(row.dataset.buy), sell = num(row.dataset.sell);
      if (!buy || !sell) {
        var ent = M.at(STATE.selected, CFG.city);
        buy = Math.round(ent ? ent.sell : 0);
        sell = Math.round(ent ? ent.buy : 0);
      }
      $('flBuy').value = buy;
      $('flSell').value = sell;
      setView('flip');
    });

    $('snAdd').addEventListener('click', function () {
      var act = $('snAct').value.trim() || 'Sesi';
      var sv = num($('snSilver').value), mn = Math.max(1, num($('snMin').value));
      if (!sv) { alert('Isi silver bersih (boleh negatif kalau rugi).'); return; }
      sessions.unshift({ act:act, silver:sv, min:mn });
      try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e) {}
      $('snAct').value = ''; $('snSilver').value = '';
      renderSession();
    });
    $('snList').addEventListener('click', function (e) {
      var x = e.target.closest('.x');
      if (!x) return;
      sessions.splice(num(x.dataset.i), 1);
      try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e) {}
      renderSession();
    });
    $('snGoBest').addEventListener('click', function () {
      var top = bestOppNow();
      if (!top) return;
      if (top.chain) {
        STATE.chain = top.chain;
        STATE.tier = top.tier || STATE.tier;
        $('rfChain').value = STATE.chain;
        $('rfTier').value = String(STATE.tier);
        if (top.city && M.ROYALS.indexOf(top.city) > -1) {
          CFG.city = top.city;
          saveCfg();
          fillCfgInputs();
        }
      }
      setView(top.go || 'zero');
    });

    $('snClear').addEventListener('click', function () {
      if (sessions.length && confirm('Hapus semua sesi?')) {
        sessions = [];
        try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e) {}
        renderSession();
      }
    });

    ['cCity', 'cPremium', 'cBM', 'cSell', 'cBuy', 'cFocus',
     'cSetup', 'cYield', 'cThru', 'cTransport'].forEach(function (id) {
      $(id).addEventListener('change', readCfg);
    });

    $('feedRefresh').addEventListener('click', function () {
      STATE.left = Math.round(M.AUTO_REFRESH / 1000);
      M.load({ force: true });
    });

    M.subscribe(function () { renderAll(); });
    M.load({ region: CFG.region });

    setInterval(function () {
      if (document.hidden) return;
      STATE.left -= 1;
      if (STATE.left <= 0) {
        STATE.left = Math.round(M.AUTO_REFRESH / 1000);
        M.load({ force: true });
      }
      updateFeed();
    }, 1000);

    setView(STATE.view);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();