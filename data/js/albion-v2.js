/* =============================================
   SILVER OPS v2 — app logic (AODP / per-kota)
   Semua harga dari AlbionMarket v3.
   ============================================= */
(function () {
  'use strict';

  var M = window.AlbionMarket;
  var LS_CFG = 'so_cfg_v2', LS_SESS = 'so_sess_v2', LS_VIEW = 'so_view_v2';
  var BUILD = '2.8';
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
    view: 'scan', mode: 'plan', strategy: 'flip', chain: 'ore', tier: 4,
    planFilter: 'all', planSort: 'sph',
    sort: 'roi', hideNeg: true, qtyRefine: 100, qtyFlip: 100,
    selected: null, query: '', left: 60, searching: false, zTier: 3, zProf: 'ore', aSortRefine: 'profit', aSortFlip: 'roi', seFocus: null
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

  function spreadOpp(chain, tier, mode) {
    var src = M.refLive(tier, chain, CFG.city);
    var dstTier = mode === 'tier' ? tier + 1 : tier;
    var dst = M.refLive(dstTier, chain, CFG.city);
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
      kind:'spread', id:dst.id, name:M.meta(dst.id).label,
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

  /* ---------- strategi: gather & mancing ----------
     Modal 0 karena barang didapat sendiri. Jadi yang dibandingkan adalah
     kota dengan pendapatan jual INSTAN (buy order tertinggi) tertinggi. */
  function collectOpp(kind) {
    var out = [];
    var list = M.tracked();
    var thru = num(CFG.throughput);
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (kind === 'gather' && m.kind !== 'raw') continue;
      if (kind === 'fish' && m.kind !== 'fish') continue;

      var rows = M.byCity(m.id);
      var best = null, bestOrder = null, worst = null;
      for (var j = 0; j < rows.length; j++) {
        var e = rows[j];
        if (e.buy > 0) {
          var net = netSell(e.buy);
          if (!best || net > best.net) best = { city:e.city, net:net, buy:e.buy };
          if (!worst || net < worst.net) worst = { city:e.city, net:net };
        }
        if (e.sell > 0) {
          var net2 = netSell(e.sell);
          if (!bestOrder || net2 > bestOrder.net) bestOrder = { city:e.city, net:net2, sell:e.sell };
        }
      }
      if (!best) continue;

      var gain = best.net - (worst ? worst.net : 0);
      out.push({
        kind:kind, id:m.id, name:m.label,
        tag:best.city + (m.rare ? ' · langka' : ''),
        profit:best.net, roi:best.net > 0 ? gain / worst.net * 100 : 0,
        capital:0, sph:best.net * thru,
        cells:[
          ['Jual instan di ' + best.city, money(best.net)],
          ['Pasang order', bestOrder ? money(bestOrder.net) : '—'],
          ['Modal', '0 ✦ (sendiri)']
        ]
      });
    }
    return out;
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

  /* ---------- kumpulan ---------- */
  function opportunities() {
    var out = [], st = STATE.strategy;

    if (st === 'city') {
      out = cityOpp();
    } else if (st === 'gather' || st === 'fish') {
      out = collectOpp(st);
    } else if (st === 'flip' || st === 'arb') {
      var list = M.tracked();
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        var o;
        if (st === 'flip') {
          o = flipOpp(m, M.at(m.id, CFG.city));
        } else {
          var bag = {};
          var cs = m.cities || [];
          for (var c = 0; c < cs.length; c++) {
            var e = M.at(m.id, cs[c]);
            if (e) bag[cs[c]] = e;
          }
          o = arbOpp(m, bag);
        }
        if (o) out.push(o);
      }
    } else {
      var chains = M.CHAINS.filter(function (c) { return STATE.chain === 'all' || c.key === STATE.chain; });
      for (var k = 0; k < chains.length; k++) {
        for (var t = M.TIER_MIN + 1; t <= M.TIER_MAX; t++) {
          var r = null;
          if (st === 'refine') r = refineOpp(chains[k], t);
          else {
            r = spreadOpp(chains[k], t, 'tier') || spreadOpp(chains[k], t, 'ench');
          }
          if (r) out.push(r);
        }
      }
    }

    if (st === 'city') {
      out.sort(function (a, b) {
        var pa = parseInt(a.tag, 10) || 0, pb = parseInt(b.tag, 10) || 0;
        if (pb !== pa) return pb - pa;
        return b.profit - a.profit;
      });
    }
    if (STATE.hideNeg) out = out.filter(function (o) { return o.profit > 0 || o.kind === 'city'; });
    var key = STATE.sort;
    out.sort(function (a, b) {
      if (key === 'profit') return b.profit - a.profit;
      if (key === 'sph') return b.sph - a.sph;
      if (key === 'city') return b.profit - a.profit;
      return b.roi - a.roi;
    });
    return out;
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

  /* ---------- rencana: satu daftar aksi konkret ---------- */
  var TYPE_LABEL = {
    arb:'Arbitrase antar kota', gather:'Gather', fish:'Mancing',
    refine:'Refine', spread:'Transmute', flip:'Flip 1 kota', city:'Kota'
  };

  function riskBadges(kind, thin, value) {
    var out = [];
    if (thin) out.push({ cls:'thin', t:'pasar tipis' });
    if (value >= 5000 && (kind === 'arb' || kind === 'fish')) out.push({ cls:'risk', t:'risiko ambush' });
    return out;
  }

  function planOpp() {
    var out = [];
    var list = M.tracked();
    var thru = num(CFG.throughput);

    /* arbitrase + flip */
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var rows = M.byCity(m.id);
      var bag = {};
      for (var j = 0; j < rows.length; j++) bag[rows[j].city] = rows[j];
      var cities = Object.keys(bag);
      var best = arbOpp(m, bag);
      if (best) {
        best.how = 'Beli di ' + best.tag.split(' → ')[0] + ', jual di ' + best.tag.split(' → ')[1];
        best.badges = riskBadges('arb', cities.length <= 2, best.profit);
        best.head = money(best.sph) + '/jam';
        best.name = m.label;
        out.push(best);
      }
    }

    /* gather + mancing */
    ['gather', 'fish'].forEach(function (kind) {
      collectOpp(kind).forEach(function (o) {
        var n = (M.byCity(o.id) || []).length;
        o.how = 'Ambil sendiri, jual di ' + o.tag;
        o.badges = riskBadges(kind, n <= 2, o.profit);
        o.head = money(o.sph) + '/jam';
        out.push(o);
      });
    });

    /* refine + transmute */
    var chains = M.CHAINS.filter(function (c) { return STATE.chain === 'all' || c.key === STATE.chain; });
    for (var k = 0; k < chains.length; k++) {
      for (var t = M.TIER_MIN + 1; t <= M.TIER_MAX; t++) {
        var r = refineOpp(chains[k], t);
        if (r) {
          r.how = 'Refine ' + chains[k].label + ' T' + t + ' di ' + CFG.city;
          r.badges = riskBadges('refine', false, r.profit);
          r.head = money(r.sph) + '/jam';
          out.push(r);
        }
        var sp = spreadOpp(chains[k], t, 'tier') || spreadOpp(chains[k], t, 'ench');
        if (sp) {
          sp.how = 'Transmute ' + sp.tag + ' di ' + CFG.city;
          sp.badges = riskBadges('spread', false, sp.profit);
          sp.head = money(sp.sph) + '/jam';
          out.push(sp);
        }
      }
    }

    if (STATE.planFilter !== 'all') {
      out = out.filter(function (o) { return o.kind === STATE.planFilter; });
    }
    out = out.filter(function (o) { return o.profit > 0; });

    var k2 = STATE.planSort;
    out.sort(function (a, b) {
      if (k2 === 'roi') return b.roi - a.roi;
      if (k2 === 'profit') return b.profit - a.profit;
      return b.sph - a.sph;
    });
    return out;
  }

  function renderPlan() {
    var box = $('planList');
    var data = planOpp();
    $('planCount').textContent = data.length + ' aksi';

    var hero = $('heroCard');
    if (!data.length) {
      hero.innerHTML = '<span class="hero-k">Belum ada aksi profitable</span>' +
        '<span class="hero-h">—</span>' +
        '<span class="hero-s">Coba ganti kota, region, atau matikan filter jenis aksi. ' +
        'Feed mungkin masih menyinkron.</span>';
      box.innerHTML = '<div class="state">Belum ada aksi yang lolos filter.</div>';
      return;
    }

    var t0 = data[0];
    hero.innerHTML =
      '<span class="hero-k">Lakukan pertama · ' + esc(TYPE_LABEL[t0.kind] || t0.kind) + '</span>' +
      '<span class="hero-h">' + esc(t0.name) + '</span>' +
      '<span class="hero-s">' + esc(t0.how) + '</span>' +
      '<span class="hero-money">' + money(t0.sph) + ' / jam</span>' +
      '<span class="hero-meta">' +
        pct(t0.roi) + (t0.capital > 0 ? ' ROI' : ' beda kota') + ' · modal ' + money(t0.capital) +
        ' · untung ' + signed(t0.profit) + '/unit</span>' +
      '<span class="hero-go">Ketuk aksi di bawah untuk hitung detailnya.</span>';

    box.innerHTML = data.slice(0, LIMIT).map(rowHtml).join('') +
      (data.length > LIMIT
        ? '<p class="hint" style="text-align:center;padding:8px 0">' +
          silver(data.length - LIMIT) + ' aksi lain disembunyikan.</p>' : '');
  }

  function renderScan() {
    var box = $('scanList'), st = M.status();
    $('exploreBox').style.display = STATE.mode === 'explore' ? 'block' : 'none';
    $('planBox').style.display = STATE.mode === 'plan' ? 'block' : 'none';
    if (STATE.mode === 'plan') { renderPlan(); }
    var data = opportunities();

    var chainBased = (STATE.strategy === 'refine' || STATE.strategy === 'spread');
    $('chainChips').style.display = chainBased ? 'flex' : 'none';
    $('arbNote').style.display = (STATE.strategy === 'arb') ? 'block' : 'none';
    $('cityNote').style.display = (STATE.strategy === 'city') ? 'block' : 'none';
    $('selfNote').style.display = (STATE.strategy === 'gather' || STATE.strategy === 'fish') ? 'block' : 'none';
    $('scanCount').textContent = data.length + ' peluang';

    var best = data[0];
    $('stRoi').textContent = best ? pct(best.roi) : '—';
    $('stRoiS').textContent = best ? best.name : 'tunggu feed';
    $('stProfit').textContent = best ? signed(best.profit) : '—';
    $('stProfitS').textContent = best ? best.tag : 'tunggu feed';
    $('stSph').textContent = best ? money(best.sph) : '—';
    $('stSphS').textContent = silver(CFG.throughput) + ' unit/jam';
    $('stItems').textContent = silver(st.rows);
    $('stItemsS').textContent = M.servingLabel() + ' · ' + CFG.city;

    if (!data.length) {
      box.innerHTML = '<div class="state">Belum ada peluang untuk ' + esc(CFG.city) + ' di ' +
        esc(M.regionLabel()) + '. ' +
        (STATE.hideNeg ? 'Matikan “hide rugi”, ganti kota, atau ganti region.' :
         'Feed mungkin belum punya harga item ini di kota ini.') + '</div>';
    } else {
      var show = data.slice(0, LIMIT);
      box.innerHTML = show.map(rowHtml).join('') +
        (data.length > LIMIT ? '<p class="hint" style="text-align:center;padding:8px 0">' +
          silver(data.length - LIMIT) + ' peluang lain disembunyikan.</p>' : '');
    }

    var pick = $('scanPick');
    if (pick) {
      pick.style.display = STATE.selected ? 'grid' : 'none';
      $('scanPickName').textContent = STATE.selected || '—';
    }
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
  /* ---------- shell ---------- */
  var VIEWS = ['scan', 'zero', 'refine', 'flip', 'session', 'search'];

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
    if (STATE.view === 'scan') renderScan();
    else if (STATE.view === 'zero') renderZero();
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

    $('scanMode').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      STATE.mode = b.dataset.m;
      this.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-selected', String(x === b));
      });
      renderScan();
    });

    $('planChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.planFilter = c.dataset.p;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderPlan();
    });

    $('planSort').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.planSort = c.dataset.ps;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderPlan();
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

    $('scanSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      STATE.strategy = b.dataset.s;
      this.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-selected', String(x === b));
      });
      renderScan();
    });

    $('chainChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.chain = c.dataset.c;
      $('rfChain').value = (STATE.chain === 'all') ? $('rfChain').value : STATE.chain;
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderScan();
    });

    $('sortChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c || !c.dataset.s) return;
      STATE.sort = c.dataset.s;
      this.querySelectorAll('.chip[data-s]').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderScan();
    });

    $('hideNeg').addEventListener('click', function () {
      STATE.hideNeg = !STATE.hideNeg;
      this.setAttribute('aria-pressed', String(STATE.hideNeg));
      renderScan();
    });

    $('scanList').addEventListener('click', function (e) {
      var row = e.target.closest('.row');
      if (!row) return;
      STATE.selected = STATE.selected === row.dataset.id ? null : row.dataset.id;
      renderScan();
    });

    /* klik aksi di Rencana → buka kalkulator yang tepat, sudah terisi */
    $('planList').addEventListener('click', function (e) {
      var row = e.target.closest('.row');
      if (!row) return;
      STATE.selected = row.dataset.id;
      var kind = row.dataset.kind;
      var ent = M.at(STATE.selected, CFG.city);

      if (kind === 'refine' || kind === 'spread') {
        var mm = M.meta(STATE.selected);
        if (mm.chain) { STATE.chain = mm.chain; $('rfChain').value = mm.chain; }
        if (mm.tier > M.TIER_MIN && mm.tier <= M.TIER_MAX) {
          STATE.tier = mm.tier; $('rfTier').value = String(mm.tier);
        }
        setView('refine');
        return;
      }
      if (ent) {
        $('flBuy').value = Math.round(ent.sell || 0);
        $('flSell').value = Math.round(ent.buy || 0);
      }
      setView('flip');
    });

    $('scanToFlip').addEventListener('click', function () {
      var e = M.at(STATE.selected, CFG.city);
      if (!e || !e.sell) { alert('Item ini belum punya harga di ' + CFG.city + '.'); return; }
      $('flBuy').value = Math.round(e.sell);
      $('flSell').value = Math.round(e.buy);
      setView('flip');
    });

    $('scanToRefine').addEventListener('click', function () {
      var m = STATE.selected ? M.meta(STATE.selected) : null;
      if (m && m.chain) {
        STATE.chain = m.chain;
        $('rfChain').value = m.chain;
        if (m.tier > M.TIER_MIN && m.tier <= M.TIER_MAX) {
          STATE.tier = m.tier;
          $('rfTier').value = String(m.tier);
        }
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