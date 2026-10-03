'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLUMNS = [
  { key: 'model', label: '模型', numeric: false },
  { key: 'params', label: '參數', numeric: false },
  { key: 'active_params', label: '活躍參數', numeric: false },
  { key: 'evidence', label: '證據等級', numeric: false },
  { key: 'humaneval_pass_pct', label: 'HumanEval 通過率', numeric: true },
  { key: 'tenq_score', label: 'TenQ 分數', numeric: true },
  { key: 'tenq_tokens', label: 'TenQ token 數', numeric: true },
  { key: 'code_review', label: '程式代碼審查', numeric: true },
  { key: 'agent', label: '智能體', numeric: true },
  { key: 'longctx_60k', label: '長上下文 60k', numeric: true },
  { key: 'first_answer_p50_s', label: '首次回答 p50（秒）', numeric: true },
  { key: 'decode_tps', label: '解碼速度（tok/s）', numeric: true },
];

const EVIDENCE_LABEL = {
  A: '本輪實測',
  B: '先前實測（僅供參考）',
};

let models = [];
let timeline = [];
let sortState = { key: null, dir: 0 }; // dir: -1 desc, 1 asc, 0 none
let modelColors = {};
let lineModels = [];

// ---------- utilities ----------

function el(name, attrs, text) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
  }
  if (text != null) node.textContent = text;
  return node;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) pushRow();
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function toObjects(rows) {
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

function fmtValue(key, raw) {
  if (raw === '' || raw == null) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (key === 'humaneval_pass_pct') return trimNum(n) + '%';
  if (key === 'decode_tps') return trimNum(n) + ' tok/s';
  if (key === 'first_answer_p50_s') return trimNum(n) + ' s';
  return trimNum(n);
}

function trimNum(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(2)));
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

function chartWidth(id) {
  const box = document.getElementById(id);
  const w = box ? box.clientWidth : 800;
  return Math.max(280, w);
}

function colorClass(i) { return 'c' + (i % 6); }
function seriesClass(i) { return 's' + (i % 6); }
function modelColorIndex(name) { return modelColors[name] != null ? modelColors[name] : 99; }

// ---------- theme ----------

function setupTheme() {
  const btn = document.getElementById('theme-toggle');
  const apply = () => {
    const dark = document.documentElement.classList.contains('dark');
    btn.textContent = dark ? '日間模式' : '夜間模式';
  };
  btn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    apply();
  });
  apply();
}

// ---------- KPI ----------

function renderKPIs() {
  const grid = document.getElementById('kpi-grid');
  const bestHumaneval = Math.max(...models.map(m => Number(m.humaneval_pass_pct) || 0));
  const bestDecode = Math.max(...models.map(m => Number(m.decode_tps) || 0));
  const humanevalModel = models.find(m => Number(m.humaneval_pass_pct) === bestHumaneval && m.humaneval_pass_pct !== '');
  const decodeModel = models.find(m => Number(m.decode_tps) === bestDecode && m.decode_tps !== '');
  const cards = [
    { kpi: 'humaneval', label: '最高 HumanEval 通過率', value: trimNum(bestHumaneval) + '%', sub: humanevalModel ? humanevalModel.model : '—' },
    { kpi: 'decode', label: '最高解碼速度', value: trimNum(bestDecode) + ' tok/s', sub: decodeModel ? decodeModel.model : '—' },
    { kpi: 'models', label: '評測模型數', value: String(models.length), sub: '本輪 + 先前實測' },
  ];
  grid.innerHTML = '';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.setAttribute('data-kpi', c.kpi);
    const label = document.createElement('div');
    label.className = 'kpi-label';
    label.textContent = c.label;
    const value = document.createElement('div');
    value.className = 'kpi-value';
    value.textContent = c.value;
    const sub = document.createElement('div');
    sub.className = 'kpi-sub';
    sub.textContent = c.sub;
    card.append(label, value, sub);
    grid.appendChild(card);
  }
}

// ---------- bar chart ----------

