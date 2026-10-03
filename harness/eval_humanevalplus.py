#!/usr/bin/env python3
"""HumanEval+ (evalplus v0.1.10) pass@1 against the local chat server, server-default sampling/thinking.
Expected outputs come from each task's canonical solution on base_input + plus_input; the model's code runs in a
separate subprocess per task with a timeout. Usage:
  python3 tests/eval_humanevalplus.py --out results/x.json [--limit N] [--max-tokens 16000]"""
import argparse, gzip, json, os, re, subprocess, sys, tempfile, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
p.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
p.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "../data/HumanEvalPlus.jsonl.gz"))
p.add_argument("--max-tokens", type=int, default=16000)
p.add_argument("--limit", type=int, default=0)
p.add_argument("--timeout", type=int, default=60, help="seconds per task for running all tests")
p.add_argument("--out", required=True)
args = p.parse_args()

tasks = [json.loads(l) for l in gzip.open(args.data, "rt")]
if args.limit: tasks = tasks[:args.limit]

PROMPT = ("Complete the following Python function. Reply with the complete function (including any imports it needs) "
          "in a single ```python code block.\n\n```python\n{}```")

RUNNER = r'''
import json, math, sys, copy
task = json.load(open(sys.argv[1])); code = open(sys.argv[2]).read()
def load(src):
    ns = {}
    exec(src, ns)
    return ns[task["entry_point"]]
ref = load(task["prompt"] + task["canonical_solution"])
try:
    fn = load(task["prompt"] + "\n" + code)
except BaseException as e:
    print(json.dumps({"ok": False, "why": f"load: {type(e).__name__}: {e}"[:300]})); sys.exit()
atol = task.get("atol") or 0
def same(a, b):
    if isinstance(a, float) or isinstance(b, float):
        try: return math.isclose(a, b, rel_tol=1e-6, abs_tol=max(atol, 1e-6)) or (a != a and b != b)
        except TypeError: return False
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b
inputs = task["base_input"] + task["plus_input"]
for i, inp in enumerate(inputs):
    try: exp = ref(*copy.deepcopy(inp))
    except BaseException: continue          # invalid input for the reference too
    try: got = fn(*copy.deepcopy(inp))
    except BaseException as e:
        print(json.dumps({"ok": False, "why": f"input {i}: {type(e).__name__}: {e}"[:300]})); sys.exit()
    if not same(got, exp):
        print(json.dumps({"ok": False, "why": f"input {i}: got {got!r:.80} expected {exp!r:.80}"})); sys.exit()
print(json.dumps({"ok": True, "n": len(inputs)}))
'''

def chat(content):
    body = {"messages": [{"role": "user", "content": content}], "max_tokens": args.max_tokens}
    req = urllib.request.Request(args.url + "/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=3600) as r:
        d = json.load(r)
    return d, time.time() - t0

def extract(text):
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    return blocks[-1] if blocks else text

results = []
with tempfile.TemporaryDirectory() as tmp:
    runner = os.path.join(tmp, "runner.py"); open(runner, "w").write(RUNNER)
    for i, t in enumerate(tasks):
        try:
            d, sec = chat(PROMPT.format(t["prompt"]))
            m = d["choices"][0]; content = m["message"].get("content") or ""
            tim = d.get("timings", {})
            row = {"task_id": t["task_id"], "finish": m["finish_reason"], "tok": d["usage"]["completion_tokens"],
                   "sec": round(sec, 1), "decode_tps": tim.get("predicted_per_second"),
                   "draft_n": tim.get("draft_n"), "draft_acc": tim.get("draft_n_accepted")}
        except Exception as e:
            results.append({"task_id": t["task_id"], "ok": False, "why": f"server: {e}"}); print(results[-1], flush=True); continue
        if not content.strip():
            row.update(ok=False, why=f"empty content (finish={row['finish']})")
        else:
            tf = os.path.join(tmp, "task.json"); cf = os.path.join(tmp, "code.py")
            json.dump(t, open(tf, "w")); open(cf, "w").write(extract(content))
            try:
                out = subprocess.run([sys.executable, runner, tf, cf], capture_output=True, text=True, timeout=args.timeout, cwd=tmp)
                res = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {"ok": False, "why": "no output: " + out.stderr[-200:]}
            except subprocess.TimeoutExpired:
                res = {"ok": False, "why": "timeout"}
            row.update(res)
        row["code"] = extract(content)
        results.append(row)
        n_ok = sum(r.get("ok") for r in results)
        print(f"[{i+1}/{len(tasks)}] {t['task_id']:16} {'PASS' if row.get('ok') else 'FAIL'} tok={row.get('tok')} {row.get('sec')}s  "
              f"running {n_ok}/{len(results)}  {'' if row.get('ok') else row.get('why','')[:90]}", flush=True)

ok = sum(r.get("ok", False) for r in results)
summary = {"n": len(results), "pass": ok, "pass_at_1": ok / len(results),
           "empty_or_truncated": sum(1 for r in results if r.get("finish") == "length"),
           "median_tok": sorted(r.get("tok", 0) for r in results)[len(results) // 2],
           "total_sec": round(sum(r.get("sec", 0) for r in results), 1)}
json.dump({"summary": summary, "results": results}, open(args.out, "w"), ensure_ascii=False, indent=1)
print(json.dumps(summary))
