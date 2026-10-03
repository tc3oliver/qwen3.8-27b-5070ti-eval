#!/usr/bin/env python3
"""Runs the whole comparison: for each model config, pick the first candidate setting that loads without VRAM
spill (PROTOCOL.md), freeze it, run every suite, and move on. Resumable: frozen settings and finished suites are
skipped on re-run. Stops the production chat service for the duration and restarts it at the end.
Usage: python3 harness/run_arena.py [config ...] [--run arena-2026-10] [--only-size]"""
import argparse, glob, json, os, shlex, shutil, signal, subprocess, sys, threading, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIGS = os.path.join(ROOT, "configs")
ORDER = ["qwen38-27b-iq3s", "qwen38-27b-official-iq3s", "qwen38-27b-unsloth-q3kxl", "ornith-1.5-35b-a3b-apex",
         "muse-glimmer-30b-q2kxl", "ornith-1.5-9b-q6k"]
BINS = {"recipe": "/home/oliver/llama-api/src/llama.cpp-qwen38-v3/build/bin/llama-server",
        "stock": "/home/oliver/llama-api/src/llama.cpp-stock/build/bin/llama-server"}
RECIPE = "/home/oliver/llama-api/src/recipes-qwen3.8-27b-5070ti"
PORT, KEY = 8090, "eval-key"
URL = f"http://127.0.0.1:{PORT}"
SPILL_LIMIT_MIB = 300
PROD_SERVICE = "llm-chat.service"

p = argparse.ArgumentParser()
p.add_argument("configs", nargs="*", default=ORDER)
p.add_argument("--run", default="arena-2026-10")
p.add_argument("--only-size", action="store_true", help="choose and freeze settings, skip the suites")
p.add_argument("--keep-prod-down", action="store_true")
p.add_argument("--quick", action="store_true", help="time-boxed run: 1 repeat of 10Q and code review, 12 agent episodes, 10 latency prompts; full HumanEval+")
args = p.parse_args()

LOG = open(os.path.join(ROOT, "results", f"{args.run}.log"), "a", buffering=1)
def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True); LOG.write(line + "\n")

def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)

def wsl_gpu_mib():
    """(dedicated, shared) GPU memory of the WSL VM from Windows perf counters."""
    ps = ('$p=(Get-Process vmwp).Id; foreach($c in "Dedicated","Shared"){ ((Get-Counter "\\GPU Process Memory(*)\\$c Usage")'
          '.CounterSamples | ?{$_.InstanceName -match "pid_($($p -join "|"))_"} | Measure-Object CookedValue -Sum).Sum/1MB }')
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps], capture_output=True, text=True, cwd="/mnt/c").stdout
    vals = [float(x) for x in out.replace("\r", "").split()]
    return vals[0], vals[1]

