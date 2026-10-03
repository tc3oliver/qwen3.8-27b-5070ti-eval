#!/usr/bin/env python3
"""Runs the Pi coding agent (tools/pi, offline, isolated config) on one task directory against a local
OpenAI-compatible server, records the event stream and usage, then runs the task's hidden grader.
Usage: tools/venv/bin/python harness/eval_pi_task.py --task dashboard --model-id qwen38-27b-iq3s --out results/<m>/<run>/pi-dashboard"""
import argparse, collections, json, os, shutil, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PI = os.path.join(ROOT, "tools/pi/node_modules/.bin/pi")
GRADERS = {"dashboard": "harness/grade_dashboard.py"}

ap = argparse.ArgumentParser()
ap.add_argument("--task", default="dashboard")
ap.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
ap.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
ap.add_argument("--model-id", required=True, help="the server's --alias")
ap.add_argument("--timeout", type=int, default=1800)
ap.add_argument("--out", required=True)
args = ap.parse_args()

out = os.path.abspath(args.out)
work, agent_dir = os.path.join(out, "work"), os.path.join(out, "pi-agent")
if os.path.exists(out): shutil.rmtree(out)
shutil.copytree(os.path.join(ROOT, "data/agent_tasks", args.task), work)
os.makedirs(agent_dir)

def get(path):
    r = urllib.request.Request(args.url + path, headers={"Authorization": f"Bearer {args.key}"})
    return json.load(urllib.request.urlopen(r, timeout=30))
n_ctx = get("/props")["default_generation_settings"]["n_ctx"]
json.dump({"providers": {"local": {"baseUrl": args.url + "/v1", "api": "openai-completions", "apiKey": args.key,
           # server-side defaults decide sampling and reasoning effort, the same as in every other suite
           "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False},
           "models": [{"id": args.model_id, "reasoning": True, "contextWindow": n_ctx, "maxTokens": 16000}]}}},
          open(os.path.join(agent_dir, "models.json"), "w"), indent=1)
json.dump({"enableInstallTelemetry": False}, open(os.path.join(agent_dir, "settings.json"), "w"))

env = dict(os.environ, PI_OFFLINE="1", PI_TELEMETRY="0", PI_CODING_AGENT_DIR=agent_dir)
cmd = [PI, "--mode", "json", "--no-session", "--no-context-files", "--provider", "local", "--model", args.model_id,
       "-p", "Read TASK.md in the current directory and complete the task it describes."]
t0 = time.time()
with open(os.path.join(out, "events.jsonl"), "w") as ev, open(os.path.join(out, "pi.stderr"), "w") as er:
    try:
        rc = subprocess.run(cmd, cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=ev, stderr=er, timeout=args.timeout).returncode
    except subprocess.TimeoutExpired:
        rc = "timeout"
wall = time.time() - t0

events = [json.loads(l) for l in open(os.path.join(out, "events.jsonl")) if l.strip()]
tools = collections.Counter(e["toolName"] for e in events if e["type"] == "tool_execution_start")
tool_errors = sum(1 for e in events if e["type"] == "tool_execution_end" and e.get("isError"))
usage = collections.Counter(); turns = 0; last_text = ""
for e in events:
    if e["type"] == "message_end" and e["message"].get("role") == "assistant":
        turns += 1
        for k in ("input", "output", "cacheRead"): usage[k] += (e["message"].get("usage") or {}).get(k, 0)
        last_text = "".join(b.get("text", "") for b in e["message"].get("content", []) if b.get("type") == "text") or last_text
summary = {"task": args.task, "model": args.model_id, "exit": rc, "wall_s": round(wall, 1), "assistant_turns": turns,
           "tool_calls": dict(tools), "tool_errors": tool_errors, "tokens": dict(usage),
           "output_tps_wall": round(usage["output"] / wall, 1) if wall else None,
           "compactions": sum(1 for e in events if e["type"] == "compaction_start"),
           "retries": sum(1 for e in events if e["type"] == "auto_retry_start"),
           "files": sorted(os.listdir(work)), "final_message": last_text[-1500:]}

g = subprocess.run([os.path.join(ROOT, "tools/venv/bin/python"), os.path.join(ROOT, GRADERS[args.task]), work, os.path.join(out, "grade")],
                   capture_output=True, text=True)
open(os.path.join(out, "grade.log"), "w").write(g.stdout + g.stderr)
grade = json.load(open(os.path.join(out, "grade/grade.json"))) if os.path.exists(os.path.join(out, "grade/grade.json")) else None
summary["grade"] = {"passed": grade["passed"], "total": grade["total"]} if grade else {"error": g.stderr[-500:]}
json.dump(summary, open(os.path.join(out, "summary.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != "final_message"}, ensure_ascii=False))
