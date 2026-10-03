#!/usr/bin/env python3
"""Agent tool-calling reliability against the local chat server, server-default sampling/thinking.
6 scenarios x --repeats episodes, interleaved round-robin; each episode is a fresh multi-turn conversation with
deterministic fake tools. Records success, malformed calls, server errors, cross-scenario leakage. Usage:
  python3 harness/eval_agent_tools.py --out results/x.json [--repeats 5] [--max-tokens 16000]
  python3 harness/eval_agent_tools.py --selftest   # offline check of fake tools and graders"""
import argparse, json, os, re, statistics, sys, time, urllib.request

SYSTEM = "You are an assistant that uses tools when needed. Answer in the user's language."
MAX_TURNS = 10

def fn(name, desc, props, required):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": {k: {"type": "string", "description": v} for k, v in props.items()},
        "required": required}}}

T_CALC = fn("calculator", "Evaluate an arithmetic expression (digits, + - * / ( ) . only).", {"expression": "the expression"}, ["expression"])
T_LS = fn("list_dir", "List entries of a directory.", {"path": "absolute directory path"}, ["path"])
T_READ = fn("read_file", "Read a text file.", {"path": "absolute file path"}, ["path"])
T_WEATHER = fn("get_weather", "Get current weather for a city.", {"city": "city name"}, ["city"])
T_USER = fn("find_user", "Look up a user by email.", {"email": "email address"}, ["email"])
T_ORDERS = fn("list_orders", "List a user's orders.", {"user_id": "user id"}, ["user_id"])
T_STOCK = fn("get_stock_price", "Get the current price of a stock.", {"symbol": "ticker symbol"}, ["symbol"])

TREE = {"/app/README.md": "see config/", "/app/config/base.yaml": "payment_timeout: 30\nretries: 3",
        "/app/config/prod.yaml": "# overrides base.yaml\npayment_timeout: 45"}
CITY_TEMP = {"taipei": 31, "台北": 31, "tokyo": 26, "東京": 26, "seoul": 22, "首爾": 22}

def t_calculator(a, st):
    e = a["expression"]
    if not isinstance(e, str) or not re.fullmatch(r"[0-9+\-*/(). ]+", e): return {"error": "invalid characters"}
    try: return {"result": eval(e, {"__builtins__": {}}, {})}
    except Exception as ex: return {"error": f"{type(ex).__name__}: {ex}"}

def t_list_dir(a, st):
    p = str(a["path"]).rstrip("/") or "/"
    ents = sorted({f[len(p) + 1:].split("/")[0] + ("/" if "/" in f[len(p) + 1:] else "")
                   for f in TREE if f.startswith(p + "/")})
    return {"entries": ents} if ents else {"error": f"no such directory: {a['path']}"}

def t_read_file(a, st):
    return {"content": TREE[a["path"]]} if a["path"] in TREE else {"error": f"no such file: {a['path']}"}

def t_get_weather(a, st):
    c = str(a["city"]).strip().lower()
    return {"city": a["city"], "temp_c": CITY_TEMP[c]} if c in CITY_TEMP else {"error": "unknown city"}

def t_find_user(a, st):
    return {"user_id": "u_8812"} if str(a["email"]).strip().lower() == "amy@example.com" else {"error": "user not found"}

def t_list_orders(a, st):
    if a["user_id"] != "u_8812": return {"error": "unknown user_id"}
    return {"orders": [{"id": "o_1", "total": 1250}, {"id": "o_2", "total": 380}, {"id": "o_3", "total": 2990}]}

def t_stock(a, st):
    st["stock_calls"] = st.get("stock_calls", 0) + 1
    if st["stock_calls"] == 1: return {"error": "rate limited, retry"}
    return {"symbol": "NVDA", "price": 187.4}

IMPL = {"calculator": t_calculator, "list_dir": t_list_dir, "read_file": t_read_file, "get_weather": t_get_weather,
        "find_user": t_find_user, "list_orders": t_list_orders, "get_stock_price": t_stock}
REQUIRED = {t["function"]["name"]: t["function"]["parameters"]["required"] for t in
            (T_CALC, T_LS, T_READ, T_WEATHER, T_USER, T_ORDERS, T_STOCK)}

