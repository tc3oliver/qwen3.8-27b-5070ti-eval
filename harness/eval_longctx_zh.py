#!/usr/bin/env python3
"""Needle recall in long Traditional-Chinese documents against the local chat server (server-default sampling).
4 fictional facts are planted at 10/40/70/95 % token depth in filler prose (data/zh_filler_paragraphs.json, cycled with
a per-pass seeded shuffle); the 4 questions are asked together at the end. Usage:
  python3 harness/eval_longctx_zh.py --out results/x.json [--sizes 16000,32000,60000] [--repeats 1]
  python3 harness/eval_longctx_zh.py --build-only --sizes 16000 --out /dev/null    # print needle placement, no generation"""
import argparse, json, os, random, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
p.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
p.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "../data/zh_filler_paragraphs.json"))
p.add_argument("--sizes", default="16000,32000,60000", help="target prompt tokens, comma separated")
p.add_argument("--repeats", type=int, default=1)
p.add_argument("--max-tokens", type=int, default=16000)
p.add_argument("--seed", type=int, default=20261003)
p.add_argument("--build-only", action="store_true", help="build documents and print needle placement only")
p.add_argument("--out", required=True)
args = p.parse_args()

HDR = {"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"}
# (depth, needle sentence, key substrings accepted, question)
NEEDLES = [
    (0.10, "專案代號『青嵐』的年度預算是 3,870 萬元。", ["3870"], "專案代號『青嵐』的年度預算是多少？"),
    (0.40, "倉庫 B7 的備用鑰匙由林佩珊保管。", ["林佩珊"], "倉庫 B7 的備用鑰匙由誰保管？"),
    (0.70, "伺服器 kestrel-09 的維護窗口是每週四凌晨 2:15。", ["2:15"], "伺服器 kestrel-09 的維護窗口是什麼時候？"),
    (0.95, "供應商『曜石光電』的合約編號是 HX-55210。", ["HX-55210"], "供應商『曜石光電』的合約編號是什麼？"),
]
INTRO = "以下是一份內部技術筆記的彙整文件，請仔細閱讀。文件中散落著幾項特定事實。\n\n=== 文件開始 ===\n\n"
OUTRO = "\n\n=== 文件結束 ===\n\n請只根據上面的文件回答下列四個問題，以編號清單（1. 2. 3. 4.）逐題作答，每題簡短回答：\n" + \
        "\n".join(f"{i+1}. {q[3]}" for i, q in enumerate(NEEDLES))

def post(path, body, stream=False):
    req = urllib.request.Request(args.url + path, json.dumps(body).encode(), HDR)
    return urllib.request.urlopen(req, timeout=3600)

def ntok(text):
    with post("/tokenize", {"content": text}) as r:
        return len(json.load(r)["tokens"])

paras = json.load(open(args.data))
ptoks = [ntok(x + "\n\n") for x in paras]       # approx additive; the full document is re-measured below

def filler(n_tokens):
    """Paragraphs (cycling, reshuffled each pass) until >= n_tokens; returns [(para, tokens)]."""
    out, total, k = [], 0, 0
    while total < n_tokens:
        order = list(range(len(paras))); random.Random(args.seed + k).shuffle(order); k += 1
        for i in order:
            out.append((paras[i], ptoks[i])); total += ptoks[i]
            if total >= n_tokens: break
    return out

def assemble(body_tokens):
    fp = filler(body_tokens)
    total = sum(t for _, t in fp)
    items, cum, ni = [], 0, 0
    for para, t in fp:
        while ni < len(NEEDLES) and cum >= NEEDLES[ni][0] * total:
            items.append(NEEDLES[ni][1]); ni += 1
        items.append(para); cum += t
    while ni < len(NEEDLES):                       # depth 0.95 may land past the last paragraph boundary
        items.append(NEEDLES[ni][1]); ni += 1
    return INTRO + "\n\n".join(items) + OUTRO, items

