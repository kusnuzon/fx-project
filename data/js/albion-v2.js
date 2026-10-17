/* =============================================
   SILVER OPS v2 — app logic (AODP / per-kota)
   Semua harga dari AlbionMarket v3.
   ============================================= */
(function () {
  'use strict';

  var M = window.AlbionMarket;
  var LS_CFG = 'so_cfg_v2', LS_SESS = 'so_sess_v2', LS_VIEW = 'so_view_v2';
  var BUILD = '2.2';
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
    view: 'scan', strategy: 'flip', chain: 'ore', tier: 4,
    sort: 'roi', hideNeg: true, qtyRefine: 100, qtyFlip: 100,
    selected: null, query: '', left: 60, searching: false
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
    var right2 = o.capital === 0
      ? money(o.sph) + '/jam'
      : pct(o.roi) + ' ROI · ' + money(o.sph) + '/jam';
    var cells = o.cells.map(function (c) {
      return '<span class="r-cell"><span class="r-cell-k">' + esc(c[0]) +
        '</span><span class="r-cell-v">' + esc(c[1]) + '</span></span>';
    }).join('');
    return '<button type="button" class="row' + (STATE.selected === o.id ? ' sel' : '') +
      '" data-id="' + esc(o.id) + '">' +
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span></span>' +
      '<span class="r-right"><span class="r-profit" style="color:' + p + '">' + signed(o.profit) +
        '</span><span class="r-roi">' + right2 + '</span></span>' +
      '<span class="r-grid">' + cells + '</span></button>';
  }

  function renderScan() {
    var box = $('scanList'), st = M.status();
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

  function renderRefine() {
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
      box.innerHTML = '<div class="state">Ketik minimal 2 huruf. Contoh: <b>ORE</b>, <b>CLOTH</b>, ' +
        '<b>WOOD</b>, atau id bebas seperti <b>T6_SWORD</b> — item di luar watchlist diambil on-demand.</div>';
      return;
    }
    var hits = M.search(q);
    if (STATE.searching) {
      box.innerHTML = '<div class="state">Mengambil harga “' + esc(q) + '” dari feed…</div>';
      return;
    }
    if (!hits.length) {
      box.innerHTML = '<div class="state">Tidak ada “' + esc(q) + '”. Coba id persis, misal <b>T6_CLOTH</b>.</div>';
      return;
    }
    box.innerHTML = hits.map(function (m) {
      var e = M.at(m.id, CFG.city);
      var profit = e && e.sell && e.buy ? netSell(e.buy) - costBuy(e.sell) : 0;
      var p = profit >= 0 ? 'var(--pos)' : 'var(--neg)';
      var cityTxt = e ? e.city : '—';
      return '<button type="button" class="row" data-id="' + esc(m.id) + '">' +
        '<span class="r-main"><span class="r-tag">' + esc(m.id) + '</span>' +
        '<span class="r-name">' + esc(m.label) + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:' + p + '">' +
          (e && e.sell && e.buy ? signed(profit) : '—') +
        '</span><span class="r-roi">margin flip</span></span>' +
        '<span class="r-grid">' +
        '<span class="r-cell"><span class="r-cell-k">Kota</span><span class="r-cell-v">' + esc(cityTxt) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Beli</span><span class="r-cell-v">' + (e && e.sell ? money(e.sell) : '—') + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Jual</span><span class="r-cell-v">' + (e && e.buy ? money(e.buy) : '—') + '</span></span>' +
        '</span></button>';
    }).join('');
  }

  function renderSession() {
    var box = $('snList'), tot = 0, min = 0, best = null;
    sessions.forEach(function (s) {
      tot += s.silver; min += s.min;
      if (!best || s.silver / (s.min / 60) > best.silver / (best.min / 60)) best = s;
    });
    var rate = min > 0 ? tot / (min / 60) : 0;
    var top = opportunities()[0];
    var gap = top && rate > 0 ? (rate / top.sph) * 100 : 0;

    $('snStats').innerHTML =
      '<span class="stat"><span class="stat-k">Total silver</span>' +
        '<span class="stat-v">' + money(tot) + '</span>' +
        '<span class="stat-s">' + sessions.length + ' sesi · ' + (min / 60).toFixed(1) + ' jam</span></span>' +
      '<span class="stat' + (rate > 0 ? ' pos' : '') + '"><span class="stat-k">Silver / jam</span>' +
        '<span class="stat-v">' + (rate > 0 ? money(rate) : '—') + '</span>' +
        '<span class="stat-s">terbaik ' + (best ? money(best.silver / (best.min / 60)) : '—') + '</span></span>' +
      '<span class="stat"><span class="stat-k">Peluang terbaik</span>' +
        '<span class="stat-v">' + (top ? money(top.sph) : '—') + '</span>' +
        '<span class="stat-s">' + (top ? esc(top.name) : 'tunggu feed') + '</span></span>' +
      '<span class="stat' + (gap >= 100 ? ' pos' : gap > 0 ? ' neg' : '') + '"><span class="stat-k">Kamu vs peluang</span>' +
        '<span class="stat-v">' + (gap > 0 ? pct(gap) : '—') + '</span>' +
        '<span class="stat-s">' + (gap >= 100 ? 'di atas peluang' : 'bisa lebih cepat') + '</span></span>';

    box.innerHTML = sessions.length
      ? sessions.map(function (s, i) {
          return '<div class="sess"><span class="sess-a">' +
            '<span class="sess-n">' + esc(s.act) + '</span>' +
            '<span class="sess-m">' + silver(s.min) + ' mnt · ' + money(s.silver / (s.min / 60)) + '/jam</span>' +
            '</span><span class="sess-v" style="color:' + (s.silver >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
            signed(s.silver) + '</span>' +
            '<button type="button" class="x" data-i="' + i + '" aria-label="Hapus sesi">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>';
        }).join('')
      : '<div class="state">Belum ada sesi. Catat silver yang kamu hasilkan supaya bisa dibandingkan dengan peluang di scanner.</div>';
  }

  /* ---------- shell ---------- */
  var VIEWS = ['scan', 'refine', 'flip', 'session', 'search'];

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
    $('seInput').addEventListener('input', function () {
      STATE.query = this.value;
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
      var row = e.target.closest('.row');
      if (!row) return;
      STATE.selected = row.dataset.id;
      var ent = M.at(STATE.selected, CFG.city);
      if (ent) {
        $('flBuy').value = Math.round(ent.sell || 0);
        $('flSell').value = Math.round(ent.buy || 0);
      }
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