function barValue(m, metric) {
  const raw = m[metric];
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function renderBarChart() {
  const metric = document.getElementById('metric').value;
  const svg = document.getElementById('bar-chart');
  svg.innerHTML = '';
  const W = chartWidth('bar-chart');
  const rows = models.filter(m => barValue(m, metric) != null);
  const rowH = 52, top = 10, bottom = 34;
  const H = top + rows.length * rowH + bottom;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  const maxVal = Math.max(...rows.map(m => barValue(m, metric)), 0);
  const scale = niceMax(maxVal);
  const labelReserve = 64;
  const x0 = 6;
  const barMaxW = W - x0 - labelReserve;

  // gridlines + x ticks
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const t = scale * i / tickCount;
    const x = x0 + barMaxW * i / tickCount;
    svg.appendChild(el('line', {
      class: 'grid-line',
      x1: x, y1: top - 4, x2: x, y2: top + rows.length * rowH + 4,
    }));
    svg.appendChild(el('text', {
      x: x, y: top + rows.length * rowH + 20, 'text-anchor': 'middle',
    }, trimNum(t)));
  }
  const axisY = top + rows.length * rowH + 6;
  svg.appendChild(el('line', { class: 'axis-line', x1: x0, y1: axisY, x2: x0 + barMaxW, y2: axisY }));

  rows.forEach((m, i) => {
    const y = top + i * rowH;
    const v = barValue(m, metric);
    const bw = Math.max(2, barMaxW * (v / scale));
    const idx = models.indexOf(m);

    const name = el('text', { x: x0, y: y + 16 }, truncate(m.model, 34));
    svg.appendChild(name);

    const bar = el('rect', {
      class: 'bar ' + colorClass(idx),
      'data-model': m.model,
      'data-value': v,
      x: x0,
      y: y + 24,
      width: bw,
      height: 18,
      rx: 4,
    });
    svg.appendChild(bar);

    const valLabel = el('text', {
      x: x0 + barMaxW + 8, y: y + 37, 'text-anchor': 'start',
      fill: 'var(--text)',
    }, fmtValue(metric, v));
    valLabel.style.fontVariantNumeric = 'tabular-nums';
    svg.appendChild(valLabel);
  });
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- line chart ----------

function renderLineChart() {
  const svg = document.getElementById('line-chart');
  svg.innerHTML = '';
  const W = chartWidth('line-chart');
  const H = 300;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  const legend = document.getElementById('line-legend');
  legend.innerHTML = '';
  if (!timeline.length) return;

  lineModels = [...new Set(timeline.map(p => p.model))];
  lineModels.forEach(m => {
    if (modelColors[m] == null) modelColors[m] = models.length + lineModels.indexOf(m);
  });

  for (const m of lineModels) {
    const idx = modelColors[m];
    const item = document.createElement('span');
    item.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = 'legend-swatch ' + colorClass(idx);
    const label = document.createElement('span');
    label.textContent = m;
    item.append(sw, label);
    legend.appendChild(item);
  }

  const ml = 46, mr = 14, mt = 14, mb = 46;
  const iw = W - ml - mr, ih = H - mt - mb;
  const maxX = Math.max(...timeline.map(p => Number(p.minute))) || 1;
  const maxY = niceMax(Math.max(...timeline.map(p => Number(p.decode_tps))));
  const x = t => ml + iw * (t / maxX);
  const y = v => mt + ih * (1 - v / maxY);

  // grid + ticks
  const tTicks = 5;
  for (let i = 0; i <= tTicks; i++) {
    const t = maxX * i / tTicks;
    const tx = x(t);
    svg.appendChild(el('line', { class: 'grid-line', x1: tx, y1: mt, x2: tx, y2: mt + ih }));
    svg.appendChild(el('text', { x: tx, y: mt + ih + 16, 'text-anchor': 'middle' }, trimNum(t)));
  }
  const vTicks = 5;
  for (let i = 0; i <= vTicks; i++) {
    const v = maxY * i / vTicks;
    const vy = y(v);
    svg.appendChild(el('line', { class: 'grid-line', x1: ml, y1: vy, x2: ml + iw, y2: vy }));
    svg.appendChild(el('text', { x: ml - 8, y: vy + 4, 'text-anchor': 'end' }, trimNum(v)));
  }

  // axes
  svg.appendChild(el('line', { class: 'axis-line', x1: ml, y1: mt, x2: ml, y2: mt + ih }));
  svg.appendChild(el('line', { class: 'axis-line', x1: ml, y1: mt + ih, x2: ml + iw, y2: mt + ih }));

  // axis titles
  svg.appendChild(el('text', {
    class: 'axis-title', x: ml + iw / 2, y: H - 8, 'text-anchor': 'middle',
  }, '時間（分鐘）'));
  const yTitle = el('text', {
    class: 'axis-title', x: 14, y: mt + ih / 2, 'text-anchor': 'middle',
    transform: 'rotate(-90 14 ' + (mt + ih / 2) + ')',
  }, 'decode tok/s');
  svg.appendChild(yTitle);

  // series
  for (const m of lineModels) {
    const idx = modelColors[m];
    const pts = timeline
      .filter(p => p.model === m)
      .map(p => [Number(p.minute), Number(p.decode_tps)])
      .sort((a, b) => a[0] - b[0]);
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + x(p[0]).toFixed(2) + ' ' + y(p[1]).toFixed(2)).join(' ');
    svg.appendChild(el('path', { class: 'series ' + seriesClass(idx), 'data-model': m, d }));
    for (const p of pts) {
      const c = el('circle', {
        class: 'point ' + colorClass(idx),
        'data-model': m,
        'data-value': p[1],
        cx: x(p[0]).toFixed(2),
        cy: y(p[1]).toFixed(2),
        r: 3,
      });
      attachTooltip(c, m, p[1]);
      svg.appendChild(c);
    }
  }
}

// ---------- tooltip ----------