def req(path, body=None, timeout=600):
    r = urllib.request.Request(URL + path, None if body is None else json.dumps(body).encode(),
                               {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(r, timeout=timeout) as f:
        return json.load(f)

def load_config(name):
    d = os.path.join(CONFIGS, name)
    env = dict(os.environ, CONFIG_DIR=d, CONFIGS=CONFIGS, RECIPE=RECIPE)
    out = subprocess.run(["bash", "-c", "set -a; source config.env; env -0"], cwd=d, env=env, capture_output=True, text=True).stdout
    cfg = dict(kv.split("=", 1) for kv in out.split("\0") if "=" in kv)
    for k in ("ARGS", "SPEC_ARGS"):
        cfg[k] = shlex.split(os.path.expandvars(cfg.get(k, "").replace("$CONFIG_DIR", d).replace("$CONFIGS", CONFIGS).replace("$RECIPE", RECIPE)))
    return cfg

def command(name, cfg, cand):
    ctx, kv, ncmoe, ngl, spec = cand.split(":")
    cmd = [BINS[cfg["BUILD"]], "--model", cfg["MODEL"], "--alias", name, "--host", "127.0.0.1", "--port", str(PORT),
           "--api-key", KEY, "--ctx-size", ctx, "--n-gpu-layers", ngl, "--fit", "off", "--flash-attn", "on",
           "--cache-type-k", kv, "--cache-type-v", kv, "--parallel", "1", "--threads", "8", "--threads-batch", "8",
           "--cache-ram", "0", "--no-context-shift", "--jinja", "--metrics", "--slots"]
    if ncmoe != "0": cmd += ["--n-cpu-moe", ncmoe]
    cmd += cfg["ARGS"] + (cfg["SPEC_ARGS"] if spec == "1" else [])
    return cmd

class Server:
    def __init__(self, name, cfg, cand, logpath):
        self.cmd = command(name, cfg, cand)
        env = dict(os.environ, LD_LIBRARY_PATH="/usr/local/cuda-13.1/lib64:" + os.path.dirname(self.cmd[0]))
        env.pop("GGML_CUDA_ENABLE_UNIFIED_MEMORY", None)
        self.logf = open(logpath, "w")
        self.proc = subprocess.Popen(self.cmd, stdout=self.logf, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    def wait_ready(self, timeout=420):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None: return False
            try:
                if req("/health", timeout=5).get("status") == "ok": return True
            except Exception: pass
            time.sleep(3)
        return False
    def stop(self):
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGINT)
            try: self.proc.wait(30)
            except subprocess.TimeoutExpired: os.killpg(self.proc.pid, signal.SIGKILL); self.proc.wait()
        self.logf.close(); time.sleep(5)

def sanity():
    """Short raw completion for decode speed, then a chat turn to confirm the template/reasoning path works."""
    c = req("/completion", {"prompt": "The history of the printing press began", "n_predict": 128, "cache_prompt": False})
    ch = req("/v1/chat/completions", {"messages": [{"role": "user", "content": "用一句話介紹台北。"}], "max_tokens": 4000})
    m = ch["choices"][0]["message"]
    return {"raw_decode_tps": c["timings"]["predicted_per_second"], "chat_answer": (m.get("content") or "")[:200],
            "chat_reasoning_chars": len(m.get("reasoning_content") or ""), "chat_finish": ch["choices"][0]["finish_reason"]}

def size(name, cfg, outdir, baseline_shared):
    frozen = os.path.join(outdir, "frozen.json")
    if os.path.exists(frozen):
        return json.load(open(frozen))
    tried = []
    bad = json.load(open(os.path.join(outdir, "invalid-candidates.json"))) if os.path.exists(os.path.join(outdir, "invalid-candidates.json")) else []
    for cand in [c for c in cfg["CANDIDATES"].split() if c not in bad]:
        log(f"[{name}] try {cand}")
        s = Server(name, cfg, cand, os.path.join(outdir, f"sizing-{cand.replace(':', '_')}.log"))
        row = {"candidate": cand}
        try:
            if not s.wait_ready():
                row["result"] = "failed to load"; continue
            ded, sha = wsl_gpu_mib(); row["spill_mib_after_load"] = round(sha - baseline_shared)
            if row["spill_mib_after_load"] > SPILL_LIMIT_MIB:
                row["result"] = "spill"; continue
            row.update(sanity())
            ded, sha = wsl_gpu_mib(); row["spill_mib_after_sanity"] = round(sha - baseline_shared); row["wsl_dedicated_mib"] = round(ded)
            if row["spill_mib_after_sanity"] > SPILL_LIMIT_MIB or not row["chat_answer"]:
                row["result"] = "spill" if row["spill_mib_after_sanity"] > SPILL_LIMIT_MIB else "empty chat answer"; continue
            row["result"] = "chosen"
            doc = {"config": name, "candidate": cand, "command": s.cmd, "source": cfg.get("SOURCE"), "check": row,
                   "baseline_shared_mib": round(baseline_shared), "tried": tried + [row], "frozen_at": time.strftime("%Y-%m-%d %H:%M:%S")}
            json.dump(doc, open(frozen, "w"), ensure_ascii=False, indent=1)
            return doc
        except Exception as e:
            row["result"] = f"error: {e}"
        finally:
            tried.append(row); log(f"[{name}] {cand}: {json.dumps(row, ensure_ascii=False)[:300]}"); s.stop()
    json.dump({"config": name, "tried": tried, "result": "no candidate fits"}, open(os.path.join(outdir, "sizing-failed.json"), "w"), indent=1)
    return None

def suites(outdir):
    py, H = sys.executable, os.path.join(ROOT, "harness")
    common = ["--url", URL, "--key", KEY]
    q = args.quick
    s = [("latency", [py, f"{H}/eval_latency_zh.py", *common, *(["--limit", "10"] if q else []), "--out", f"{outdir}/latency.json"]),
         ("agent", [py, f"{H}/eval_agent_tools.py", *common, "--repeats", "2" if q else "5", "--out", f"{outdir}/agent.json"]),
         ("code_review", [py, f"{H}/eval_code_review.py", *common, "--repeats", "1" if q else "3", "--out", f"{outdir}/code_review.json"]),
         ("longctx", [py, f"{H}/eval_longctx_zh.py", *common, "--out", f"{outdir}/longctx.json"])]
    for r in ((1,) if q else (1, 2, 3)):
        s += [(f"10q_A_r{r}", [py, f"{H}/eval_10q.py", "--base", URL, "--key", KEY, "--max-tokens", "16000", "--out", f"{outdir}/10q_A_r{r}.json"]),
              (f"10q_B_r{r}", [py, f"{H}/eval_10q_b.py", "--base", URL, "--key", KEY, "--max-tokens", "16000", "--out", f"{outdir}/10q_B_r{r}.json"])]
    s += [("humanevalplus", [py, f"{H}/eval_humanevalplus.py", *common, "--out", f"{outdir}/humanevalplus.json"])]
    return s

class SpillMonitor(threading.Thread):
    """Samples the WSL VM's shared GPU memory every 60 s; two consecutive samples over the limit trip it."""
    def __init__(self, baseline):
        super().__init__(daemon=True); self.baseline = baseline; self.trace = []; self.tripped = threading.Event(); self.stop_ev = threading.Event()
    def run(self):
        over = 0
        while not self.stop_ev.wait(60):
            try: ded, sha = wsl_gpu_mib()
            except Exception: continue
            spill = round(sha - self.baseline); self.trace.append({"t": time.strftime("%H:%M:%S"), "spill_mib": spill, "dedicated_mib": round(ded)})
            over = over + 1 if spill > SPILL_LIMIT_MIB else 0
            if over >= 2: self.tripped.set(); return

def run_suites(name, cfg, fz, outdir, baseline):
    """Runs the missing suites. Returns False if the spill monitor tripped (outputs archived, candidate marked bad)."""
    todo = [(n, c) for n, c in suites(outdir) if not os.path.exists(c[-1])]
    if not todo: log(f"[{name}] all suites done"); return True
    srv = Server(name, cfg, fz["candidate"], os.path.join(outdir, "server.log"))
    mon = SpillMonitor(baseline)
    try:
        if not srv.wait_ready(): log(f"[{name}] frozen setting failed to load now"); return True
        mon.start()
        for suite, cmd in todo:
            t0 = time.time()
            logpath = os.path.join(outdir, f"{suite}.stdout.log")
            with open(logpath, "w") as lf:           # a file, not a pipe: long outputs cannot block the child
                proc = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, text=True)
                while proc.poll() is None and not mon.tripped.is_set(): time.sleep(2)
                if mon.tripped.is_set():
                    proc.kill(); proc.wait(); log(f"[{name}] spill over {SPILL_LIMIT_MIB} MiB twice during {suite}: run invalid"); break
            out = open(logpath).read()
            last = (out.strip().splitlines() or [""])[-1]
            log(f"[{name}] {suite} exit {proc.returncode} {time.time()-t0:.0f}s {last[:240]}")
        ded, sha = wsl_gpu_mib()
        json.dump({"spill_mib_end": round(sha - baseline), "wsl_dedicated_mib_end": round(ded), "trace": mon.trace},
                  open(os.path.join(outdir, "spill_end.json"), "w"), indent=1)
        log(f"[{name}] spill at end {sha - baseline:.0f} MiB")
    finally:
        mon.stop_ev.set(); srv.stop()
    if not mon.tripped.is_set(): return True
    n = len(glob.glob(os.path.join(outdir, "invalid-spill-*"))) + 1; inv = os.path.join(outdir, f"invalid-spill-{n}"); os.makedirs(inv)
    for f in os.listdir(outdir):
        if f.startswith(("invalid-", "sizing-")): continue
        shutil.move(os.path.join(outdir, f), inv)
    badf = os.path.join(outdir, "invalid-candidates.json")
    bad = json.load(open(badf)) if os.path.exists(badf) else []
    json.dump(bad + [fz["candidate"]], open(badf, "w"))
    return False

def main():
    log("== arena run", args.run, "configs:", " ".join(args.configs))
    sh(f"sudo systemctl stop {PROD_SERVICE}"); time.sleep(8)
    if sh("pgrep -x llama-server").stdout.strip():
        log("another llama-server is running; stop it first"); return
    _, baseline = wsl_gpu_mib(); log(f"baseline WSL shared GPU memory {baseline:.0f} MiB")
    try:
        for name in args.configs:
            cfg = load_config(name)
            outdir = os.path.join(ROOT, "results", name, args.run); os.makedirs(outdir, exist_ok=True)
            fz = size(name, cfg, outdir, baseline)
            if not fz: log(f"[{name}] no candidate fits — skipped"); continue
            log(f"[{name}] frozen {fz['candidate']} spill {fz['check']['spill_mib_after_sanity']} MiB decode {fz['check']['raw_decode_tps']:.1f} tok/s")
            if args.only_size: continue
            for attempt in range(3):
                if attempt:
                    fz = size(name, cfg, outdir, baseline)
                    if not fz: log(f"[{name}] no candidate left after spill"); break
                    log(f"[{name}] retry with {fz['candidate']}")
                if run_suites(name, cfg, fz, outdir, baseline): break
    finally:
        if not args.keep_prod_down:
            sh(f"sudo systemctl start {PROD_SERVICE}"); log("production service restarted")

main()
