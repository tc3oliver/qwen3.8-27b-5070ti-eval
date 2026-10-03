#!/usr/bin/env python3
"""Hidden checks for the dashboard task (data/agent_tasks/dashboard/TASK.md). Serves the agent's work directory,
opens it in headless Chromium with all non-local requests blocked, runs every check, and saves screenshots.
Usage: tools/venv/bin/python harness/grade_dashboard.py <workdir> <outdir>"""
import csv, json, os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

work, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
models = list(csv.DictReader(open(os.path.join(work, "data/models.csv"))))
timeline = list(csv.DictReader(open(os.path.join(work, "data/timeline.csv"))))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

port = free_port()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=work,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
base = f"http://127.0.0.1:{port}/"
checks, console_errors, blocked = [], [], []

def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, f"{type(e).__name__}: {e}"[:200]
    checks.append({"check": name, "ok": bool(ok), "detail": detail})

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        def route(r):
            if r.request.url.startswith(base): r.continue_()
            else: blocked.append(r.request.url); r.abort()
        ctx.route("**/*", route)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        page.goto(base + "index.html", wait_until="networkidle"); page.wait_for_timeout(800)

        check("files exist", lambda: (all(os.path.exists(os.path.join(work, f)) for f in ("index.html", "style.css", "app.js")), "index.html, style.css, app.js"))
        check("title text", lambda: ("RTX 5070 Ti 本機模型評測" in page.inner_text("body"), "header title present"))

        def kpi(key, want):
            t = page.inner_text(f"[data-kpi='{key}']"); return (want in t.replace(" ", "") , f"{t!r} should contain {want!r}")
        hv = max(float(m["humaneval_pass_pct"]) for m in models if m["humaneval_pass_pct"])
        dv = max(float(m["decode_tps"]) for m in models if m["decode_tps"])
        check("kpi humaneval", lambda: kpi("humaneval", f"{hv:.1f}%"))
        check("kpi decode", lambda: kpi("decode", f"{dv:.1f}tok/s"))
        check("kpi models", lambda: kpi("models", str(len(models))))

        def bars(metric):
            page.select_option("#metric", metric); page.wait_for_timeout(300)
            rects = page.query_selector_all("#bar-chart rect.bar")
            want = {m["model"]: float(m[metric]) for m in models if m[metric]}
            got = {r.get_attribute("data-model"): (float(r.get_attribute("data-value")), r.bounding_box()) for r in rects}
            if set(got) != set(want): return False, f"bars {sorted(got)} vs models with data {sorted(want)}"
            if any(abs(got[k][0] - want[k]) > 1e-6 for k in want): return False, "data-value mismatch"
            lens = {k: max(b["width"], b["height"]) for k, (_, b) in got.items()}
            ks = list(want); ref = ks[0]
            for k in ks[1:]:
                if want[ref] and abs(lens[k] / lens[ref] - want[k] / want[ref]) > 0.03:
                    return False, f"length ratio {lens[k]/lens[ref]:.3f} vs value ratio {want[k]/want[ref]:.3f}"
            return True, f"{len(rects)} bars, proportional"
        for metric in ("humaneval_pass_pct", "tenq_score", "tenq_tokens"):
            check(f"bar chart {metric}", lambda m=metric: bars(m))

        def lines():
            names = {r["model"] for r in timeline}
            paths = {e.get_attribute("data-model") for e in page.query_selector_all("#line-chart path.series")}
            pts = page.query_selector_all("#line-chart circle.point")
            if paths != names: return False, f"series {sorted(paths)} vs {sorted(names)}"
            if len(pts) != len(timeline): return False, f"{len(pts)} points vs {len(timeline)} rows"
            colours = {page.eval_on_selector(f"#line-chart path.series[data-model='{n}']", "e => getComputedStyle(e).stroke") for n in names}
            return len(colours) == len(names), f"{len(paths)} series, {len(pts)} points, colours {colours}"
        check("line chart series and points", lines)

        def tooltip():
            pt = page.query_selector_all("#line-chart circle.point")[len(timeline) // 3]
            hidden_before = not page.is_visible("#tooltip")
            pt.scroll_into_view_if_needed(); pt.hover(force=True); page.wait_for_timeout(300)
            vis = page.is_visible("#tooltip"); txt = page.inner_text("#tooltip") if vis else ""
            ok = hidden_before and vis and pt.get_attribute("data-value") in txt.replace(",", "") and pt.get_attribute("data-model") in txt
            page.screenshot(path=os.path.join(out, "tooltip.png")); page.mouse.move(0, 0); page.wait_for_timeout(200)
            return ok and not page.is_visible("#tooltip"), f"hidden before={hidden_before} visible on hover={vis} text={txt[:60]!r}"
        check("tooltip on hover", tooltip)

        def sorting():
            col = "tenq_tokens"
            def order(): return [float(c.inner_text().replace(",", "")) for c in page.query_selector_all(f"#results-table tbody tr td:nth-child({idx})") if c.inner_text().strip() not in ("—", "")]
            heads = page.query_selector_all("#results-table th")
            idx = [h.get_attribute("data-sort") for h in heads].index(col) + 1
            page.click(f"#results-table th[data-sort='{col}']"); page.wait_for_timeout(200); d = order()
            page.click(f"#results-table th[data-sort='{col}']"); page.wait_for_timeout(200); a = order()
            return d == sorted(d, reverse=True) and a == sorted(a) and len(d) == len(models), f"desc {d} asc {a}"
        check("table sort", sorting)
        check("table rows", lambda: (len(page.query_selector_all("#results-table tbody tr")) == len(models), "one row per model"))
        check("empty cells shown as —", lambda: ("—" in page.inner_text("#results-table"), "missing values rendered as —"))
        def no_clipping():
            over = page.evaluate("""() => [...document.querySelectorAll('table, svg')].filter(e => {
                const p = e.parentElement; return p && e.scrollWidth > p.clientWidth + 1 && getComputedStyle(p).overflowX !== 'auto' && getComputedStyle(p).overflowX !== 'scroll';
            }).map(e => e.id || e.tagName)""")
            return not over, f"clipped without scroll: {over}"
        check("desktop: tables/charts not clipped", no_clipping)
        check("evidence labels", lambda: ("本輪實測" in page.inner_text("body") and "先前實測" in page.inner_text("body"), "A/B explained"))

        page.evaluate("window.scrollTo(0, 0)"); page.wait_for_timeout(200)   # sticky headers render where the page was scrolled
        page.screenshot(path=os.path.join(out, "desktop-light.png"), full_page=True)
        def theme():
            page.click("#theme-toggle"); page.wait_for_timeout(300)
            dark = page.evaluate("document.documentElement.classList.contains('dark')")
            stored = page.evaluate("localStorage.getItem('theme')")
            page.evaluate("window.scrollTo(0, 0)"); page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(out, "desktop-dark.png"), full_page=True)
            page.reload(wait_until="networkidle"); page.wait_for_timeout(500)
            kept = page.evaluate("document.documentElement.classList.contains('dark')")
            return dark and kept and stored is not None, f"dark={dark} stored={stored!r} kept after reload={kept}"
        check("dark mode + persistence", theme)

        mob = browser.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2)
        mob.route("**/*", route)
        mp = mob.new_page(); mp.on("pageerror", lambda e: console_errors.append(str(e)))
        mp.goto(base + "index.html", wait_until="networkidle"); mp.wait_for_timeout(800)
        sw = mp.evaluate("document.documentElement.scrollWidth")
        mp.screenshot(path=os.path.join(out, "mobile.png"), full_page=True)
        check("mobile 375px no horizontal scroll", lambda: (sw <= 376, f"scrollWidth={sw}"))
        check("no console errors", lambda: (not console_errors, "; ".join(console_errors)[:200]))
        check("no external requests", lambda: (not blocked, ", ".join(blocked)[:200]))
        browser.close()
finally:
    srv.terminate()

passed = sum(c["ok"] for c in checks)
json.dump({"passed": passed, "total": len(checks), "checks": checks}, open(os.path.join(out, "grade.json"), "w"), ensure_ascii=False, indent=1)
for c in checks: print(f"{'PASS' if c['ok'] else 'FAIL'}  {c['check']:36} {c['detail']}")
print(f"score {passed}/{len(checks)}")
