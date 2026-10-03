#!/usr/bin/env python3
"""Runs the HumanEval+ checker from harness/eval_humanevalplus.py on every task's canonical solution.
A correct checker must pass all of them. Writes harness/tests/humanevalplus_grader_check.json."""
import gzip, json, os, re, subprocess, sys, tempfile, time
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUNNER = re.search(r"RUNNER = r'''(.*?)'''", open(os.path.join(ROOT, "harness/eval_humanevalplus.py")).read(), re.S).group(1)
tasks = [json.loads(l) for l in gzip.open(os.path.join(ROOT, "data/HumanEvalPlus.jsonl.gz"), "rt")]
bad = []; t0 = time.time()
with tempfile.TemporaryDirectory() as tmp:
    open(f"{tmp}/r.py", "w").write(RUNNER)
    for t in tasks:
        json.dump(t, open(f"{tmp}/t.json", "w")); open(f"{tmp}/c.py", "w").write(t["prompt"] + t["canonical_solution"])
        o = subprocess.run([sys.executable, f"{tmp}/r.py", f"{tmp}/t.json", f"{tmp}/c.py"], capture_output=True, text=True, timeout=120).stdout
        r = json.loads(o.strip().splitlines()[-1]) if o.strip() else {"ok": False, "why": "no output"}
        if not r["ok"]: bad.append({"task": t["task_id"], "why": r["why"]})
res = {"tasks": len(tasks), "canonical_pass": len(tasks) - len(bad), "failures": bad, "seconds": round(time.time() - t0, 1)}
json.dump(res, open(os.path.join(ROOT, "harness/tests/humanevalplus_grader_check.json"), "w"), indent=1); print(res)
