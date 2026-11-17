/* Premint: a self-contained, snapshot-backed token launch radar. */
(function () {
  'use strict';

  // data
  var DATA = window.PREMINT;
  if (!DATA) return;
  var rows = DATA.rows || [];
  var app = document.getElementById('board');
  var topbar = document.getElementById('topbar');
  var footer = document.getElementById('colophon');
  var state = { segment: 'all', verdict: 'all', deposit: 10000, q: '', family: 'all', chain: 'all', sort: 'rank', dir: 1 };
  var number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  // format
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-$' : '$', a = Math.abs(n);
    if (a >= 1e9) return sign + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + number.format(a);
    return sign + number.format(a);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + number.format(Math.round(Math.abs(n)));
  }
  function fmtPct(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(days) { return days === null || days === undefined ? 'unknown' : days >= 365 ? (days / 365).toFixed(1) + ' y' : Math.round(days) + ' d'; }
  function fmtMult(n) { return 'x' + Number(n || 0).toFixed(2); }
  function fmtOdds(n, trueValue) { if (!isFinite(n)) return '∞'; if (n > 1 && !trueValue) return '>100%'; return (n * 100).toFixed(1) + '%'; }
  function fixed(n, digits) { return Number(n).toFixed(digits); }

  // model re-run
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function growthInput(row) { return clamp(row.change_7d == null ? 0 : row.change_7d, -60, 120) / 100; }
  function seasonInput(row) {
    var age = row.age_days == null ? 365 : row.age_days;
    return 1 - Math.exp(-age / 540);
  }
  function impliedValueOf(row) {
    var m = DATA.model, kind = m.kind === 'family' ? (m.baseKind || 'curve') : m.kind;
    var growth = growthInput(row), denom = m.usesLag ? 1 + growth : 1;
    var curve = Math.round(Math.pow(10, m.a + m.b * Math.log10(Math.max(1e-12, row.tvl_usd / denom))));
    var gm = (kind === 'growth' || kind === 'growthseason') ? clamp(Math.pow(10, m.growthCoef * growth), .35, 2) : 1;
    var sm = (kind === 'season' || kind === 'growthseason') ? clamp(Math.pow(10, m.seasonCoef * seasonInput(row)), .4, 1.6) : 1;
    var fm = m.kind === 'family' ? clamp(Math.pow(10, (m.family || {})[row.category || ''] || 0), .4, 2.5) : 1;
    return { value: Math.max(1, Math.round(curve * gm * sm * fm)), curve: Math.max(1, Math.round(curve)),
      growth: Number(gm.toFixed(4)), season: Number(sm.toFixed(4)), family: Number(fm.toFixed(4)) };
  }
  function chainClass(row) {
    var chains = row.chains || [], c = chains[0] || '';
    if (c === 'Ethereum') return 'ethereum';
    if (c === 'Solana') return 'solana';
    if (!chains.length) return 'other';
    return 'layer2';
  }
  function weeksFor(age) { return age == null ? 8 : age < 180 ? 12 : age < 365 ? 10 : age < 730 ? 8 : 6; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function econOf(row, deposit, value) {
    var farm = DATA.farm, weeks = weeksFor(row.age_days), gas = farm.gas[chainClass(row)];
    var slice = farm.airdrop_share * (value === undefined ? impliedValueOf(row).value : value) * deposit / (deposit + row.tvl_usd);
    var costs = gas.setup + gas.weekly * weeks + gas.claim;
    var yieldBearing = (farm.yield_bearing_categories || []).indexOf(row.category || '') >= 0;
    var forgone = yieldBearing ? 0 : round2(deposit * farm.forgone_apr * weeks / 52);
    var minutes = farm.minutes;
    var hours = (minutes.setup + minutes.weekly * weeks + minutes.claim) / 60;
    var net = slice - costs - forgone, breakeven = slice > 0 ? (costs + forgone) / slice : Infinity;
    var verdict = net > 0 && breakeven <= .12 ? 'Worth farming' : net > 0 && breakeven <= .35 ? 'Marginal' : 'Skip';
    return { deposit: deposit, weeks: weeks, slice: round2(slice), costs: round2(costs), forgone: round2(forgone), hours: hours,
      net: round2(net), breakeven: Number(breakeven.toFixed(4)), verdict: verdict };
  }
  function verifyAll() {
    var valueChecks = 0, econChecks = 0, mismatches = [];
    rows.forEach(function (r) {
      var model = impliedValueOf(r);
      if (model.value === r.implied_value_usd) valueChecks++; else mismatches.push(r.slug + ' value');
      [1000, 10000].forEach(function (deposit) {
        var got = econOf(r, deposit, model.value), saved = r.econ[String(deposit)] || {};
        ['slice', 'costs', 'forgone', 'net'].forEach(function (key) {
          if (got[key] !== saved[key]) mismatches.push(r.slug + ' $' + deposit + ' ' + key);
        });
        if (got.breakeven !== saved.breakeven) mismatches.push(r.slug + ' $' + deposit + ' breakeven');
        if (got.verdict !== saved.verdict) mismatches.push(r.slug + ' $' + deposit + ' verdict');
        if (got.slice === saved.slice && got.costs === saved.costs && got.forgone === saved.forgone && got.net === saved.net && got.breakeven === saved.breakeven && got.verdict === saved.verdict) econChecks++;
      });
    });
    return { values: valueChecks, econ: econChecks, mismatches: mismatches };
  }
  var verification = verifyAll();

  // dom
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var v = attrs[key];
      if (key === 'text') node.textContent = v;
      else if (key === 'html') node.innerHTML = v;
      else if (key === 'class') node.className = v;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(key, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }
  function moneyCell(n, full) { return el('span', { text: full ? fmtUsdFull(n) : fmtUsd(n) }); }
  function sub(text) { return el('span', { class: 'sub', text: text }); }
  function verdictChip(v) { return el('span', { class: 'verdict ' + (v === 'Worth farming' ? 'worth' : v === 'Marginal' ? 'marginal' : 'skip'), text: v }); }
  function tag(text, cls) { return el('span', { class: 'tag ' + (cls || ''), text: text }); }
  function tableWrap(table) { return el('div', { class: 'table-wrap' }, table); }
  function emptyState(title, message) {
    return el('div', { class: 'empty' }, el('h2', { text: title }), el('p', { text: message }),
      el('button', { class: 'chip', type: 'button', text: 'Clear filters', onclick: clearFilters }));
  }
  function clearMain(node) { app.replaceChildren(node); app.setAttribute('aria-busy', 'false'); }
  function addStat(value, label) { return el('div', { class: 'stat' }, el('span', { class: 'value', text: value }), el('span', { class: 'label', text: label })); }
  function tableHead(labels) { return el('thead', null, el('tr', null, labels.map(function (x) { return el('th', { scope: 'col', text: x }); }))); }

  // board
  function navLink(path, label, active) { return el('a', { class: 'tab', href: path, 'aria-pressed': active ? 'true' : 'false', text: label }); }
  function renderChrome(route) {
    var mark = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor"/><circle cx="16" cy="16" r="7" fill="none" stroke="currentColor"/><path d="M16 16 27 6M16 3v4M3 16h4M16 25v4M25 16h4" fill="none" stroke="currentColor"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg>';
    var check = verification.mismatches.length === 0;
    var chipText = check ? 'board.json = this page: ' + verification.values + '/' + rows.length + ' values and verdicts re-run in your browser' : verification.mismatches.length + ' verification mismatches';
    topbar.replaceChildren(el('div', { class: 'topbar-inner' },
      el('a', { class: 'brand', href: '#/', html: '<span class="brand-mark">' + mark + '</span><span>Premint</span>' }),
      el('span', { class: 'control-label', text: 'token launch radar · DefiLlama snapshot ' + DATA.as_of + ' · model ' + DATA.model_version }),
      el('nav', { class: 'tabs', 'aria-label': 'Views' }, navLink('#/', 'Board ' + DATA.counts.ranked, route.type === 'board'), navLink('#/traded', 'Already trade ' + DATA.counts.traded, route.type === 'traded'), navLink('#/aside', 'Set aside ' + DATA.counts.aside, route.type === 'aside')),
      el('span', { class: 'verify-chip ' + (check ? 'ok' : 'bad'), text: chipText, title: verification.mismatches.slice(0, 8).join(', ') })));
  }
  function renderFooter() {
    var farm = DATA.farm;
    footer.replaceChildren(el('div', { class: 'colophon-left' }, el('span', { class: 'footnote-label', text: 'Method & assumptions' }),
      el('p', { text: 'Fit on traded tokens, tested leave-one-out and on a time split, with every protocol accounted for. Values are model estimates from the sealed snapshot; they are not token prices.' }),
      el('p', { text: (farm.airdrop_share * 100).toFixed(1) + '% airdrop share; ' + (farm.forgone_apr * 100).toFixed(0) + '% annual yield forgone; setup / weekly / claim gas is estimated by chain class. Deposits: ' + farm.deposits.map(fmtUsd).join(' and ') + '.' })),
      el('div', { class: 'colophon-right' }, el('span', { class: 'footnote-label', text: 'Limits & source' }),
        el('p', { text: 'Implied values are this radar’s claims, never make.fun’s. A record of no token is not proof there is none, and nothing here says if or when a token launches. Costs are stated assumptions, not quotes. Not investment advice.' }),
        el('p', { text: 'Data: DefiLlama snapshot, fetched ' + DATA.as_of + ' (the sealed input every run reads). Model ' + DATA.model_version + '.' })));
  }
  function statStrip() {
    var c = DATA.counts, v = DATA.validation;
    return el('section', { class: 'stats', 'aria-label': 'Snapshot summary' },
      addStat(c.watchlist + '/' + c.watchlist, 'watchlist protocols ranked'),
      addStat(c.ranked, 'ranked, no token (' + c.watchlist + ' watchlist, ' + c.above_floor + ' above floor, ' + c.early + ' early)'),
      addStat(c.traded, 'already trade — ' + v.comps + ' fit the curve, none is ranked'),
      addStat(c.aside, 'set aside, every one with a reason'),
      addStat(v.looMedianMiss.toFixed(1) + 'x', 'median miss out of sample — leave-one-out; one flat multiple of TVL misses by ' + v.flatMedianMiss.toFixed(1) + 'x'));
  }
  function modelCopy() {
    var m = DATA.model, v = DATA.validation, kind = m.kind === 'family' ? (m.baseKind || 'curve') : m.kind;
    var growthActive = kind === 'growth' || kind === 'growthseason', seasonActive = kind === 'season' || kind === 'growthseason';
    var lines = ['log10 value = ' + m.a.toFixed(3) + ' + ' + m.b.toFixed(3) + ' x log10 TVL — each 10x of TVL multiplies value x' + Math.pow(10, m.b).toFixed(2) + '. A Huber fit on the ' + v.comps + ' traded tokens, re-centred so the median traded token sits on the curve.'];
    if (growthActive) lines.push('x the week\'s move, fitted at ' + m.growthCoef.toFixed(3) + ': ' + (m.growthCoef < 0 ? 'on the traded tokens a protocol whose TVL just spiked trades below the curve, so a hot week is priced as froth, not promise.' : 'on the traded tokens a protocol whose TVL just spiked trades above the curve, so a rising week is priced as momentum.') + ' The multiplier is clamped x0.35-x2.00.');
    else if (seasonActive) lines.push('x the wait, fitted at ' + m.seasonCoef.toFixed(3) + ': ' + (m.seasonCoef < 0 ? 'on traded tokens a long wait is priced as drift below the curve.' : 'on traded tokens a long wait is priced as a positive seasoning premium above the curve.') + ' The multiplier is clamped x0.40-x1.60.');
    else lines.push('The plain curve won the test outright.');
    return lines;
  }
  function scatterPanel() {
    var scat = DATA.validation.scatter, points = scat && scat.comps;
    var fallback = !points, comps = points || (DATA.traded || []).filter(function (r) { return r.mcap_usd > 0 && r.tvl_usd > 0; }).map(function (r) { return [Math.log10(r.tvl_usd), Math.log10(r.mcap_usd)]; });
    var curve = scat && scat.curve || [];
    var W = 520, H = 190, L = 48, R = 10, T = 22, B = 25, min = 4, max = 10;
    function X(x) { return L + (x - min) / (max - min) * (W - L - R); }
    function Y(y) { return H - B - (y - min) / (max - min) * (H - T - B); }
    var bits = ['<svg viewBox="0 0 520 190" role="img" aria-label="Log scale scatter of traded token market caps and ranked values">'];
    bits.push('<text x="48" y="13">Traded tokens set the curve; the rest sit on it</text>');
    function tickMoney(exp) { return ({ 4: '$10K', 5: '$100K', 6: '$1M', 7: '$10M', 8: '$100M', 9: '$1B', 10: '$10B' })[exp]; }
    [4, 5, 6, 7, 8, 9, 10].forEach(function (x) { bits.push('<line class="gridline" x1="' + X(x) + '" y1="' + T + '" x2="' + X(x) + '" y2="' + (H - B) + '"/><text x="' + (X(x) - 10) + '" y="' + (H - 7) + '">' + tickMoney(x) + '</text>'); });
    [4, 6, 8, 10].forEach(function (y) { bits.push('<line class="gridline" x1="' + L + '" y1="' + Y(y) + '" x2="' + (W - R) + '" y2="' + Y(y) + '"/><text x="2" y="' + (Y(y) + 3) + '">' + tickMoney(y) + '</text>'); });
    if (curve.length) {
      var poly = curve.map(function (p) { return X(p[0]) + ',' + Y(p[1] + .3); }).join(' ') + ' ' + curve.slice().reverse().map(function (p) { return X(p[0]) + ',' + Y(p[1] - .3); }).join(' ');
      bits.push('<polygon points="' + poly + '" fill="#a03d24" fill-opacity=".12"/>');
      bits.push('<polyline class="fit-line" fill="none" points="' + curve.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') + '"/>');
    }
    comps.forEach(function (p) { var x = Array.isArray(p) ? p[0] : Math.log10(p.tvl_usd), y = Array.isArray(p) ? p[1] : Math.log10(p.mcap_usd); if (x >= min && x <= max && y >= min && y <= max) bits.push('<circle cx="' + X(x) + '" cy="' + Y(y) + '" r="2.1" fill="#92897c" fill-opacity=".7" stroke="none"/>'); });
    rows.forEach(function (r) { var x = Math.log10(r.tvl_usd), y = Math.log10(r.implied_value_usd); if (x >= min && x <= max && y >= min && y <= max) bits.push('<circle cx="' + X(x) + '" cy="' + Y(y) + '" r="2.4"/>'); });
    bits.push('</svg>');
    return el('section', { class: 'panel' }, el('h3', { text: 'Traded tokens set the curve; the rest sit on it' }), el('div', { class: 'scatter', html: bits.join('') }), el('p', { text: fallback ? 'Fallback points: traded rows with market cap and TVL; these may include tokens outside the fit set.' : 'Grey: fit comps. Rust: ranked pre-token rows. The shaded band is P25–P75.' }));
  }
  function ablationPanel() {
    var names = { flat: 'TVL × one multiple', curve: '+ size curve (Huber)', lag: 'curve on last week’s TVL', growth: '+ 7-day growth tilt', season: '+ seasoning', growthseason: '+ growth and seasoning', family: '+ family offsets' };
    var adopted = DATA.model.kind;
    var body = el('tbody', null, DATA.validation.ablation.map(function (a) {
      var chosen = a.variant === adopted;
      var displayName = names[a.variant] || a.variant;
      if (a.variant === 'family' && !chosen) displayName += ' (no gain — not used)';
      return el('tr', { class: chosen ? 'adopted' : '' }, el('td', null, displayName, chosen ? el('strong', { text: ' adopted' }) : null), el('td', { class: 'num', text: a.medianMiss.toFixed(1) + 'x' }), el('td', { class: 'num', text: (a.within3 * 100).toFixed(0) + '%' }));
    }));
    return el('section', { class: 'panel' }, el('h3', { text: 'Out of sample — compareModels()' }),
      el('table', { class: 'ablation' }, el('thead', null, el('tr', null, el('th', { text: 'Model' }), el('th', { text: 'LOO miss' }), el('th', { text: 'Within 3×' }))), body),
      el('p', { text: 'Fit on the older half of traded tokens, tested on the newer: ' + DATA.validation.timeSplitMiss.toFixed(1) + 'x median miss.' }),
      el('p', { text: 'Rank correlation on traded tokens: ' + DATA.validation.looSpearman.toFixed(2) + '.' }),
      el('p', { text: 'The model is wrong by about ' + DATA.validation.looMedianMiss.toFixed(0) + 'x on a typical traded token. The bands say so on every row.' }));
  }
  function modelStrip() {
    var copy = modelCopy();
    return el('section', { class: 'panels' },
      el('section', { class: 'panel' }, el('h3', { text: 'How a value is built — impliedValue()' }),
        el('ol', { class: 'steps' }, copy.map(function (line, i) { return el('li', null, el('span', { class: 'steps-num', text: i + 1 }), el('span', { text: line })); })),
        el('p', { text: 'Band: the leave-one-out spread of traded tokens near this TVL, held inside x0.1-x10 because beyond that the snapshot’s wildest tokens say nothing useful about a row; rank range over ' + DATA.validation.refits + ' seeded refits.' }),
        el('p', { text: 'farmPlan(): slice = ' + (DATA.farm.airdrop_share * 100).toFixed(1) + '% of value × your deposit’s share of deposit + TVL. Worth farming when the launch odds that repay every cost are ≤ 12%, marginal ≤ 35%, else skip.' })),
      scatterPanel(), ablationPanel());
  }
  function currentEcon(r) { return econOf(r, state.deposit, r.implied_value_usd); }
  function categoryName(r) { return r.category || 'Other'; }
  function selectedRows() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      var e = currentEcon(r), chainList = r.chains || [];
      if (state.segment === 'watchlist' && !r.watchlist) return false;
      if (state.segment === 'above' && !r.above_floor) return false;
      if (state.segment === 'early' && (r.watchlist || r.above_floor)) return false;
      if (state.verdict !== 'all' && e.verdict !== state.verdict) return false;
      if (state.family !== 'all' && categoryName(r) !== state.family) return false;
      if (state.chain !== 'all' && chainList.indexOf(state.chain) < 0) return false;
      return !q || [r.name, r.slug, r.category, chainList.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function verdictCounts() {
    var out = { 'Worth farming': 0, Marginal: 0, Skip: 0 };
    rows.forEach(function (r) { out[currentEcon(r).verdict]++; }); return out;
  }
  function filtersActive() { return state.segment !== 'all' || state.verdict !== 'all' || state.q || state.family !== 'all' || state.chain !== 'all'; }
  function clearFilters() { state.segment = 'all'; state.verdict = 'all'; state.q = ''; state.family = 'all'; state.chain = 'all'; render(); }
  function farmBook(list) {
    var n = list.length, cost = 0, forgone = 0, slice = 0, hours = 0;
    list.forEach(function (r) { var e = currentEcon(r); cost += e.costs; forgone += e.forgone; slice += e.slice; hours += e.hours; });
    var capital = n * state.deposit, odds = slice > cost + forgone ? (cost + forgone) / slice : null;
    function item(label, value, extra) { return el('div', { class: 'total' }, el('span', { class: 'value', text: value }), el('span', { class: 'label', text: label + (extra || '') })); }
    return el('section', { class: 'farmbook' }, item('Capital at work', fmtUsd(capital)), item('Fees and gas', fmtUsd(cost)), item('Yield forgone', fmtUsd(forgone)), item('Your time', hours.toFixed(1) + ' h'), item('Slices if all launch', fmtUsd(slice), ' · net ' + fmtUsd(slice - cost - forgone)), item('Book break-even', odds === null ? 'none' : '1 in ' + Math.round(1 / odds), odds === null ? ' launches repay it' : ' launches'));
  }
  function filters() {
    var counts = verdictCounts(), families = {}, chains = {};
    rows.forEach(function (r) { families[categoryName(r)] = (families[categoryName(r)] || 0) + 1; (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    function chip(label, key, val, n) { return el('button', { class: 'chip', type: 'button', 'aria-pressed': state[key] === val ? 'true' : 'false', onclick: function () { state[key] = val; render(); } }, label, n === undefined ? null : el('span', { class: 'n', text: n })); }
    var search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; renderBoard(false); });
    var family = el('select', { class: 'control-select', 'aria-label': 'Filter by family' }, el('option', { value: 'all', text: 'All families' }), Object.keys(families).sort().map(function (c) { return el('option', { value: c, text: c + ' (' + families[c] + ')', selected: c === state.family ? 'selected' : null }); }));
    family.addEventListener('change', function () { state.family = family.value; render(); });
    var chain = el('select', { class: 'control-select', 'aria-label': 'Filter by chain' }, el('option', { value: 'all', text: 'All chains' }), Object.keys(chains).sort().map(function (c) { return el('option', { value: c, text: c + ' (' + chains[c] + ')', selected: c === state.chain ? 'selected' : null }); }));
    chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var deposit = el('div', { class: 'seg', 'aria-label': 'Deposit size' }, [10000, 1000].map(function (d) { return el('button', { type: 'button', 'aria-pressed': state.deposit === d ? 'true' : 'false', text: fmtUsd(d), onclick: function () { state.deposit = d; render(); } }); }));
    var result = el('div', { class: 'filters' },
      el('div', { class: 'chips' }, chip('All', 'segment', 'all', rows.length), chip('Watchlist', 'segment', 'watchlist', DATA.counts.watchlist), chip('Above floor', 'segment', 'above', DATA.counts.above_floor), chip('Early', 'segment', 'early', DATA.counts.early),
        chip('Any verdict', 'verdict', 'all'), chip('Worth farming', 'verdict', 'Worth farming', counts['Worth farming']), chip('Marginal', 'verdict', 'Marginal', counts.Marginal), chip('Skip', 'verdict', 'Skip', counts.Skip)),
      el('div', { class: 'controls' }, el('span', { class: 'control-label', text: 'Deposit' }), deposit, search, family, chain,
        filtersActive() ? el('button', { class: 'chip', type: 'button', text: 'Clear filters', onclick: clearFilters }) : null),
      el('p', { class: 'shown-line', text: selectedRows().length + ' of ' + rows.length + ' shown, plans at ' + fmtUsd(state.deposit) }));
    return result;
  }
  function bandGlyph(r) {
    var lo = Math.max(1, r.band[0]), hi = Math.max(lo * 1.01, r.band[3]), a = Math.log(lo), b = Math.log(hi), x = function (v) { return 3 + (Math.log(Math.max(lo, v)) - a) / (b - a) * 42; };
    return el('span', { class: 'bandglyph', title: 'P10 ' + fmtUsd(r.band[0]) + ' · P25 ' + fmtUsd(r.band[1]) + ' · P75 ' + fmtUsd(r.band[2]) + ' · P90 ' + fmtUsd(r.band[3]) }, el('svg', { viewBox: '0 0 48 13', 'aria-hidden': 'true', html: '<line x1="3" y1="6.5" x2="45" y2="6.5" stroke="#c9b995"/><line x1="' + x(r.band[1]) + '" y1="6.5" x2="' + x(r.band[2]) + '" y2="6.5" stroke="#a03d24" stroke-width="3"/><line x1="' + x(r.band[0]) + '" y1="3" x2="' + x(r.band[0]) + '" y2="10" stroke="#a03d24"/><line x1="' + x(r.band[3]) + '" y1="3" x2="' + x(r.band[3]) + '" y2="10" stroke="#a03d24"/><circle class="active" cx="' + x(r.implied_value_usd) + '" cy="6.5" r="2.4"/>' }));
  }
  function sortValue(r, key) {
    var e = currentEcon(r);
    return key === 'rank' ? r.rank : key === 'implied' ? r.implied_value_usd : key === 'tvl' ? r.tvl_usd : key === 'change' ? (r.change_7d == null ? -Infinity : r.change_7d) : key === 'age' ? (r.age_days == null ? -Infinity : r.age_days) : key === 'net' ? e.net : key === 'breakeven' ? e.breakeven : key === 'nethour' ? e.net / e.hours : 0;
  }
  function sortButton(key, label, align) { return el('th', { class: align || '', scope: 'col' }, el('button', { type: 'button', class: 'sort-button', onclick: function () { if (state.sort === key) state.dir *= -1; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } render(); } }, label, state.sort === key ? (state.dir > 0 ? ' ↑' : ' ↓') : '')); }
  function boardTable(list) {
    if (!list.length) return emptyState('No protocol matches those filters', 'Clear a filter or change the search to see the board again.');
    list = list.slice().sort(function (a, b) { var x = sortValue(a, state.sort), y = sortValue(b, state.sort); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * state.dir; });
    var body = el('tbody', null, list.map(function (r) {
      var e = currentEcon(r), tg = r.watchlist ? tag('watchlist', 'watchlist') : r.above_floor ? tag('above floor', 'above-floor') : tag('early', 'early');
      return el('tr', null,
        el('td', { class: 'rank num' }, String(r.rank), sub(r.rank_range.join('–'))),
        el('td', { class: 'protocol' }, el('a', { href: '#/p/' + encodeURIComponent(r.slug), text: r.name }), el('div', null, tg), sub(categoryName(r) + ' · ' + ((r.chains || []).slice(0, 2).join(', ') || 'unknown') + ((r.chains || []).length > 2 ? ' +' + (r.chains.length - 2) : ''))),
        el('td', { class: 'num' }, el('strong', { text: fmtUsd(r.implied_value_usd) }), sub(fmtUsd(r.band[0]) + '–' + fmtUsd(r.band[3]))),
        el('td', { class: 'num' }, bandGlyph(r)), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }), el('td', { class: 'num', text: fmtUsd(e.slice) }),
        el('td', { class: 'num ' + (e.net >= 0 ? 'pos' : 'neg'), text: fmtUsd(e.net) }),
        el('td', { class: 'num', text: fmtOdds(e.breakeven, false) }),
        el('td', { class: 'num', text: fmtUsd(e.net / e.hours) + '/h' }),
        el('td', { class: 'verdict-cell' }, verdictChip(e.verdict), sub(((r.chains || [])[0] || 'its main chain') + ' · ' + e.weeks + ' wk')));
    }));
    var head = el('thead', null, el('tr', null, sortButton('rank', '#', 'rank'), el('th', { text: 'Protocol' }), sortButton('implied', 'Implied value', 'num'), el('th', { text: 'Band', class: 'num' }), sortButton('tvl', 'TVL', 'num'), sortButton('change', '7D', 'num'), sortButton('age', 'No token for', 'num'), sortButton('implied', 'Slice if launch', 'num'), sortButton('net', 'Net if launch', 'num'), sortButton('breakeven', 'Break-even', 'num'), sortButton('nethour', 'Net / hour', 'num'), el('th', { class: 'verdict-cell', text: 'Farm verdict' })));
    return tableWrap(el('table', { class: 'board' }, head, body));
  }
  function renderBoard(withChrome) {
    if (withChrome !== false) renderChrome({ type: 'board' });
    var list = selectedRows(), filtered = filtersActive();
    var content = [statStrip()];
    if (filtered) content.push(farmBook(list)); else content.push(modelStrip());
    content.push(filters(), boardTable(list));
    clearMain(el('div', null, content));
  }

  // detail
  function detailFactors(r) {
    var x = impliedValueOf(r), m = DATA.model;
    var cards = [el('div', { class: 'factor-card' }, el('span', { class: 'factor-label', text: 'Curve at this TVL' }), el('span', { class: 'factor-value', text: fmtUsdFull(x.curve) }))];
    if (m.growthCoef !== 0) cards.push(el('div', { class: 'factor-card' }, el('span', { class: 'factor-label', text: 'Growth multiplier' }), el('span', { class: 'factor-value', text: fmtMult(x.growth) })));
    if (m.seasonCoef !== 0) cards.push(el('div', { class: 'factor-card' }, el('span', { class: 'factor-label', text: 'Seasoning multiplier' }), el('span', { class: 'factor-value', text: fmtMult(x.season) }), sub(fmtAge(r.age_days) + ' with no token on record')));
    if (m.family && Object.keys(m.family).length) cards.push(el('div', { class: 'factor-card' }, el('span', { class: 'factor-label', text: 'Family multiplier' }), el('span', { class: 'factor-value', text: fmtMult(x.family) })));
    cards.push(el('span', { class: 'factor-equals', text: '=' }), el('div', { class: 'factor-result' }, el('span', { class: 'factor-label', text: 'Implied value' }), el('span', { class: 'factor-value', text: fmtUsdFull(x.value) })));
    var ablation = DATA.validation.ablation || [], active = { growth: m.growthCoef !== 0, season: m.seasonCoef !== 0, family: !!(m.family && Object.keys(m.family).length) };
    var candidates = [
      { variants: ['growth', 'growthseason'], active: active.growth, name: 'growth tilt' },
      { variants: ['season'], active: active.season, name: 'seasoning' },
      { variants: ['family'], active: active.family, name: 'family offsets' }
    ];
    var rejected = [];
    candidates.forEach(function (c) {
      var a = ablation.filter(function (entry) { return c.variants.indexOf(entry.variant) !== -1; })[0];
      if (a && !c.active) rejected.push({ name: c.name, miss: a.medianMiss });
    });
    var note = null;
    if (rejected.length) {
      var adopted = ablation.filter(function (a) { return a.variant === m.kind; })[0], names = rejected.map(function (x) { return x.name + ' ' + x.miss.toFixed(1) + 'x'; });
      var listing = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      note = el('p', { class: 'sub', text: 'Also fitted, and rejected by the same leave-one-out test: ' + listing + ' — the adopted model misses by ' + (adopted ? adopted.medianMiss.toFixed(1) : DATA.validation.looMedianMiss.toFixed(1)) + 'x, so ' + (names.length === 1 ? 'it does' : 'neither') + ' enter this price.' });
    }
    return el('div', null, el('div', { class: 'factor-cards' }, cards), note);
  }
  function detailEconTable(r) {
    var keys = [['Costs', 'costs'], ['Slice if launch', 'slice'], ['Net if launch', 'net'], ['Break-even', 'breakeven'], ['Verdict', 'verdict']];
    return el('table', { class: 'deptable' }, el('thead', null, el('tr', null, el('th', { text: 'Plan' }), DATA.farm.deposits.map(function (d) { return el('th', { class: 'num', text: fmtUsd(d) }); }))),
      el('tbody', null, keys.map(function (k) { return el('tr', null, el('td', { text: k[0] }), DATA.farm.deposits.map(function (d) { var e = econOf(r, d, r.implied_value_usd); return el('td', { class: k[1] === 'net' ? (e.net >= 0 ? 'pos' : 'neg') : '' }, k[1] === 'verdict' ? verdictChip(e.verdict) : k[1] === 'breakeven' ? fmtOdds(e.breakeven, true) : fmtUsd(e[k[1]])); })); })));
  }
  function actionSummary(row) {
    var c = row.category || '';
    if (/Lending|CDP|Collateral/i.test(c)) return 'supply';
    if (/Dexs|Trading/i.test(c)) return 'provide liquidity';
    if (/Yield|Vaults|Risk Curators|Onchain Capital Allocator/i.test(c)) return 'deposit';
    if (/Derivatives|Perps/i.test(c)) return 'margin';
    if (/Bridge/i.test(c)) return 'bridge';
    if (/RWA/i.test(c)) return 'mint';
    if (/Prediction Market/i.test(c)) return 'fund';
    return 'deposit';
  }
  function renderDetail(slug) {
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) { renderBoard(); return; }
    renderChrome({ type: 'detail' });
    var chain = (r.chains || [])[0] || 'the protocol’s main chain', e = econOf(r, 1000, r.implied_value_usd), value = r.implied_value_usd;
    var compRows = (r.comps_near || []).map(function (c) { return el('tr', null, el('td', null, c.name, sub(c.symbol || '')), el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: fmtUsd(c.curve_value_usd) }), el('td', { class: 'num', text: fmtMult(c.ratio) })); });
    var steps = r.steps || [], timeline = el('div', { class: 'timeline' }, steps.map(function (s, i) { return el('div', { class: 'timeline-item ' + (i === 0 ? 'current' : '') }, el('span', { class: 'dot', text: i + 1 }), el('span', { text: s.when })); }));
    var totals = el('div', { class: 'totals' },
      ['costs', 'forgone', 'hours', 'slice', 'breakeven', 'net'].map(function (key) { var label = { costs: 'Fees and gas', forgone: 'Yield forgone', hours: 'Your time', slice: 'Slice if launch', breakeven: 'Break-even odds', net: 'Net if launch' }[key]; var val = key === 'hours' ? e.hours.toFixed(1) + ' h' : key === 'breakeven' ? fmtOdds(e.breakeven, true) : fmtUsd(e[key]); return el('div', { class: 'total' }, el('span', { class: 'value', text: val }), el('span', { class: 'label', text: label }), key === 'net' ? sub(fmtUsd(e.net / e.hours) + '/h') : null); }));
    var formula = 'Slice = ' + (DATA.farm.airdrop_share * 100).toFixed(1) + '% × ' + fmtUsdFull(value) + ' × $1,000 / ($1,000 + ' + fmtUsdFull(r.tvl_usd) + ') = ' + fmtUsd(e.slice) + '. Break-even = (' + fmtUsd(e.costs) + ' costs + ' + fmtUsd(e.forgone) + ' forgone) / ' + fmtUsd(e.slice) + ' = ' + fmtOdds(e.breakeven, true) + ' — ' + (e.verdict === 'Worth farming' ? 'net is positive and odds are at most 12%' : e.verdict === 'Marginal' ? 'net is positive and odds are at most 35%' : 'net is non-positive or odds exceed 35%') + '.';
    var head = el('div', { class: 'view-head' }, el('div', null, el('a', { class: 'backlink', href: '#/', text: '← Board' }), el('h1', { class: 'page-title', text: r.name }), el('div', null, r.watchlist ? tag('watchlist', 'watchlist') : r.above_floor ? tag('above floor', 'above-floor') : tag('early', 'early')), el('p', { text: categoryName(r) + ' · ' + ((r.chains || []).join(', ') || 'chain unknown') })));
    var left = el('section', null,
      el('section', { class: 'panel' }, el('h3', { text: 'Implied value, our model’s claim' }), el('div', { class: 'stat-value', text: fmtUsdFull(value) }), el('p', { text: 'Rank ' + r.rank + ' of ' + rows.length + ' · ' + r.rank_range.join('–') + ' across refits' }), el('p', { text: 'P25–P75 ' + fmtUsd(r.band[1]) + '–' + fmtUsd(r.band[2]) + ' · P10–P90 ' + fmtUsd(r.band[0]) + '–' + fmtUsd(r.band[3]) })),
      el('section', { class: 'panel' }, el('h3', { text: 'How the value is built — impliedValue()' }), detailFactors(r), el('p', { text: 'Band: the leave-one-out spread of traded tokens near this TVL, held inside x0.1-x10 because beyond that the snapshot’s wildest tokens say nothing useful about a row.' })),
      el('section', { class: 'panel' }, el('h3', { text: 'Its record in the snapshot' }), el('table', { class: 'kv' }, el('tbody', null, [['TVL', fmtUsdFull(r.tvl_usd)], ['7-day change', fmtPct(r.change_7d)], ['Listed at', r.listed_at || 'null'], ['Category', categoryName(r)], ['Chains', (r.chains || []).join(', ')], ['Market cap', 'null — records no token'], ['Gecko ID', 'null'], ['Symbol', 'null']].map(function (x) { return el('tr', null, el('th', { text: x[0] }), el('td', { text: x[1] })); })))),
      el('section', { class: 'panel' }, el('h3', { text: 'Deposit size' }), detailEconTable(r)),
      el('section', { class: 'panel' }, el('h3', { text: 'Nearest traded tokens, by TVL' }), el('table', { class: 'comps' }, el('thead', null, el('tr', null, ['Token', 'TVL', 'Market cap', 'Curve value', 'Actual / curve'].map(function (x) { return el('th', { text: x }); }))), el('tbody', null, compRows))));
    var right = el('section', { class: 'panel' }, el('h3', { text: 'Farm plan — farmPlan(): ' + actionSummary(r) + ' on ' + chain + ' · $1,000 · ' + e.weeks + ' weeks' }), el('p', { text: 'The $1,000 plan — the same steps board.json carries.' }), verdictChip(e.verdict), timeline,
      el('table', { class: 'plan' }, el('thead', null, el('tr', null, ['When', 'Step', 'Cost', 'Time'].map(function (x) { return el('th', { text: x }); }))), el('tbody', null, steps.map(function (s) { return el('tr', null, el('td', { text: s.when }), el('td', { text: s.text }), el('td', { text: s.cost }), el('td', { text: s.time })); }))),
      totals, el('p', { text: formula }), el('p', { text: 'One wallet, your own funds. A record of no token is not proof there is none.' }));
    clearMain(el('div', null, head, el('div', { class: 'detail' }, left, right)));
  }

  // traded
  function renderTraded() {
    renderChrome({ type: 'traded' });
    var data = (DATA.traded || []).slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    var body = el('tbody', null, data.map(function (r) { return el('tr', null, el('td', null, r.name, sub(r.symbol || '')), el('td', { text: categoryName(r) }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', { class: 'num', text: fmtUsd(r.curve_value_usd) }), el('td', { class: 'num', text: fmtMult(r.ratio) })); }));
    clearMain(el('div', null, el('div', { class: 'view-head' }, el('div', null, el('h1', { text: 'Already trade — the market’s own numbers' }), el('p', { text: data.length + ' protocols with recorded tokens and market caps.' }))), tableWrap(el('table', { class: 'board' }, el('thead', null, el('tr', null, ['Protocol + symbol', 'Family', 'TVL', 'Market cap', 'Our curve would say', 'Actual / curve'].map(function (x) { return el('th', { text: x }); }))), body)), el('p', { class: 'table-caption', text: 'These protocols already trade and are never ranked. The curve column is the model’s reading of them, shown so you can judge the model.' })));
  }

  // aside
  function renderAside() {
    renderChrome({ type: 'aside' });
    var data = (DATA.aside || []).slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }), reasonCounts = {};
    data.forEach(function (r) { reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1; });
    var chips = Object.keys(reasonCounts).sort().map(function (reason) { return el('span', { class: 'chip' }, reason, el('span', { class: 'n', text: reasonCounts[reason] })); });
    var body = el('tbody', null, data.slice(0, 150).map(function (r) { return el('tr', null, el('td', { text: r.name }), el('td', { text: categoryName(r) }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { text: r.reason })); }));
    clearMain(el('div', null, el('div', { class: 'view-head' }, el('div', null, el('h1', { text: 'Set aside — and why' }), el('p', { text: data.length + ' protocols excluded from the ranked board; reasons are derived from these rows.' })), el('span', { class: 'view-counts', text: 'DefiLlama snapshot ' + DATA.as_of })), el('div', { class: 'chips' }, chips), tableWrap(el('table', { class: 'board' }, el('thead', null, el('tr', null, ['Protocol', 'Family', 'TVL', 'Reason'].map(function (x) { return el('th', { text: x }); }))), body)), data.length > 150 ? el('p', { class: 'table-caption', text: 'Showing the first 150 of ' + data.length + ' set-aside protocols, sorted by TVL.' }) : null));
  }

  // chrome
  function render() {
    var hash = window.location.hash || '#/';
    if (hash === '#/traded') renderTraded();
    else if (hash === '#/aside') renderAside();
    else if (hash.indexOf('#/p/') === 0) renderDetail(decodeURIComponent(hash.slice(4)));
    else renderBoard();
    renderFooter();
  }

  // routing
  window.addEventListener('hashchange', render);
  render();
}());
