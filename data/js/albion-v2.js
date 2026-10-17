/* =============================================
   SILVER OPS v2 – app logic
   Semua angkaidian dari AlbionMarket (live/cache).
   Modul ini hanya menghitung + merender.
   ============================================= */
(function () {
  'use strict';

  var M = window.AlbionMarket;
  var LS_CFG = 'so_cfg_v2', LS_SESS = 'so_sess_v2', LS_VIEW = 'so_view_v2';
  var LIMIT = 60;

  /* konstanta mechanics game — cek ulang setelah patch */
  var RAW_PER = { 2:1, 3:2, 4:2, 5:3, 6:4, 7:5, 8:5 };
  var TX_TIER = { 5:[1070,2130,4270,8530], 6:[1600,3200,6400,12800],
                  7:[2560,5120,10240,20480], 8:[5120,10240,20480,40960] };
  var TX_ENCH = { 4:[1800,3600,7200], 5:[1600,3200,6400],
                  6:[2400,4800,9600], 7:[3840,7680,15360], 8:[7680,15360,30720] };

  var CFG = {
    premium: true,
    blackMarket: false,
    sellOrder: true,
    buyOrder: false,
    setupFee: 2.5,
    yieldBonus: 58,
    focus: false,
    throughput: 600
  };

  var STATE = {
    view: 'scan',
    strategy: 'flip',
    chain: 'ore',
    tier: 4,
    sort: 'roi',
    hideNeg: true,
    qtyRefine: 100,
    qtyFlip: 100,
    selected: null,
    query: '',
    left: 60
  };

  var sessions = [];

  /* ---------- util ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function silver(n) {
    n = Math.round(num(n));
    return n.toLocaleString('en-US').replace(/,/g, '.');
  }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + silver(Math.abs(n)); }
  function pct(n) { return (Math.round(n * 10) / 10).toFixed(1) + '%'; }
  function money(n) { return silver(n) + ' ✦'; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ---------- model mechanics ---------- */
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
  function netSell(price) { return price * sellFactor(); }
  function costBuy(price) { return price * buyFactor(); }

  function rrr() {
    var b = num(CFG.yieldBonus) + (CFG.focus ? 59 : 0);
    return 1 - (1 / (1 + b / 100));
  }

  /* harga beli bahan (harga jual order = biaya beli instan) */
  function materialPrice(tier, code) {
    var q = M.get(M.id(tier, code));
    return q ? q.sell : 0;
  }

  /* biaya bahan efektif refined T=tier, termasuk rantai di bawahnya.
     missing = jumlah tier yang tidak punya harga di feed — kalau >0
     peluangnya dibuang, jangan tampilkan ROI murah yang palsu. */
  function refineCost(tier, chain) {
    var r = rrr();
    var keep = 1 - r;
    var total = 0;
    var missing = 0;
    var rows = [];
    for (var t = 2; t <= tier; t++) {
      var px = materialPrice(t, chain.raw);
      var need = RAW_PER[t] || 0;
      if (px <= 0) missing++;
      var c = need * keep * px;
      total += c;
      rows.push({ tier:t, need:need, price:px, cost:c });
    }
    return { total:total, missing:missing, rows:rows };
  }

  /* harga jual minimum agar tidak rugi */
  function breakEvenSell(unitCost) {
    var f = sellFactor();
    return f > 0 ? unitCost / f : 0;
  }

  /* ---------- strategi: flip ---------- */
  function flipOpp(m) {
    var out = netSell(m.buy) - costBuy(m.sell);
    var capital = costBuy(m.sell);
    return {
      kind:'flip', id:m.id, name:m.label, tag:m.id,
      profit:out, roi:capital > 0 ? (out / capital) * 100 : 0,
      capital:capital, sph:out * num(CFG.throughput),
      delta:m.delta, stock:m.stock,
      cells:[
        ['Beli', money(costBuy(m.sell))],
        ['Jual', money(netSell(m.buy))],
        ['Modal', money(capital)]
      ]
    };
  }

  /* ---------- strategi: refine ---------- */
  function refineOpp(chain, tier) {
    var out = M.get(M.id(tier, chain.ref));
    if (!out || !out.sell) return null;
    var rc = refineCost(tier, chain);
    if (rc.missing > 0) return null;
    var revenue = netSell(out.sell);
    var profit = revenue - rc.total;
    return {
      kind:'refine', id:M.id(tier, chain.ref), name:out.label,
      tag:chain.label + ' T' + tier,
      profit:profit, roi:rc.total > 0 ? (profit / rc.total) * 100 : 0,
      capital:rc.total, sph:profit * num(CFG.throughput),
      delta:out.delta, stock:out.stock,
      cells:[
        ['Bahan', money(rc.total)],
        ['Jual/unit', money(revenue)],
        ['Modal', money(rc.total)]
      ]
    };
  }

  /* ---------- strategi: spread (transmute) ---------- */
  function spreadOpp(chain, tier, mode) {
    var src = M.get(M.id(tier, chain.ref));
    var dstTier = mode === 'tier' ? tier + 1 : tier;
    var dst = M.get(M.id(dstTier, chain.ref));
    if (!src || !dst || !src.sell || !dst.sell) return null;

    var fee = 0;
    if (mode === 'tier') {
      var arr = TX_TIER[tier];
      if (!arr) return null;
      fee = arr[0];
    } else {
      var arr2 = TX_ENCH[tier];
      if (!arr2) return null;
      fee = arr2[0];
    }

    var spend = costBuy(src.sell) + fee;
    var revenue = netSell(dst.sell);
    var profit = revenue - spend;
    return {
      kind:'spread', id:dst.id, name:dst.label,
      tag:src.label + ' → ' + (mode === 'tier' ? 'T' + dstTier : '.1'),
      profit:profit, roi:spend > 0 ? (profit / spend) * 100 : 0,
      capital:spend, sph:profit * num(CFG.throughput),
      delta:dst.delta, stock:dst.stock,
      cells:[
        ['Beli + fee', money(spend)],
        ['Jual', money(revenue)],
        ['Modal', money(spend)]
      ]
    };
  }

  /* ---------- kumpulan peluang ---------- */
  function opportunities() {
    var out = [];
    var st = STATE.strategy;

    if (st === 'flip') {
      var rows = M.rows();
      for (var i = 0; i < rows.length; i++) {
        var m = rows[i];
        if (!m.sell || !m.buy) continue;
        out.push(flipOpp(m));
      }
    } else {
      var chains = M.CHAINS.filter(function (c) { return STATE.chain === 'all' || c.key === STATE.chain; });
      for (var c = 0; c < chains.length; c++) {
        for (var t = M.TIER_MIN + 1; t <= M.TIER_MAX; t++) {
          if (st === 'refine') {
            var r = refineOpp(chains[c], t);
            if (r) out.push(r);
          } else {
            var up = spreadOpp(chains[c], t, 'tier');
            if (up) out.push(up);
            var en = spreadOpp(chains[c], t, 'ench');
            if (en) out.push(en);
          }
        }
      }
    }

    if (STATE.hideNeg) out = out.filter(function (o) { return o.profit > 0; });

    var key = STATE.sort;
    out.sort(function (a, b) {
      if (key === 'profit') return b.profit - a.profit;
      if (key === 'sph') return b.sph - a.sph;
      if (key === 'stock') return b.stock - a.stock;
      return b.roi - a.roi;
    });
    return out;
  }

  /* ---------- render: baris peluang ---------- */
  function deltaHtml(d) {
    var cls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
    var w = clamp(Math.abs(d) * 6, 4, 100) / 2;
    var arrow = d > 0.05 ? '▲' : d < -0.05 ? '▼' : '▬';
    return '<span class="delta ' + cls + '">' + arrow + ' ' + pct(Math.abs(d)) +
      '<span class="delta-bar"><i style="width:' + w + '%"></i></span></span>';
  }

  function rowHtml(o) {
    var p = o.profit >= 0 ? 'var(--pos)' : 'var(--neg)';
    var thin = o.stock > 0 && o.stock < 200 ? '<span class="badge thin">tipis</span>' : '';
    var cells = o.cells.map(function (c) {
      return '<span class="r-cell"><span class="r-cell-k">' + esc(c[0]) +
        '</span><span class="r-cell-v">' + esc(c[1]) + '</span></span>';
    }).join('');
    return '<button type="button" class="row' + (STATE.selected === o.id ? ' sel' : '') +
      '" data-id="' + esc(o.id) + '">' +
      '<span class="r-main"><span class="r-tag">' + esc(o.tag) + '</span>' +
        '<span class="r-name">' + esc(o.name) + '</span></span>' +
      '<span class="r-right"><span class="r-profit" style="color:' + p + '">' + signed(o.profit) +
        '</span><span class="r-roi">' + pct(o.roi) + ' ROI · ' + money(o.sph) + '/jam</span></span>' +
      '<span class="r-grid">' + cells +
        '<span class="r-cell"><span class="r-cell-k">Δ24h</span><span class="r-cell-v">' + deltaHtml(o.delta) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Stok</span><span class="r-cell-v">' + (o.stock ? silver(o.stock) : '—') + ' ' + thin + '</span></span>' +
      '</span></button>';
  }

  function renderScan() {
    var box = $('scanList');
    var stat = M.status();
    var data = opportunities();

    $('chainChips').style.display = STATE.strategy === 'flip' ? 'none' : 'flex';
    var pick = $('scanPick');
    if (pick) {
      pick.style.display = STATE.selected ? 'grid' : 'none';
      $('scanPickName').textContent = STATE.selected || '—';
    }
    $('scanCount').textContent = data.length + ' peluang';
    var best = data[0];
    $('stRoi').textContent = best ? pct(best.roi) : '—';
    $('stRoiS').textContent = best ? best.name : 'tunggu feed';
    $('stProfit').textContent = best ? signed(best.profit) : '—';
    $('stProfitS').textContent = best ? 'unit · ' + best.tag : 'tunggu feed';
    $('stSph').textContent = best ? money(best.sph) : '—';
    $('stSphS').textContent = '-throughput ' + silver(CFG.throughput) + '/jam';
    $('stItems').textContent = silver(stat.count);
    $('stItemsS').textContent = stat.source ? hostOf(stat.source) : 'item dipantau';

    if (!data.length) {
      box.innerHTML = '<div class="state">Belum ada peluang yang cocok filter. ' +
        (STATE.hideNeg ? 'Coba matikan “hide rugi” atau turunkan ambang modal.' :
        'Feed belum punya harga untuk material ini.') + '</div>';
      return;
    }
    var show = data.slice(0, LIMIT);
    box.innerHTML = show.map(rowHtml).join('') +
      (data.length > LIMIT
        ? '<p class="hint" style="text-align:center;padding:8px 0">' +
          silver(data.length - LIMIT) + ' peluang lain disembunyikan — pakai filter untuk mempersempit.</p>'
        : '');
  }

  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return 'feed'; }
  }

  /* ---------- render: kalkulator refine ---------- */
  function renderRefine() {
    var chain = M.CHAINS.filter(function (c) { return c.key === STATE.chain; })[0] || M.CHAINS[0];
    var tier = STATE.tier;
    var rc = refineCost(tier, chain);
    var out = M.get(M.id(tier, chain.ref));
    var qty = Math.max(1, STATE.qtyRefine);
    var revenue = netSell(out && out.sell ? out.sell : 0);
    var profit = revenue - rc.total;
    var total = profit * qty;
    var be = breakEvenSell(rc.total);
    var sph = profit * num(CFG.throughput);
    var roi = rc.total > 0 ? (profit / rc.total) * 100 : 0;

    var rowsHtml = rc.rows.slice().reverse().map(function (r) {
      return '<dt>' + chain.label.split(' → ')[0] + ' T' + r.tier + ' ×' + r.need + '</dt>' +
        '<dd>' + money(r.cost) + '</dd>';
    }).join('');

    $('rfOut').innerHTML =
      '<span class="read big ' + (profit >= 0 ? 'ok' : 'no') + '">' +
        (profit >= 0 ? '▲ Untung ' : '▼ Rugi ') + signed(profit) + ' / unit</span>' +
      '<dl class="kv">' +
      '<dt>Harga jual refined (live)</dt><dd>' + (out && out.sell ? money(out.sell) : '—') + '</dd>' +
      '<dt>Setelah tax + setup</dt><dd>' + money(revenue) + '</dd>' +
      '<dt>Biaya bahan / unit</dt><dd>' + money(rc.total) + '</dd>' +
      '<dt>Modal ' + silver(qty) + ' unit</dt><dd>' + money(rc.total * qty) + '</dd>' +
      '<dt>Profit total</dt><dd class="' + (total >= 0 ? 'ok' : 'no') + '">' + signed(total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (roi >= 0 ? 'ok' : 'no') + '">' + pct(roi) + '</dd>' +
      '<dt>Break-even harga jual</dt><dd class="wa">' + money(be) + '</dd>' +
      '<dt>Perkiraan / jam</dt><dd>' + money(sph) + '</dd>' +
      '</dl><details class="hint" style="margin-top:8px"><summary>Rincian rantai bahan</summary>' +
      '<dl class="kv" style="margin-top:6px">' + rowsHtml +
      '<dt>Total</dt><dd>' + money(rc.total) + '</dd></dl></details>' +
      '<p class="hint">RRR ' + pct(rrr() * 100) + ' · yield ' + num(CFG.yieldBonus) +
      (CFG.focus ? ' +59 focus' : '') + ' · ' + silver(qty) + ' unit × ' + silver(CFG.throughput) + '/jam.</p>';
  }

  /* ---------- render: kalkulator flip ---------- */
  function renderFlip() {
    var m = STATE.selected ? M.get(STATE.selected) : null;
    $('flName').textContent = m ? m.label + ' (' + m.id + ')' : 'belum ada item — cari di SEARCH';

    var buy = num($('flBuy').value);
    var sell = num($('flSell').value);
    var qty = Math.max(1, STATE.qtyFlip);

    if (!m && !buy && !sell) {
      $('flOut').innerHTML = '<div class="state">Isi harga beli &amp; jual manual, atau pilih item dari tab SEARCH lalu tekan ISI.</div>';
      return;
    }

    var netS = netSell(sell);
    var costB = costBuy(buy);
    var profit = netS - costB;
    var total = profit * qty;
    var capital = costB * qty;
    var roi = capital > 0 ? (profit / costB) * 100 : 0;
    var f = sellFactor();
    var be = f > 0 ? costB / f : 0;
    var sph = profit * num(CFG.throughput);
    var cap = m ? (m.sell > 0 ? costB / m.sell : 0) : 0;

    $('flOut').innerHTML =
      '<span class="read big ' + (profit >= 0 ? 'ok' : 'no') + '">' +
        (profit >= 0 ? '▲ Untung ' : '▼ Rugi ') + signed(profit) + ' / unit</span>' +
      '<dl class="kv">' +
      '<dt>Harga beli / unit</dt><dd>' + money(costB) + '</dd>' +
      '<dt>Harga jual / unit</dt><dd>' + money(netS) + '</dd>' +
      '<dt>Spread kotor</dt><dd>' + signed(netS - costB) + '</dd>' +
      '<dt>Break-even harga jual</dt><dd class="wa">' + money(be) + '</dd>' +
      '<dt>Modal ' + silver(qty) + ' unit</dt><dd>' + money(capital) + '</dd>' +
      '<dt>Profit total</dt><dd class="' + (total >= 0 ? 'ok' : 'no') + '">' + signed(total) + '</dd>' +
      '<dt>ROI</dt><dd class="' + (roi >= 0 ? 'ok' : 'no') + '">' + pct(roi) + '</dd>' +
      (cap > 0 ? '<dt>Modal relatif harga pasar</dt><dd>×' + (Math.round(cap * 100) / 100) + '</dd>' : '') +
      '<dt>Perkiraan / jam</dt><dd>' + money(sph) + '</dd>' +
      '</dl><p class="hint">Faktor jual ×' + (Math.round(f * 1000) / 1000) +
      ' (tax ' + (CFG.blackMarket ? 0 : CFG.premium ? 4 : 8) + '%' +
      (CFG.sellOrder && !CFG.blackMarket ? ' + setup ' + num(CFG.setupFee) + '%' : '') +
      ') · faktor beli ×' + (Math.round(buyFactor() * 1000) / 1000) + '.</p>';
  }

  /* ---------- render: search ---------- */
  function renderSearch() {
    var q = STATE.query;
    var box = $('seList');
    if (q.length < 2) {
      box.innerHTML = '<div class="state">Ketik minimal 2 huruf. Contoh: <b>bar</b>, <b>cloth</b>, ' +
        '<b>sword</b>, <b>bag</b>, <b>bread</b>, atau id lengkap <b>T6BAR</b>.</div>';
      return;
    }
    var hits = M.search(q);
    if (!hits.length) {
      box.innerHTML = '<div class="state">Tidak ada item “' + esc(q) + '” di feed. Market refresh tiap 60 detik.</div>';
      return;
    }
    var f = sellFactor(), bf = buyFactor();
    box.innerHTML = hits.map(function (m) {
      var profit = m.buy > 0 && m.sell > 0 ? (netSell(m.buy) - costBuy(m.sell)) : 0;
      var p = profit >= 0 ? 'var(--pos)' : 'var(--neg)';
      return '<button type="button" class="row" data-id="' + esc(m.id) + '">' +
        '<span class="r-main"><span class="r-tag">' + esc(m.id) + '</span>' +
        '<span class="r-name">' + esc(m.label) + '</span></span>' +
        '<span class="r-right"><span class="r-profit" style="color:' + p + '">' +
          (m.buy > 0 && m.sell > 0 ? signed(profit) : '—') +
        '</span><span class="r-roi">margin flip</span></span>' +
        '<span class="r-grid">' +
        '<span class="r-cell"><span class="r-cell-k">Beli</span><span class="r-cell-v">' + money(m.sell) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Jual</span><span class="r-cell-v">' + money(m.buy) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Δ24h</span><span class="r-cell-v">' + deltaHtml(m.delta) + '</span></span>' +
        '<span class="r-cell"><span class="r-cell-k">Stok</span><span class="r-cell-v">' + (m.stock ? silver(m.stock) : '—') + '</span></span>' +
        '</span></button>';
    }).join('');
  }

  /* ---------- render: session ---------- */
  function renderSession() {
    var box = $('snList');
    var tot = 0, min = 0, best = null;
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
            '<button type="button" class="x" data-i="' + i + '" aria-label="Hapus sesi ' + esc(s.act) + '">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>';
        }).join('')
      : '<div class="state">Belum ada sesi. Catat silver yang kamu hasilkan supaya bisa dibandingkan dengan peluang di scanner.</div>';
  }

  /* ---------- views ---------- */
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
    window.scrollTo({ top: 0, behavior: 'auto' });
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
    var st = M.status();
    var map = {
      live:['LIVE', 'on'], cache:['CACHE', 'warn'], stale:['STALE', 'warn'],
      loading:['SYNC', 'load'], offline:['OFFLINE', 'off'], idle:['IDLE', '']
    };
    var m = map[st.state] || map.idle;
    $('feedPill').textContent = m[0];
    $('feedPill').className = 'pill ' + m[1];
    $('feedDot').className = 'dot ' + m[1];
    var when = st.updated
      ? new Date(st.updated).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      : '—';
    $('feedNote').textContent = st.state === 'offline'
      ? 'Feed live tidak bisa diakses (CORS / jaringan). Pakai cache atau isi harga manual — kalkulator tetap jalan.'
      : (st.state === 'live' ? 'live' : 'cache') + ' · update ' + when +
        ' · next ' + STATE.left + 's · ' + silver(st.count) + ' item';
    var banner = $('offBanner');
    banner.style.display = st.state === 'offline' ? 'block' : 'none';
  }

  /* ---------- config panel ---------- */
  function renderCfgInputs() {
    $('cPremium').checked = CFG.premium;
    $('cBM').checked = CFG.blackMarket;
    $('cSell').checked = CFG.sellOrder;
    $('cBuy').checked = CFG.buyOrder;
    $('cSetup').value = CFG.setupFee;
    $('cYield').value = CFG.yieldBonus;
    $('cFocus').checked = CFG.focus;
    $('cThru').value = CFG.throughput;
  }

  function saveCfg() {
    try { localStorage.setItem(LS_CFG, JSON.stringify(CFG)); } catch (e) {}
  }

  function readCfg() {
    CFG.premium = $('cPremium').checked;
    CFG.blackMarket = $('cBM').checked;
    CFG.sellOrder = $('cSell').checked;
    CFG.buyOrder = $('cBuy').checked;
    CFG.setupFee = num($('cSetup').value);
    CFG.yieldBonus = num($('cYield').value);
    CFG.focus = $('cFocus').checked;
    CFG.throughput = num($('cThru').value);
    if (CFG.blackMarket) { CFG.sellOrder = false; CFG.buyOrder = false; }
    saveCfg();
    renderCfgInputs();
    renderAll();
  }

  /* ---------- init ---------- */
  function init() {
    try { Object.assign(CFG, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch (e) {}
    try { sessions = JSON.parse(localStorage.getItem(LS_SESS) || '[]') || []; } catch (e) {}
    try { STATE.view = localStorage.getItem(LS_VIEW) || 'scan'; } catch (e) {}
    if (VIEWS.indexOf(STATE.view) < 0) STATE.view = 'scan';

    renderCfgInputs();

    /* nav */
    document.querySelectorAll('.nav button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.v); });
    });

    /* scan: strategy + chain + sort + filter */
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
      this.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      renderScan();
    });

    $('sortChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      STATE.sort = c.dataset.s;
      this.querySelectorAll('.chip').forEach(function (x) {
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
      var m = STATE.selected ? M.get(STATE.selected) : null;
      if (!m || !m.sell) { alert('Item ini belum punya harga beli di feed.'); return; }
      $('flBuy').value = Math.round(m.sell);
      $('flSell').value = Math.round(m.buy);
      setView('flip');
    });

    $('scanToRefine').addEventListener('click', function () {
      var m = STATE.selected ? M.get(STATE.selected) : null;
      if (m) {
        var mt = /^T(\d)_?([A-Z]+)$/.exec(m.id);
        if (mt) {
          var tier = parseInt(mt[1], 10);
          for (var i = 0; i < M.CHAINS.length; i++) {
            if (M.CHAINS[i].ref === mt[2] || M.CHAINS[i].raw === mt[2]) {
              STATE.chain = M.CHAINS[i].key;
              $('rfChain').value = STATE.chain;
              break;
            }
          }
          if (tier >= M.TIER_MIN + 1 && tier <= M.TIER_MAX) {
            STATE.tier = tier;
            $('rfTier').value = String(tier);
          }
        }
      }
      setView('refine');
    });

    /* refine */
    $('rfChain').addEventListener('change', function () { STATE.chain = this.value; renderRefine(); });
    $('rfTier').addEventListener('change', function () { STATE.tier = num(this.value); renderRefine(); });
    $('rfQty').addEventListener('input', function () { STATE.qtyRefine = num(this.value) || 1; renderRefine(); });
    $('rfLive').addEventListener('click', function () {
      var chain = M.CHAINS.filter(function (c) { return c.key === STATE.chain; })[0];
      var n = 0;
      for (var t = M.TIER_MIN; t <= STATE.tier; t++) {
        var q = M.get(M.id(t, chain.raw));
        if (q && q.sell) n++;
      }
      if (M.status().state === 'live') {
        alert(n + ' tier punya harga live dari feed. Harga sudah dipakai otomatis di perhitungan — ' +
          'cukup pilih tier lalu lihat hasil.');
      } else {
        alert('Feed bukan live (status: ' + M.status().state + '). Perhitungan memakai cache terakhir.');
      }
    });

    /* flip */
    $('flBuy').addEventListener('input', renderFlip);
    $('flSell').addEventListener('input', renderFlip);
    $('flQty').addEventListener('input', function () { STATE.qtyFlip = num(this.value) || 1; renderFlip(); });
    $('flFromSel').addEventListener('click', function () {
      var m = STATE.selected ? M.get(STATE.selected) : null;
      if (!m) { alert('Pilih item dulu di tab SEARCH, lalu tekan ISI.'); return; }
      $('flBuy').value = Math.round(m.sell);
      $('flSell').value = Math.round(m.buy);
      renderFlip();
    });

    /* search */
    $('seInput').addEventListener('input', function () {
      STATE.query = this.value;
      renderSearch();
    });
    $('seList').addEventListener('click', function (e) {
      var row = e.target.closest('.row');
      if (!row) return;
      STATE.selected = row.dataset.id;
      var m = M.get(STATE.selected);
      if (m) {
        $('flBuy').value = Math.round(m.sell);
        $('flSell').value = Math.round(m.buy);
      }
      setView('flip');
    });

    /* session */
    $('snAdd').addEventListener('click', function () {
      var act = $('snAct').value.trim() || 'Sesi';
      var sv = num($('snSilver').value);
      var mn = Math.max(1, num($('snMin').value));
      if (!sv) { alert('Isi silver bersih (boleh negatif kalau rugi).'); return; }
      sessions.unshift({ act: act, silver: sv, min: mn });
      try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e2) {}
      $('snAct').value = ''; $('snSilver').value = '';
      renderSession();
    });
    $('snList').addEventListener('click', function (e) {
      var x = e.target.closest('.x');
      if (!x) return;
      sessions.splice(num(x.dataset.i), 1);
      try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e2) {}
      renderSession();
    });
    $('snClear').addEventListener('click', function () {
      if (!sessions.length) return;
      if (confirm('Hapus semua sesi?')) {
        sessions = [];
        try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch (e2) {}
        renderSession();
      }
    });

    /* config */
    ['cPremium','cBM','cSell','cBuy','cFocus','cSetup','cYield','cThru'].forEach(function (id) {
      $(id).addEventListener('change', readCfg);
    });

    $('feedRefresh').addEventListener('click', function () {
      STATE.left = Math.round(M.AUTO_REFRESH / 1000);
      M.load({ force: true });
    });

    /* feed + auto refresh */
    M.subscribe(function () { renderAll(); });
    M.load();

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
  } else {
    init();
  }
})();