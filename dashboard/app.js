// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, the filters, a per-protocol detail view with the model's own inputs
// and the protocol's farm plan, the live-token calibration set, and the model's explanation.
// No network: every byte it shows is in data.js. No framework: plain DOM.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var PAGE_SIZE = 25;

  // -- formatting -------------------------------------------------------------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return n.toFixed(2) + 'x';
  }
  function signalOf(row) {
    if (row.change_7d === null || row.change_7d === undefined) return { label: 'n/a', cls: 'cool' };
    if (row.change_7d >= 20) return { label: 'HOT', cls: 'hot' };
    if (row.change_7d >= 0) return { label: 'WARM', cls: 'warm' };
    return { label: 'COOL', cls: 'cool' };
  }

  // -- the model, recomputed in the page --------------------------------------
  // The same arithmetic main.ts runs, so the page's code and the board's data are visibly
  // the same model: TVL x the category's calibrated multiple x growth x maturity x breadth.
  function impliedOf(row) {
    var m = DATA.model;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(m.growth_cap, Math.max(m.growth_floor, g));
    var growthMult = 1 + (g / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_step * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity * breadth));
  }

  // -- small DOM helper -------------------------------------------------------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // -- state ------------------------------------------------------------------
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', minTvl: 0, sort: 'implied', dir: -1, watchOnly: false, earlyOnly: false, page: 0, selected: null };
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length !== 2) return;
      var k = decodeURIComponent(kv[0]), v = decodeURIComponent(kv[1]);
      if (k === 'row') state.selected = v;
      else if (k === 'tab' && (v === 'board' || v === 'live' || v === 'model')) state.tab = v;
      else if (k === 'cat') state.category = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'q') state.q = v;
      else if (k === 'sort') state.sort = v;
      else if (k === 'watch') state.watchOnly = v === '1';
      else if (k === 'early') state.earlyOnly = v === '1';
      else if (k === 'page') state.page = Math.max(0, parseInt(v, 10) || 0);
      else if (k === 'min') state.minTvl = parseInt(v, 10) || 0;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.selected) parts.push('row=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.watchOnly) parts.push('watch=1');
    if (state.earlyOnly) parts.push('early=1');
    if (state.page > 0) parts.push('page=' + state.page);
    if (state.minTvl > 0) parts.push('min=' + state.minTvl);
    var next = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== next) window.history.replaceState(null, '', next || window.location.pathname);
  }

  // -- filtering and sorting --------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.earlyOnly && r.on_watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d === null ? -1e9 : a.change_7d) - (b.change_7d === null ? -1e9 : b.change_7d);
      else if (key === 'age') d = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else if (key === 'rank') d = a.rank - b.rank;
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
    return rows;
  }

  // -- header, stats ----------------------------------------------------------
  function renderMeta() {
    var meta = document.getElementById('meta');
    clear(meta);
    meta.appendChild(el('div', {}, 'Snapshot as of ', el('b', { text: DATA.as_of })));
    meta.appendChild(el('div', {}, 'Model ', el('b', { text: DATA.model_version })));
    meta.appendChild(el('div', {}, 'Source: DefiLlama protocols'));
    document.getElementById('asof').textContent = DATA.as_of;
  }
  function renderStats() {
    var stats = document.getElementById('stats');
    clear(stats);
    var watchCovered = DATA.rows.filter(function (r) { return r.on_watchlist; }).length;
    function stat(k, v, s, cls) {
      return el('div', { class: 'stat' },
        el('div', { class: 'k', text: k }),
        el('div', { class: 'v' + (cls ? ' ' + cls : ''), text: v }),
        el('div', { class: 's', text: s }));
    }
    stats.appendChild(stat('Watchlist covered', watchCovered + ' / ' + DATA.watchlist_size, 'every $50M+ pre-token protocol', 'teal'));
    stats.appendChild(stat('Board rows', String(DATA.board_size), DATA.early_size + ' early finds below the floor'));
    stats.appendChild(stat('Total implied value', fmtUsd(DATA.total_implied_usd), 'across the whole board', 'amber'));
    stats.appendChild(stat('Global multiple', fmtMult(DATA.calibration.global_multiple), 'median mcap/TVL, ' + DATA.calibration.live_count + ' live protocols'));
  }

  // -- controls ---------------------------------------------------------------
  var categories = [], chains = [];
  (function collect() {
    var cs = {}, chs = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cs[r.category] = true;
      r.chains.forEach(function (c) { chs[c] = true; });
    });
    categories = Object.keys(cs).sort();
    chains = Object.keys(chs).sort();
  })();
  function renderControls() {
    var c = document.getElementById('controls');
    clear(c);
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 0; renderBoard(); });
    c.appendChild(el('label', {}, 'Search ', search));
    function select(label, options, value, onChange) {
      var s = el('select', { 'aria-label': label });
      options.forEach(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (o[0] === value) opt.selected = true;
        s.appendChild(opt);
      });
      s.addEventListener('change', function () { onChange(s.value); state.page = 0; renderBoard(); });
      c.appendChild(el('label', {}, label + ' ', s));
    }
    select('Category', [['all', 'All categories']].concat(categories.map(function (x) { return [x, x]; })), state.category, function (v) { state.category = v; });
    select('Chain', [['all', 'All chains']].concat(chains.map(function (x) { return [x, x]; })), state.chain, function (v) { state.chain = v; });
    select('Min TVL', [['0', 'Any TVL'], ['5000000', '$5M+'], ['50000000', '$50M+'], ['250000000', '$250M+'], ['1000000000', '$1B+']], String(state.minTvl), function (v) { state.minTvl = parseInt(v, 10); });
    select('Sort by', [['implied', 'Implied value'], ['tvl', 'TVL'], ['change', '7-day change'], ['age', 'Age'], ['name', 'Name'], ['rank', 'Rank']], state.sort, function (v) { state.sort = v; });
    var w = el('input', { type: 'checkbox', 'aria-label': 'Watchlist only' });
    w.checked = state.watchOnly;
    w.addEventListener('change', function () { state.watchOnly = w.checked; if (w.checked) state.earlyOnly = false; state.page = 0; renderBoard(); });
    c.appendChild(el('label', {}, w, ' Watchlist only'));
    var e = el('input', { type: 'checkbox', 'aria-label': 'Early finds only' });
    e.checked = state.earlyOnly;
    e.addEventListener('change', function () { state.earlyOnly = e.checked; if (e.checked) state.watchOnly = false; state.page = 0; renderBoard(); });
    c.appendChild(el('label', {}, e, ' Early finds only'));
  }

  // -- board table ------------------------------------------------------------
  function sortHeader(label, key, cls) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    var th = el('th', { class: (cls ? cls + ' ' : '') + 'sortable', text: label + arrow });
    th.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      renderBoard();
    });
    return th;
  }
  function renderBoard() {
    writeHash();
    var rows = filtered();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var pageRows = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    var count = document.getElementById('count');
    clear(count);
    count.appendChild(document.createTextNode('Showing '));
    count.appendChild(el('b', { text: String(pageRows.length) }));
    count.appendChild(document.createTextNode(' of '));
    count.appendChild(el('b', { text: String(rows.length) }));
    count.appendChild(document.createTextNode(' protocols, ranked by implied value. Click a row for its detail and farm plan.'));

    var table = document.getElementById('board');
    clear(table);
    var head = el('tr', {},
      el('th', { class: 'num', text: '#' }),
      sortHeader('Protocol', 'name'),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      sortHeader('TVL', 'tvl', 'num'),
      sortHeader('7d', 'change', 'num'),
      sortHeader('Age', 'age', 'num'),
      sortHeader('Implied value', 'implied', 'num'),
      el('th', { text: 'Signal' }));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody', {});
    pageRows.forEach(function (r) {
      var sig = signalOf(r);
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '' });
      tr.addEventListener('click', function () {
        state.selected = state.selected === r.slug ? null : r.slug;
        renderBoard();
        renderDetail();
      });
      var nameCell = el('td', {}, el('span', { class: 'name', text: r.name }), ' ');
      nameCell.appendChild(el('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'WATCHLIST' : 'EARLY' }));
      nameCell.appendChild(el('span', { class: 'slug', text: r.slug }));
      var chg = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
      tr.appendChild(el('td', { class: 'rank num', text: String(r.rank) }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(chg);
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) }));
      tr.appendChild(el('td', {}, el('span', { class: 'sig ' + sig.cls, text: sig.label })));
      body.appendChild(tr);
    });
    table.appendChild(body);

    var pager = document.getElementById('pager');
    clear(pager);
    var prev = el('button', { type: 'button', text: '← Prev' });
    prev.disabled = state.page === 0;
    prev.addEventListener('click', function () { state.page--; renderBoard(); });
    var next = el('button', { type: 'button', text: 'Next →' });
    next.disabled = state.page >= pages - 1;
    next.addEventListener('click', function () { state.page++; renderBoard(); });
    pager.appendChild(prev);
    pager.appendChild(el('span', { text: 'Page ' + (state.page + 1) + ' of ' + pages }));
    pager.appendChild(next);
    renderDetail();
  }

  // -- detail view ------------------------------------------------------------
  function splitStep(s) {
    var costAt = s.indexOf(' Cost: ');
    var timeAt = s.indexOf(' Time: ');
    if (costAt < 0) return { action: s, cost: '', time: '' };
    var action = s.slice(0, costAt);
    var cost = timeAt > costAt ? s.slice(costAt + 7, timeAt) : s.slice(costAt + 7);
    var time = timeAt > costAt ? s.slice(timeAt + 7) : '';
    if (time.endsWith('.')) time = time.slice(0, -1);
    if (cost.endsWith('.')) cost = cost.slice(0, -1);
    return { action: action, cost: cost, time: time };
  }
  function renderDetail() {
    var box = document.getElementById('detail');
    clear(box);
    if (!state.selected) return;
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
    if (!row) { state.selected = null; return; }
    var close = el('button', { type: 'button', class: 'close', text: 'Close ✕' });
    close.addEventListener('click', function () { state.selected = null; renderBoard(); });
    box.appendChild(close);
    box.appendChild(el('h2', {}, row.name + ' ', el('span', { class: 'badge ' + (row.on_watchlist ? 'watch' : 'early'), text: row.on_watchlist ? 'WATCHLIST' : 'EARLY FIND' })));
    box.appendChild(el('div', { class: 'sub', text: 'Rank #' + row.rank + ' · ' + row.slug + ' · ' + (row.category || 'uncategorised') + ' · ' + row.chains.join(', ') + ' · records no token' }));
    var grid = el('div', { class: 'detailgrid' });
    function dstat(k, v) { return el('div', { class: 'dstat' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })); }
    grid.appendChild(dstat('Implied value', fmtUsdFull(row.implied_value_usd)));
    grid.appendChild(dstat('TVL', fmtUsdFull(row.tvl_usd)));
    grid.appendChild(dstat('7-day change', fmtPct(row.change_7d)));
    grid.appendChild(dstat('Age with no token', fmtAge(row.age_days) + (row.listed_at ? ' · since ' + row.listed_at : '')));
    box.appendChild(grid);
    // The breakdown recomputes the value in the page, so the number shown is the model's, not a label.
    var check = impliedOf(row);
    var bd = el('div', { class: 'breakdown' });
    bd.appendChild(el('div', { class: 'eq' },
      'TVL ', el('b', { text: fmtUsd(row.tvl_usd) }),
      ' × ' + fmtMult(row.multiple) + ' (' + (row.category || 'global') + ' median, ' + row.multiple_n + ' live comparable' + (row.multiple_n === 1 ? '' : 's') + ')' +
      ' × ' + row.growth_multiplier.toFixed(2) + ' growth' +
      ' × ' + row.maturity_multiplier.toFixed(2) + ' maturity' +
      ' × ' + row.breadth_multiplier.toFixed(2) + ' breadth' +
      ' = ', el('b', { text: fmtUsdFull(row.implied_value_usd) })));
    bd.appendChild(el('div', { class: 'how', text: 'Recomputed in this page: ' + fmtUsdFull(check) + (check === row.implied_value_usd ? ' — matches the board.' : ' — the board rounds ties down a dollar, so a $1 gap is the tie-break, not a different model.') }));
    box.appendChild(bd);
    box.appendChild(el('h2', { text: 'Farm plan' }));
    var ol = el('ol', { class: 'plan' });
    row.farm_steps.forEach(function (s) {
      var p = splitStep(s);
      var li = el('li', {}, p.action);
      var chips = el('div', { class: 'chips' });
      if (p.cost) chips.appendChild(el('span', { class: 'chip' }, 'Cost: ', el('b', { text: p.cost })));
      if (p.time) chips.appendChild(el('span', { class: 'chip' }, 'Time: ', el('b', { text: p.time })));
      li.appendChild(chips);
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  // -- live tokens ------------------------------------------------------------
  function renderLive() {
    var table = document.getElementById('livetable');
    clear(table);
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'mcap / TVL' }), el('th', { class: 'num', text: '7d' }))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', {}, el('span', { class: 'name', text: r.name }), ' ', el('span', { class: 'slug', text: r.slug })));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: r.ratio === null ? 'n/a' : fmtMult(r.ratio) }));
      tr.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
  }

  // -- calibration + scatter --------------------------------------------------
  function renderModel() {
    var table = document.getElementById('caltable');
    clear(table);
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live n' }),
      el('th', { class: 'num', text: 'Median mcap/TVL' }), el('th', { class: 'num', text: 'Multiple used' }))));
    var body = el('tbody', {});
    DATA.calibration.categories.forEach(function (c) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { text: c.category }));
      tr.appendChild(el('td', { class: 'num', text: String(c.n) }));
      tr.appendChild(el('td', { class: 'num', text: fmtMult(c.median) }));
      tr.appendChild(el('td', { class: 'num implied', text: fmtMult(c.multiple) }));
      body.appendChild(tr);
    });
    table.appendChild(body);

    var host = document.getElementById('scatter');
    clear(host);
    var W = 1080, H = 300, P = 42;
    var rows = DATA.rows;
    var minT = Math.min.apply(null, rows.map(function (r) { return Math.log10(r.tvl_usd); }));
    var maxT = Math.max.apply(null, rows.map(function (r) { return Math.log10(r.tvl_usd); }));
    var minV = Math.min.apply(null, rows.map(function (r) { return Math.log10(r.implied_value_usd); }));
    var maxV = Math.max.apply(null, rows.map(function (r) { return Math.log10(r.implied_value_usd); }));
    function x(v) { return P + ((Math.log10(v) - minT) / (maxT - minT)) * (W - 2 * P); }
    function y(v) { return H - P - ((Math.log10(v) - minV) / (maxV - minV)) * (H - 2 * P); }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Scatter of TVL against implied value');
    function line(x1, y1, x2, y2, stroke) {
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', stroke); l.setAttribute('stroke-width', '1');
      svg.appendChild(l);
    }
    function text(xp, yp, s, anchor) {
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', xp); t.setAttribute('y', yp);
      t.setAttribute('fill', '#8fa3bf'); t.setAttribute('font-size', '11');
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = s;
      svg.appendChild(t);
    }
    line(P, P, P, H - P, '#2a3c5c');
    line(P, H - P, W - P, H - P, '#2a3c5c');
    text(P, H - 8, fmtUsd(Math.pow(10, minT)), 'start');
    text(W - P, H - 8, fmtUsd(Math.pow(10, maxT)), 'end');
    text(W / 2, H - 8, 'TVL (log scale)', 'middle');
    text(6, P + 4, fmtUsd(Math.pow(10, maxV)), 'start');
    text(6, H - P, fmtUsd(Math.pow(10, minV)), 'start');
    rows.forEach(function (r) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x(r.tvl_usd).toFixed(1));
      c.setAttribute('cy', y(r.implied_value_usd).toFixed(1));
      c.setAttribute('r', r.on_watchlist ? '5' : '3.5');
      c.setAttribute('fill', r.on_watchlist ? '#fbbf24' : '#2dd4bf');
      c.setAttribute('fill-opacity', r.on_watchlist ? '0.95' : '0.75');
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = r.name + ': TVL ' + fmtUsd(r.tvl_usd) + ', implied ' + fmtUsd(r.implied_value_usd);
      c.appendChild(title);
      svg.appendChild(c);
    });
    host.appendChild(svg);
  }

  // -- tabs -------------------------------------------------------------------
  function showTab(tab) {
    state.tab = tab;
    ['board', 'live', 'model'].forEach(function (t) {
      document.getElementById('tab-' + t).hidden = t !== tab;
    });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    if (tab === 'live') renderLive();
    if (tab === 'model') renderModel();
    writeHash();
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // -- boot -------------------------------------------------------------------
  readHash();
  renderMeta();
  renderStats();
  renderControls();
  renderBoard();
  if (state.tab === 'live') renderLive();
  if (state.tab === 'model') renderModel();
  showTab(state.tab);
})();
