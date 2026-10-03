# Task: benchmark dashboard

Build a single-page dashboard that presents the benchmark results in `data/`. It will be served as static files
from this directory (for example `python3 -m http.server`) and opened in a browser with **no internet access**.

## Data

- `data/models.csv` — one row per model. Columns: `model, params, active_params, evidence, humaneval_pass_pct,
  tenq_score, tenq_tokens, code_review, agent, longctx_60k, first_answer_p50_s, decode_tps`. Empty cells mean
  "not measured" and must be shown as `—`, never as 0.
- `data/timeline.csv` — `model, minute, decode_tps`: decode speed of every long request during one benchmark run,
  per model, in time order.

Load both files at runtime with `fetch`; do not copy the numbers into the code.

## Files

Create `index.html`, `style.css` and `app.js` in this directory. No frameworks, no libraries, no CDN, no external
fonts or images: plain HTML, CSS and JavaScript, charts drawn as inline SVG by your own code.

## What the page must contain (UI text in Traditional Chinese)

1. **Header** with the title `RTX 5070 Ti 本機模型評測` and a theme button `#theme-toggle` that switches between light
   and dark mode by toggling the class `dark` on `<html>`, and remembers the choice in `localStorage` key `theme`.
2. **KPI cards**, each an element with a `data-kpi` attribute whose text contains the value:
   - `data-kpi="humaneval"`: the highest `humaneval_pass_pct`, formatted like `92.1%`
   - `data-kpi="decode"`: the highest `decode_tps`, formatted like `88.5 tok/s`
   - `data-kpi="models"`: the number of models
3. **Bar chart** `<svg id="bar-chart">` comparing models on one metric chosen with `<select id="metric">` whose
   option values are `humaneval_pass_pct`, `tenq_score` and `tenq_tokens`. Draw one `<rect class="bar">` per model
   that has a value for the chosen metric, with attributes `data-model` and `data-value`; bar length must be
   proportional to the value (same scale for all bars, axis starting at 0). Label each bar with its value.
4. **Line chart** `<svg id="line-chart">` of `timeline.csv`: x = minute, y = decode tok/s, one
   `<path class="series" data-model="…">` per model in a distinct colour, a legend, and labelled axes. Draw every
   data point as `<circle class="point" data-model="…" data-value="…">`. Hovering a point shows a tooltip element
   `#tooltip` (visible only while hovering) containing the model name and the tok/s value.
5. **Results table** `<table id="results-table">` with one row per model and a header cell for each column. Header
   cells `th[data-sort="<column name>"]` sort the table by that column when clicked: first click descending,
   second click ascending. Empty cells sort last.
6. An `evidence` column/badge that explains the level: `A` = 本輪實測, `B` = 先前實測（僅供參考）.

## Quality bar

- Looks like a polished product, not a homework page: consistent spacing, a clear visual hierarchy, readable
  colours in both themes, smooth hover states.
- Works at a 375 px wide mobile viewport without horizontal scrolling (charts scale to the container width).
- No errors in the browser console. No network requests other than the two CSV files and the page's own files.

When you are done, briefly list what you built.
