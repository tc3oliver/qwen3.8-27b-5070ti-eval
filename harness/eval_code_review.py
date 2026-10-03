#!/usr/bin/env python3
"""Code review: 10 snippets with exactly one planted bug each (data/code_review.json). The model must name the
bug's line and cause. Graded two ways: line (any accepted bug line, ±1) and line + cause (cause regex).
Usage: python3 harness/eval_code_review.py --out results/x.json [--repeats 3]"""
import argparse, json, os, re, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
p.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
p.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "../data/code_review.json"))
p.add_argument("--max-tokens", type=int, default=16000)
p.add_argument("--repeats", type=int, default=1)
p.add_argument("--out", required=True)
args = p.parse_args()

PROMPT = ("Review this {lang} code. It contains exactly one bug that affects correctness or security. "
          "Reply in exactly this format and nothing else:\nLINE: <line number>\nREASON: <one sentence>\n\n```{lang}\n{code}```")

def numbered(code):
    return "\n".join(f"{i:>3}| {l}" for i, l in enumerate(code.rstrip("\n").split("\n"), 1)) + "\n"

def bug_line_numbers(item):
    lines = item["code"].split("\n")
    nums = [i for i, l in enumerate(lines, 1) if any(b in l for b in item["bug_lines"])]
    assert nums, item["id"]
    return nums

def chat(content):
    body = {"messages": [{"role": "user", "content": content}], "max_tokens": args.max_tokens, "cache_prompt": False}
    req = urllib.request.Request(args.url + "/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=3600) as r:
        return json.load(r), time.time() - t0

items = json.load(open(args.data))
rows = []
for rep in range(args.repeats):
    for it in items:
        expected = bug_line_numbers(it)
        d, sec = chat(PROMPT.format(lang=it["lang"], code=numbered(it["code"])))
        m = d["choices"][0]; text = (m["message"].get("content") or "").strip()
        mline = re.search(r"LINE:\s*(\d+)", text); mreason = re.search(r"REASON:\s*(.+)", text, re.S)
        line = int(mline.group(1)) if mline else None
        reason = mreason.group(1).strip() if mreason else text
        line_ok = line is not None and any(abs(line - e) <= 1 for e in expected)
        cause_ok = bool(re.search(it["cause"], reason, re.I))
        rows.append({"id": it["id"], "repeat": rep + 1, "expected_lines": expected, "line": line, "line_ok": line_ok,
                     "cause_ok": cause_ok, "ok": line_ok and cause_ok, "format_ok": bool(mline and mreason),
                     "finish": m["finish_reason"], "tok": d["usage"]["completion_tokens"], "sec": round(sec, 1), "answer": text})
        r = rows[-1]
        print(f"[{rep+1}] {it['id']:28} line {r['line']} (exp {expected}) line_ok={line_ok} cause_ok={cause_ok} tok={r['tok']} {r['sec']}s", flush=True)

n = len(rows)
summary = {"n": n, "line_ok": sum(r["line_ok"] for r in rows), "line_and_cause_ok": sum(r["ok"] for r in rows),
           "format_ok": sum(r["format_ok"] for r in rows), "repeats": args.repeats,
           "per_repeat_ok": [sum(r["ok"] for r in rows if r["repeat"] == k + 1) for k in range(args.repeats)]}
json.dump({"summary": summary, "results": rows}, open(args.out, "w"), ensure_ascii=False, indent=1)
print(json.dumps(summary))
