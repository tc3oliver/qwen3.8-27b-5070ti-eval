(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var COLORS = ['var(--s1)', 'var(--s2)', '#2f9e44', '#9c36b5', '#e0a100', '#0b7285'];
  var COLS = [
    ['model', '模型'], ['params', '參數量'], ['active_params', '啟用參數'], ['evidence', '證據等級'],
    ['humaneval_pass_pct', 'HumanEval (%)'], ['tenq_score', '十題得分'], ['tenq_tokens', '十題 tokens'],
    ['code_review', '程式審查'], ['agent', 'Agent'], ['longctx_60k', '60k 長上下文'],
    ['first_answer_p50_s', '首答 P50 (s)'], ['decode_tps', '解碼 (tok/s)']
  ];
  var TEXT_COLS = { model: 1, params: 1, active_params: 1, evidence: 1 };
  var METRIC_LABEL = { humaneval_pass_pct: 'HumanEval 通過率 (%)', tenq_score: '十題評測得分', tenq_tokens: '十題 token 用量' };
  var models = [], timeline = [], sort = { col: null, dir: 'desc' };

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function html(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    var head = rows.shift();
    return rows.map(function (r) { var o = {}; head.forEach(function (h, i) { o[h.trim()] = (r[i] || '').trim(); }); return o; });
  }
  function num(v) { return v === '' || v == null ? null : parseFloat(v); }
  function fmt(v) { return v.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function modelColor(name) {
    var names = models.map(function (m) { return m.model; });
    return COLORS[names.indexOf(name) % COLORS.length];
  }

  function renderKPIs() {
    var hv = Math.max.apply(null, models.map(function (m) { return num(m.humaneval_pass_pct); }).filter(function (v) { return v !== null; }));
    var dv = Math.max.apply(null, models.map(function (m) { return num(m.decode_tps); }).filter(function (v) { return v !== null; }));
    document.querySelector('[data-kpi=humaneval]').textContent = isFinite(hv) ? hv.toFixed(1) + '%' : '—';
    document.querySelector('[data-kpi=decode]').textContent = isFinite(dv) ? dv.toFixed(1) + ' tok/s' : '—';
    document.querySelector('[data-kpi=models]').textContent = models.length;
  }

  function renderBars() {
    var metric = document.getElementById('metric').value, svg = document.getElementById('bar-chart');
    var data = models.filter(function (m) { return num(m[metric]) !== null; });
    var missing = models.length - data.length;
    var W = 800, rowH = 52, top = 16, left = 200, right = 90, H = top + data.length * rowH + 34;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';
    var max = niceMax(Math.max.apply(null, data.map(function (m) { return num(m[metric]); })) || 1);
    var plotW = W - left - right, ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var x = left + plotW * t / ticks;
      svg.appendChild(el('line', { class: 'grid', x1: x, x2: x, y1: top, y2: H - 28 }));
      svg.appendChild(el('text', { x: x, y: H - 10, 'text-anchor': 'middle' }, fmt(max * t / ticks)));
    }
    svg.appendChild(el('line', { class: 'axis', x1: left, x2: left, y1: top, y2: H - 28 }));
    data.forEach(function (m, i) {
      var v = num(m[metric]), y = top + i * rowH + 9, w = plotW * v / max;
      var name = m.model.length > 24 ? m.model.slice(0, 23) + '…' : m.model;
      var lab = el('text', { class: 'model-label', x: left - 10, y: y + 17, 'text-anchor': 'end' }, name);
      lab.appendChild(el('title', {}, m.model));
      svg.appendChild(lab);
      svg.appendChild(el('rect', { class: 'bar', x: left, y: y, width: w, height: 32, rx: 4, fill: modelColor(m.model), 'data-model': m.model, 'data-value': v }));
      svg.appendChild(el('text', { class: 'bar-label', x: left + w + 8, y: y + 21 }, fmt(v)));
    });
    document.getElementById('bar-note').textContent = METRIC_LABEL[metric] + (missing ? '；' + missing + ' 個模型未測量，不顯示' : '');
  }

  function renderLines() {
    var svg = document.getElementById('line-chart'), tip = document.getElementById('tooltip');
    var W = 800, H = 380, L = 56, R = 20, T = 16, B = 52, pw = W - L - R, ph = H - T - B;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';
    var xs = timeline.map(function (r) { return num(r.minute); }), ys = timeline.map(function (r) { return num(r.decode_tps); });
    var xmax = Math.ceil(Math.max.apply(null, xs) / 5) * 5, ymax = niceMax(Math.max.apply(null, ys));
    function X(v) { return L + pw * v / xmax; }
    function Y(v) { return T + ph - ph * v / ymax; }
    var i, v;
    for (i = 0; i <= 5; i++) {
      v = ymax * i / 5;
      svg.appendChild(el('line', { class: 'grid', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }));
      svg.appendChild(el('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
    }
    for (i = 0; i <= 5; i++) {
      v = xmax * i / 5;
      svg.appendChild(el('text', { x: X(v), y: T + ph + 18, 'text-anchor': 'middle' }, fmt(v)));
    }
    svg.appendChild(el('line', { class: 'axis', x1: L, x2: W - R, y1: T + ph, y2: T + ph }));
    svg.appendChild(el('line', { class: 'axis', x1: L, x2: L, y1: T, y2: T + ph }));
    svg.appendChild(el('text', { class: 'axis-title', x: L + pw / 2, y: H - 8, 'text-anchor': 'middle' }, '時間（分鐘）'));
    svg.appendChild(el('text', { class: 'axis-title', transform: 'translate(14 ' + (T + ph / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, '解碼速度 (tok/s)'));

    var legend = document.getElementById('legend'); legend.innerHTML = '';
    models.forEach(function (m) {
      var rows = timeline.filter(function (r) { return r.model === m.model; })
        .sort(function (a, b) { return num(a.minute) - num(b.minute); });
      if (!rows.length) return;
      var c = modelColor(m.model);
      svg.appendChild(el('path', { class: 'series', 'data-model': m.model, stroke: c,
        d: rows.map(function (r, k) { return (k ? 'L' : 'M') + X(num(r.minute)).toFixed(1) + ' ' + Y(num(r.decode_tps)).toFixed(1); }).join('') }));
      var s = html('span'); var sw = html('i'); sw.style.background = c;
      s.appendChild(sw); s.appendChild(document.createTextNode(m.model)); legend.appendChild(s);
    });
    timeline.forEach(function (r) {
      var c = el('circle', { class: 'point', cx: X(num(r.minute)), cy: Y(num(r.decode_tps)), r: 3.2, fill: modelColor(r.model),
        'data-model': r.model, 'data-value': r.decode_tps, 'data-minute': r.minute });
      c.addEventListener('mouseenter', function (e) {
        tip.textContent = '';
        tip.appendChild(html('strong', null, r.model));
        tip.appendChild(html('div', null, r.decode_tps + ' tok/s　@ ' + r.minute + ' 分'));
        tip.hidden = false; place(e);
      });
      c.addEventListener('mousemove', place);
      c.addEventListener('mouseleave', function () { tip.hidden = true; });
      svg.appendChild(c);
    });
    function place(e) {
      var w = tip.offsetWidth, x = e.clientX + 14, y = e.clientY - tip.offsetHeight - 12;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y < 8) y = e.clientY + 18;
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = y + 'px';
    }
  }

  function renderTable() {
    var thead = document.querySelector('#results-table thead'), tbody = document.querySelector('#results-table tbody');
    var tr = html('tr');
    COLS.forEach(function (c) {
      var th = html('th', { 'data-sort': c[0], scope: 'col' });
      th.appendChild(document.createTextNode(c[1]));
      var a = html('span', { class: 'arrow' }, sort.col === c[0] ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
      th.appendChild(a);
      th.addEventListener('click', function () {
        sort = { col: c[0], dir: sort.col === c[0] && sort.dir === 'desc' ? 'asc' : 'desc' };
        renderTable();
      });
      tr.appendChild(th);
    });
    thead.innerHTML = ''; thead.appendChild(tr);
    var rows = models.slice();
    if (sort.col) {
      var col = sort.col, f = sort.dir === 'desc' ? -1 : 1, isText = TEXT_COLS[col];
      var key = function (m) { return isText ? (m[col] === '' ? null : m[col]) : num(m[col]); };
      rows.sort(function (a, b) {
        var x = key(a), y = key(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (isText ? String(x).localeCompare(String(y), 'zh-Hant', { numeric: true }) : x - y) * f;
      });
    }
    tbody.innerHTML = '';
    rows.forEach(function (m) {
      var r = html('tr');
      COLS.forEach(function (c) {
        var v = m[c[0]], td = html('td');
        if (v === '') { td.textContent = '—'; td.className = 'na'; }
        else if (c[0] === 'evidence') td.appendChild(html('span', { class: 'badge badge-' + v, title: v === 'A' ? '本輪實測' : v === 'B' ? '先前實測（僅供參考）' : v }, v));
        else if (TEXT_COLS[c[0]]) td.textContent = v;
        else td.textContent = fmt(num(v));
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
  }

  function setTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.getElementById('theme-icon').textContent = dark ? '☀' : '☾';
    document.getElementById('theme-label').textContent = dark ? '淺色模式' : '深色模式';
  }
  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  setTheme(stored === 'dark');
  document.getElementById('theme-toggle').addEventListener('click', function () {
    var dark = !document.documentElement.classList.contains('dark');
    setTheme(dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
  });
  document.getElementById('metric').addEventListener('change', renderBars);

  Promise.all([fetch('data/models.csv'), fetch('data/timeline.csv')]).then(function (rs) {
    return Promise.all(rs.map(function (r) { if (!r.ok) throw new Error(r.url + ' ' + r.status); return r.text(); }));
  }).then(function (t) {
    models = parseCSV(t[0]); timeline = parseCSV(t[1]);
    renderKPIs(); renderBars(); renderLines(); renderTable();
  }).catch(function (err) {
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<div class="card">資料載入失敗：' + String(err.message).replace(/</g, '&lt;') + '</div>');
  });
})();
