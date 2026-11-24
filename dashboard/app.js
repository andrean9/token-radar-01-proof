// Token Radar dashboard: renders the board from data.js, filters it by text
// and category, sorts it, and shows a detail view for one protocol.
// Deep links via the hash: #detail=<slug>, #cat=<category>, #q=<text>.
(function () {
  var board = window.TOKEN_RADAR_BOARD;
  var rows = board.rows.slice();
  var state = { q: '', cat: '', sort: 'rank', detail: null };

  var metaEl = document.getElementById('meta');
  var countEl = document.getElementById('count');
  var rowsEl = document.getElementById('rows');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var sortEl = document.getElementById('sort');
  var detailEl = document.getElementById('detail');
  var boardWrap = document.getElementById('board-wrap');
  var controlsEl = document.getElementById('controls');

  var watchlistCount = rows.filter(function (r) { return r.watchlist; }).length;
  metaEl.textContent = rows.length + ' protocols ranked · ' + watchlistCount +
    ' on the watchlist · snapshot ' + board.as_of + ' · floor $' +
    board.floor_usd.toLocaleString('en-US');

  var categories = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
  });
  categories.sort();
  categories.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  });

  function fmtUsd(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    var sign = v > 0 ? '+' : '';
    return sign + v.toFixed(1) + '%';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    if (state.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'change') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + rows.length + ' shown';
    if (list.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">No protocol matches this filter.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(function (r) {
      var changeClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + changeClass + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td>' +
        '<td>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</td>' +
        '</tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) { hideDetail(); return; }
    state.detail = slug;
    var changeClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
    detailEl.innerHTML =
      '<button class="back" id="back">← Back to board</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="slug">' + esc(r.slug) + (r.watchlist ? ' · <span class="badge">Watchlist</span>' : '') + '</div>' +
      '<dl>' +
      '<dt>Rank</dt><dd>#' + r.rank + ' of ' + rows.length + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + fmtUsd(r.implied_value_usd) + '</strong></dd>' +
      '<dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd class="' + changeClass + '">' + fmtPct(r.change_7d) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(r.category || '—') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ')) + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || '—') + (r.age_days !== null ? ' (' + r.age_days + ' days)' : '') + '</dd>' +
      '<dt>Token recorded</dt><dd>No — this protocol records no token in the snapshot.</dd>' +
      '</dl>' +
      '<h3>How to farm it</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    boardWrap.hidden = true;
    controlsEl.hidden = true;
    document.getElementById('back').addEventListener('click', hideDetail);
  }

  function hideDetail() {
    state.detail = null;
    detailEl.hidden = true;
    detailEl.innerHTML = '';
    boardWrap.hidden = false;
    controlsEl.hidden = false;
  }

  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  qEl.addEventListener('input', function () { state.q = qEl.value; renderBoard(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; renderBoard(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; renderBoard(); });

  // Deep links: #detail=<slug>, #cat=<category>, #q=<text>.
  var hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get('cat')) { state.cat = hash.get('cat'); catEl.value = state.cat; }
  if (hash.get('q')) { state.q = hash.get('q'); qEl.value = state.q; }
  if (hash.get('sort')) { state.sort = hash.get('sort'); sortEl.value = state.sort; }
  renderBoard();
  if (hash.get('detail')) showDetail(hash.get('detail'));
})();