function attachTooltip(node, model, value) {
  const tip = document.getElementById('tooltip');
  const show = () => {
    tip.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'tt-model';
    m.textContent = model;
    const v = document.createElement('div');
    v.className = 'tt-value';
    v.textContent = trimNum(value) + ' tok/s';
    tip.append(m, v);
    tip.classList.add('visible');
    tip.setAttribute('aria-hidden', 'false');
  };
  const move = (e) => {
    const pad = 12;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = e.clientX + pad;
    let top = e.clientY - th - pad;
    if (left + tw > window.innerWidth - 4) left = e.clientX - tw - pad;
    if (top < 4) top = e.clientY + pad;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  const hide = () => {
    tip.classList.remove('visible');
    tip.setAttribute('aria-hidden', 'true');
  };
  node.addEventListener('mouseenter', e => { show(); move(e); });
  node.addEventListener('mousemove', move);
  node.addEventListener('mouseleave', hide);
  // touch support
  node.addEventListener('touchstart', e => {
    const t = e.touches[0];
    show();
    move({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: true });
  node.addEventListener('touchend', () => setTimeout(hide, 1500));
}

// ---------- table ----------

function cellDisplay(key, raw) {
  if (key === 'evidence') {
    if (!raw) return '—';
    return (EVIDENCE_LABEL[raw] || raw);
  }
  return fmtValue(key, raw);
}

function renderTableHead() {
  const thead = document.querySelector('#results-table thead');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.setAttribute('data-sort', col.key);
    th.scope = 'col';
    if (col.numeric) th.className = 'num';
    const span = document.createElement('span');
    span.textContent = col.label;
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    th.append(span, arrow);
    th.addEventListener('click', () => onSort(col));
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function onSort(col) {
  if (sortState.key === col.key) {
    sortState.dir = sortState.dir === -1 ? 1 : -1;
  } else {
    sortState.key = col.key;
    sortState.dir = -1; // first click: descending
  }
  renderTableBody();
}

function renderTableBody() {
  const tbody = document.querySelector('#results-table tbody');
  const col = COLUMNS.find(c => c.key === sortState.key);
  const data = models.slice();
  if (col) {
    data.sort((a, b) => {
      const ra = a[col.key] == null ? '' : String(a[col.key]).trim();
      const rb = b[col.key] == null ? '' : String(b[col.key]).trim();
      if (ra === '' && rb === '') return 0;
      if (ra === '') return 1;  // empty last
      if (rb === '') return -1;
      let cmp;
      if (col.numeric) cmp = Number(ra) - Number(rb);
      else cmp = ra.localeCompare(rb, 'zh-Hant', { numeric: true });
      return cmp * sortState.dir;
    });
  }

  // update header indicators
  document.querySelectorAll('#results-table thead th').forEach(th => {
    th.classList.remove('sorted-desc', 'sorted-asc');
    if (th.getAttribute('data-sort') === sortState.key) {
      th.classList.add(sortState.dir === -1 ? 'sorted-desc' : 'sorted-asc');
    }
  });

  tbody.innerHTML = '';
  for (const m of data) {
    const tr = document.createElement('tr');
    for (const colDef of COLUMNS) {
      const raw = m[colDef.key] == null ? '' : String(m[colDef.key]).trim();
      const td = document.createElement('td');
      if (colDef.numeric) td.className = 'num';
      if (raw === '') {
        td.classList.add('empty');
        td.textContent = '—';
      } else if (colDef.key === 'evidence') {
        const badge = document.createElement('span');
        badge.className = 'badge badge-' + raw.toLowerCase();
        badge.textContent = EVIDENCE_LABEL[raw] || raw;
        badge.title = EVIDENCE_LABEL[raw] || raw;
        td.appendChild(badge);
      } else {
        td.textContent = cellDisplay(colDef.key, raw);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---------- chart rendering + resize ----------

function renderCharts() {
  renderBarChart();
  renderLineChart();
}

let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 120);
}

// ---------- init ----------

async function main() {
  setupTheme();
  try {
    const [modelsRes, timelineRes] = await Promise.all([
      fetch('data/models.csv', { cache: 'no-store' }),
      fetch('data/timeline.csv', { cache: 'no-store' }),
    ]);
    if (!modelsRes.ok) throw new Error('models.csv ' + modelsRes.status);
    if (!timelineRes.ok) throw new Error('timeline.csv ' + timelineRes.status);
    models = toObjects(parseCSV(await modelsRes.text()));
    timeline = toObjects(parseCSV(await timelineRes.text()));
    models.forEach((m, i) => { modelColors[m.model] = i % 6; });
  } catch (err) {
    document.querySelector('.container').insertAdjacentHTML('beforeend',
      '<div class="card"><p>無法載入資料檔：' + err.message + '</p></div>');
    return;
  }

  renderKPIs();
  renderTableHead();
  renderTableBody();
  renderCharts();

  document.getElementById('metric').addEventListener('change', renderBarChart);
  window.addEventListener('resize', onResize);
}

document.addEventListener('DOMContentLoaded', main);
