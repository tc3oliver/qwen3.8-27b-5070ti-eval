#!/usr/bin/env python3
"""User-perceived latency on 20 everyday Traditional-Chinese prompts (streaming, server-default sampling/thinking), plus
Simplified-Chinese drift in the answers. Usage:
  python3 harness/eval_latency_zh.py --out results/x.json [--limit N] [--max-tokens 16000]"""
import argparse, json, os, statistics, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
p.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
p.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "../data/zh_latency_prompts.json"))
p.add_argument("--max-tokens", type=int, default=16000)
p.add_argument("--limit", type=int, default=0)
p.add_argument("--out", required=True)
args = p.parse_args()

prompts = json.load(open(args.data))
if args.limit: prompts = prompts[:args.limit]

# Simplified-only forms. Deliberately excluded because they also occur in normal Traditional/Taiwanese text:
# 体 后 么 机 算 (and other shared characters).
SIMPLIFIED = set("这们个为来说时对会还没过发经问题样实现应该级处开关国学习写让认识进将选择数据库务计网络线项页码错误览种类观点简单验证书记录输获储请谢运动车门间听东两万亿")

def run(content):
    body = {"messages": [{"role": "user", "content": content}], "max_tokens": args.max_tokens, "cache_prompt": False,
            "stream": True, "stream_options": {"include_usage": True}}
    req = urllib.request.Request(args.url + "/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    t0 = time.time(); ttft = first_ans = None; reasoning, answer = [], []; finish = None; usage = {}; timings = {}
    with urllib.request.urlopen(req, timeout=3600) as r:
        for line in r:
            line = line.decode().strip()
            if not line.startswith("data:") or line.endswith("[DONE]"): continue
            d = json.loads(line[5:])
            if d.get("usage"): usage = d["usage"]
            if d.get("timings"): timings = d["timings"]
            for c in d.get("choices", []):
                dl = c.get("delta", {}); now = time.time() - t0
                if dl.get("reasoning_content"):
                    reasoning.append(dl["reasoning_content"]); ttft = ttft if ttft is not None else now
                if dl.get("content"):
                    answer.append(dl["content"]); ttft = ttft if ttft is not None else now
                    first_ans = first_ans if first_ans is not None else now
                if c.get("finish_reason"): finish = c["finish_reason"]
    return dict(ttft=ttft, first_ans=first_ans, total=time.time() - t0, reasoning="".join(reasoning),
                content="".join(answer), finish=finish, usage=usage, timings=timings)

def pct(xs, q):
    xs = sorted(xs)
    if not xs: return None
    k = (len(xs) - 1) * q; lo = int(k); hi = min(lo + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 2)

rows = []
for i, pr in enumerate(prompts):
    try:
        r = run(pr["prompt"])
    except Exception as e:
        rows.append({"id": pr["id"], "category": pr["category"], "error": str(e)}); print(rows[-1], flush=True); continue
    tim = r["timings"]; sc = sorted(set(r["content"]) & SIMPLIFIED)
    rows.append({"id": pr["id"], "category": pr["category"], "ttft_s": r["ttft"], "first_answer_s": r["first_ans"],
                 "total_s": round(r["total"], 2), "completion_tokens": r["usage"].get("completion_tokens"),
                 "prompt_tokens": r["usage"].get("prompt_tokens"),
                 "reasoning_chars": len(r["reasoning"]), "content_chars": len(r["content"]),
                 "decode_tps": tim.get("predicted_per_second"), "prefill_tps": tim.get("prompt_per_second"),
                 "draft_n": tim.get("draft_n"), "draft_n_accepted": tim.get("draft_n_accepted"),
                 "finish": r["finish"], "simplified_chars": sc, "empty": not r["content"].strip(), "answer": r["content"]})
    x = rows[-1]
    print(f"[{i+1}/{len(prompts)}] {pr['category']:16} ttft={x['ttft_s'] and round(x['ttft_s'],2)} ans={x['first_answer_s'] and round(x['first_answer_s'],2)} "
          f"total={x['total_s']} tok={x['completion_tokens']} tps={x['decode_tps'] and round(x['decode_tps'],1)} "
          f"{'SIMPL:'+''.join(sc) if sc else ''}{' EMPTY' if x['empty'] else ''}", flush=True)

ok = [x for x in rows if "error" not in x]
col = lambda k: [x[k] for x in ok if x.get(k) is not None]
summary = {"n": len(rows), "errors": len(rows) - len(ok)}
for k in ("ttft_s", "first_answer_s", "total_s"):
    summary[k] = {"p50": pct(col(k), 0.5), "p90": pct(col(k), 0.9)}
summary["mean_decode_tps"] = round(statistics.mean(col("decode_tps")), 1) if col("decode_tps") else None
summary["mean_prefill_tps"] = round(statistics.mean(col("prefill_tps")), 1) if col("prefill_tps") else None
summary["simplified_drift"] = f"{sum(1 for x in ok if x['simplified_chars'])}/{len(rows)}"
summary["empty_answers"] = sum(1 for x in ok if x["empty"])
summary["truncated"] = sum(1 for x in ok if x["finish"] == "length")
json.dump({"summary": summary, "results": rows}, open(args.out, "w"), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False))