CALC_ANSWER = (1234 * 5678) - (98765 // 5)   # 98765/5 is exact

def has_num(text, num):
    """True if integer num appears (thousands commas and trailing .0 allowed) as a whole number."""
    return re.search(rf"(?<![\d.]){num}(?:\.0+)?(?!\d)", text.replace(",", "")) is not None

def called(calls, name): return [c["name"] for c in calls if c["name"] == name]

# graders: (final answer, tool-call list) -> bool
def g_calc(ans, calls): return has_num(ans, CALC_ANSWER)
def g_files(ans, calls): return "45" in ans
def g_weather(ans, calls):
    cities = set()
    for c in calls:
        try: cities.add(CITY_TEMP_KEY[str(json.loads(c["arguments"])["city"]).strip().lower()])
        except Exception: pass
    return ("台北" in ans or "Taipei" in ans) and cities >= {"taipei", "tokyo", "seoul"}
CITY_TEMP_KEY = {"taipei": "taipei", "台北": "taipei", "tokyo": "tokyo", "東京": "tokyo", "seoul": "seoul", "首爾": "seoul"}
def g_orders(ans, calls):
    names = [c["name"] for c in calls]
    return has_num(ans, 4620) and "find_user" in names and "list_orders" in names and names.index("find_user") < names.index("list_orders")
def g_notool(ans, calls): return not calls and bool(ans.strip())
def g_retry(ans, calls): return "187.4" in ans and len(called(calls, "get_stock_price")) >= 2

# foreign-marker regexes; a marker in the answer of a different scenario counts as leakage
MARKERS = {"calc": [str(CALC_ANSWER)], "files": ["payment_timeout"], "weather": ["Seoul", "首爾"],
           "orders": ["u_8812"], "no_tool": [r"(?<!\d)404(?!\d)"], "retry": ["NVDA"]}

SCENARIOS = {
    "calc": dict(tools=[T_CALC], user="請用計算機算 (1234 * 5678) - (98765 / 5)，最後只回答數字。", grade=g_calc),
    "files": dict(tools=[T_LS, T_READ], user="In the /app project, what payment_timeout is used in production? Check the files, don't guess.", grade=g_files),
    "weather": dict(tools=[T_WEATHER], user="台北、東京、首爾現在哪個城市最熱？要查實際天氣。", grade=g_weather),
    "orders": dict(tools=[T_USER, T_ORDERS], user="amy@example.com 這位客戶的訂單總金額是多少？", grade=g_orders),
    "no_tool": dict(tools=[T_CALC, T_WEATHER], user="用一句話解釋什麼是 HTTP 404。", grade=g_notool),
    "retry": dict(tools=[T_STOCK], user="What's NVDA's current stock price? Use the tool.", grade=g_retry),
}

def leaked(scn, ans):
    return [m for s, ms in MARKERS.items() if s != scn for m in ms if re.search(m, ans.replace(",", "") if m.isdigit() else ans)]

def run_tool(call, st):
    """Execute one tool call; returns (result string, malformed?)."""
    f = call.get("function", {}); name = f.get("name"); raw = f.get("arguments")
    if name not in IMPL: return json.dumps({"error": f"unknown tool: {name}"}), True
    try: a = json.loads(raw) if isinstance(raw, str) else raw
    except Exception: a = None
    if not isinstance(a, dict): return json.dumps({"error": "arguments are not a valid JSON object"}), True
    miss = [k for k in REQUIRED[name] if k not in a]
    if miss: return json.dumps({"error": f"missing required parameters: {miss}"}), True
    try: return json.dumps(IMPL[name](a, st), ensure_ascii=False), False
    except Exception as e: return json.dumps({"error": f"tool failure: {e}"}), True

def chat(args, messages, tools):
    body = {"messages": messages, "tools": tools, "max_tokens": args.max_tokens}
    req = urllib.request.Request(args.url + "/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    with urllib.request.urlopen(req, timeout=3600) as r:
        return json.load(r)

def episode(args, scn, rep):
    sc = SCENARIOS[scn]; st = {}
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": sc["user"]}]
    row = dict(scenario=scn, repeat=rep, ok=False, turns=0, tool_calls=[], malformed=0, server_error=None,
               leaked=[], finish_reason=None, completion_tokens=0, answer="")
    t0 = time.time()
    for _ in range(MAX_TURNS):
        try:
            d = chat(args, msgs, sc["tools"])
            ch = d["choices"][0]; m = ch["message"]
        except Exception as e:
            row["server_error"] = f"{type(e).__name__}: {e}"[:300]; break
        row["turns"] += 1; row["finish_reason"] = ch.get("finish_reason")
        row["completion_tokens"] += (d.get("usage") or {}).get("completion_tokens", 0)
        row["answer"] = m.get("content") or ""
        tcs = m.get("tool_calls") or []
        if not tcs: break
        am = {"role": "assistant", "content": m.get("content") or "", "tool_calls": tcs}
        if m.get("reasoning_content"): am["reasoning_content"] = m["reasoning_content"]
        msgs.append(am)
        for c in tcs:
            f = c.get("function", {})
            row["tool_calls"].append({"name": f.get("name"), "arguments": f.get("arguments")})
            out, bad = run_tool(c, st); row["malformed"] += bad
            msgs.append({"role": "tool", "tool_call_id": c.get("id", ""), "content": out})
    row["wall_sec"] = round(time.time() - t0, 1)
    if not row["server_error"]:
        row["ok"] = bool(sc["grade"](row["answer"], row["tool_calls"]))
    row["leaked"] = leaked(scn, row["answer"])
    return row

def summarize(rows):
    per = {}
    for r in rows:
        s = per.setdefault(r["scenario"], [0, 0]); s[0] += r["ok"]; s[1] += 1
    ok = sum(r["ok"] for r in rows)
    return {"n": len(rows), "success": ok, "success_rate": round(ok / len(rows), 3) if rows else 0,
            "per_scenario": {k: f"{a}/{b}" for k, (a, b) in per.items()},
            "malformed_calls": sum(r["malformed"] for r in rows),
            "episodes_with_malformed": sum(1 for r in rows if r["malformed"] > 0),
            "server_errors": sum(1 for r in rows if r["server_error"]),
            "leaked_episodes": sum(1 for r in rows if r["leaked"]),
            "median_turns": statistics.median(r["turns"] for r in rows) if rows else 0,
            "median_wall_sec": statistics.median(r["wall_sec"] for r in rows) if rows else 0}

def selftest():
    c = lambda n, **a: {"name": n, "arguments": json.dumps(a)}
    assert CALC_ANSWER == 6986899
    st = {}
    assert t_calculator({"expression": "(1234 * 5678) - (98765 / 5)"}, st)["result"] == 6986899.0
    assert "error" in t_calculator({"expression": "__import__('os')"}, st)
    assert t_list_dir({"path": "/app"}, st)["entries"] == ["README.md", "config/"]
    assert t_list_dir({"path": "/app/config/"}, st)["entries"] == ["base.yaml", "prod.yaml"]
    assert "error" in t_list_dir({"path": "/nope"}, st) and "error" in t_read_file({"path": "/x"}, st)
    assert t_get_weather({"city": "Taipei"}, st)["temp_c"] == 31 and "error" in t_get_weather({"city": "Paris"}, st)
    assert "error" in t_find_user({"email": "x@y.z"}, st) and "error" in t_list_orders({"user_id": "u_1"}, st)
    assert sum(o["total"] for o in t_list_orders({"user_id": "u_8812"}, st)["orders"]) == 4620
    assert "error" in t_stock({"symbol": "NVDA"}, st) and t_stock({"symbol": "NVDA"}, st)["price"] == 187.4
    # malformed detection
    mk = lambda n, a: {"id": "1", "function": {"name": n, "arguments": a}}
    assert run_tool(mk("calculator", "{bad"), {})[1] and run_tool(mk("calculator", "[1]"), {})[1]
    assert run_tool(mk("nope", "{}"), {})[1] and run_tool(mk("calculator", "{}"), {})[1]
    assert not run_tool(mk("calculator", '{"expression": "1+1"}'), {})[1]
    # graders
    assert g_calc("答案是 6,986,899", []) and g_calc("6986899.0", []) and not g_calc("6987299", []) and not g_calc("16986899", [])
    assert g_files("It is 45 seconds", []) and not g_files("30", [])
    all3 = [c("get_weather", city=x) for x in ("台北", "Tokyo", "Seoul")]
    assert g_weather("台北最熱", all3) and not g_weather("Tokyo is hottest", all3) and not g_weather("台北最熱", all3[:2])
    o = [c("find_user", email="amy@example.com"), c("list_orders", user_id="u_8812")]
    assert g_orders("共 4,620", o) and not g_orders("4620", o[::-1]) and not g_orders("4620", o[:1]) and not g_orders("4260", o)
    assert g_notool("404 means not found", []) and not g_notool("", []) and not g_notool("x", [c("calculator", expression="1")])
    s = [c("get_stock_price", symbol="NVDA")] * 2
    assert g_retry("$187.4", s) and not g_retry("$187.4", s[:1]) and not g_retry("n/a", s)
    # leakage
    assert leaked("no_tool", "404 means not found") == [] and leaked("calc", "404") and leaked("no_tool", "Error 4045") == []
    assert leaked("weather", "Seoul is 22") == [] and leaked("orders", "Seoul") and leaked("retry", "u_8812")
    assert leaked("files", "payment_timeout") == [] and leaked("calc", "payment_timeout")
    assert leaked("orders", "total 6,986,899") and leaked("calc", "6986899") == []
    print("selftest OK")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.environ.get("LLM_URL", "http://127.0.0.1:8080"))
    p.add_argument("--key", default=os.environ.get("LLM_KEY", "eval-key"))
    p.add_argument("--max-tokens", type=int, default=16000)
    p.add_argument("--repeats", type=int, default=5)
    p.add_argument("--out")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args()
    if args.selftest: selftest(); sys.exit()
    if not args.out: p.error("--out is required")

    order = [(s, r) for r in range(1, args.repeats + 1) for s in SCENARIOS]   # round-robin across scenarios
    rows = []
    for i, (scn, rep) in enumerate(order):
        row = episode(args, scn, rep); rows.append(row)
        print(f"[{i+1}/{len(order)}] {scn:8} r{rep} {'PASS' if row['ok'] else 'FAIL'} turns={row['turns']} "
              f"calls={len(row['tool_calls'])} malformed={row['malformed']} tok={row['completion_tokens']} {row['wall_sec']}s "
              f"finish={row['finish_reason']}" + (f" LEAK={row['leaked']}" if row["leaked"] else "")
              + (f" ERR={row['server_error']}" if row["server_error"] else ""), flush=True)
    summary = summarize(rows)
    json.dump({"summary": summary, "episodes": rows}, open(args.out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))