def build(target):
    body = target - ntok(INTRO + OUTRO)
    for _ in range(5):
        text, items = assemble(body)
        n = ntok(text)
        if abs(n - target) <= 0.01 * target: break
        body = int(body * target / n)
    # measured needle depth: tokens before the needle / tokens before the end marker
    start = ntok(INTRO); end = n - ntok(OUTRO)
    pos = []
    for need in NEEDLES:
        before = text[:text.index(need[1])]
        pos.append(round((ntok(before) - start) / (end - start), 3))
    return text, n, pos

def stream_chat(content, max_tokens):
    body = {"messages": [{"role": "user", "content": content}], "max_tokens": max_tokens, "cache_prompt": False,
            "stream": True, "stream_options": {"include_usage": True}}
    t0 = time.time(); ttft = None; reasoning = []; answer = []; finish = None; usage = {}; timings = {}
    with post("/v1/chat/completions", body) as r:
        for line in r:
            line = line.decode().strip()
            if not line.startswith("data:") or line.endswith("[DONE]"): continue
            d = json.loads(line[5:])
            if d.get("usage"): usage = d["usage"]
            if d.get("timings"): timings = d["timings"]
            for c in d.get("choices", []):
                dl = c.get("delta", {})
                if dl.get("reasoning_content") or dl.get("content"):
                    if ttft is None: ttft = time.time() - t0
                    (answer if dl.get("content") else reasoning).append(dl.get("reasoning_content") or dl["content"])
                if c.get("finish_reason"): finish = c["finish_reason"]
    return {"ttft": ttft, "total": time.time() - t0, "reasoning": "".join(reasoning), "content": "".join(answer),
            "finish": finish, "usage": usage, "timings": timings}

def grade(content):
    norm = content.replace(",", "").replace("：", ":")
    return [any(k.lower() in norm.lower() for k in n[2]) for n in NEEDLES]

with urllib.request.urlopen(urllib.request.Request(args.url + "/props", headers=HDR)) as r:
    n_ctx = json.load(r)["default_generation_settings"]["n_ctx"]
print(f"server n_ctx={n_ctx}", flush=True)

results = []
for size in [int(s) for s in args.sizes.split(",")]:
    text, n, pos = build(size)
    print(f"size {size}: document {n} tokens ({(n-size)/size:+.1%}); needle depth (token position) = {pos}", flush=True)
    if args.build_only: continue
    mt = args.max_tokens; note = None
    if n + 100 + mt > n_ctx:                       # ~100 tokens of chat template/system overhead
        if n + 100 + 4000 <= n_ctx:
            mt = n_ctx - n - 100 - 256; note = f"max_tokens lowered to {mt} (n_ctx {n_ctx})"
        else:
            results.append({"size": size, "status": "n/a (exceeds n_ctx)", "doc_tokens": n}); print(results[-1], flush=True); continue
    for rep in range(args.repeats):
        try:
            r = stream_chat(text, mt)
        except Exception as e:
            results.append({"size": size, "repeat": rep, "status": f"server error: {e}"}); print(results[-1], flush=True); continue
        hits = grade(r["content"]); tim = r["timings"]
        row = {"size": size, "repeat": rep, "status": "ok", "doc_tokens": n, "needle_depth": pos, "max_tokens": mt, "note": note,
               "prompt_tokens": r["usage"].get("prompt_tokens"), "completion_tokens": r["usage"].get("completion_tokens"),
               "recalled": sum(hits), "per_needle": {x[1][:12]: h for x, h in zip(NEEDLES, hits)},
               "prefill_tps": tim.get("prompt_per_second"), "decode_tps": tim.get("predicted_per_second"),
               "ttft_s": round(r["ttft"], 2) if r["ttft"] is not None else None, "total_s": round(r["total"], 1),
               "finish": r["finish"], "reasoning_chars": len(r["reasoning"]), "answer": r["content"]}
        results.append(row)
        print(f"size {size} rep {rep}: recalled {row['recalled']}/4 {list(row['per_needle'].values())} prompt={row['prompt_tokens']} "
              f"prefill={row['prefill_tps']} decode={row['decode_tps']} ttft={row['ttft_s']}s total={row['total_s']}s finish={row['finish']}", flush=True)

if not args.build_only:
    json.dump({"n_ctx": n_ctx, "results": results}, open(args.out, "w"), ensure_ascii=False, indent=1)
