#!/usr/bin/env python3
"""Eval set B (Q11-Q20): constraint/graph/policy/agent/algorithms. temp=0, fresh session per Q.
Usage: python3 tests/eval_10q_b.py [--model qwen38-27b]"""
import argparse, json, re, sys, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://127.0.0.1:8080")
p.add_argument("--model", default="qwen38-27b")
p.add_argument("--key", default="eval-key")
# opt-in 旗標，預設全關 → 行為與原版完全相同，舊結果仍可重現
p.add_argument("--thinking", action="store_true",
               help="per-request chat_template_kwargs enable_thinking=true (覆蓋 server 的 --reasoning off)")
p.add_argument("--no-thinking", action="store_true",
               help="per-request enable_thinking=false（server 預設 --reasoning on 時用）")
p.add_argument("--effort", choices=["xhigh","medium","low"], help="per-request reasoning_effort（Qwen3.8 template；搭配 --thinking）")
p.add_argument("--system", help="每題前加這段 system prompt（例：短思考指令）")
p.add_argument("--max-tokens", type=int, help="fixed max_tokens for every question (overrides the per-question budget × --tok-scale)")
p.add_argument("--tok-scale", type=float, default=1.0,
               help="max_tokens 倍率；開 thinking 時要放大，否則思考鏈會吃光預算導致 content 空白")
p.add_argument("--out", default="/tmp/eval10qb_raw.json")
args = p.parse_args()

Q = [
    ("Q11", "找出五個整數 a,b,c,d,e，必須同時滿足：\n\n- 1 ≤ a < b < c < d < e ≤ 9\n- 五個數互不相同\n- c = 4\n- a + e = 8\n- b + d = 10\n- a + b + c + d + e = 20\n\n如果存在，只輸出：\na,b,c,d,e\n\n如果不存在，只輸出：\nIMPOSSIBLE\n\n不要解釋。", 800),
    ("Q12", "有以下單向道路，括號內為成本：\n\nA → B (4)\nA → C (3)\nB → D (4)\nB → E (8)\nC → D (6)\nC → E (9)\nD → E (2)\n\n你從 A 前往 E。\n\n你有一張優惠券，可以讓「實際走過的其中一條道路」成本變成 0，而且只能使用一次。\n\n求最低總成本與路徑。\n\n只能輸出：\n成本 | 路徑\n\n例如：\n7 | A→B→E", 1000),
    ("Q13", "有五個事件 A、B、C、D、E。\n\n已知只有以下先後限制：\n\nA 必須發生在 C 前\nB 必須發生在 C 前\nC 必須發生在 D 前\nB 必須發生在 E 前\nE 必須發生在 D 前\n\n除此之外沒有其他限制。\n\n問：共有多少種合法的完整事件順序？\n\n只能輸出一個整數。", 1000),
    ("Q14", "產品規格：\n\n使用者可以 publish，若且唯若：\n\n1. account 必須 active\n2. account 不可以 suspended\n3. 並且使用者必須符合以下至少一項：\n   - role 是 admin\n   - owns_resource 為 True\n\n目前程式：\n\ndef can_publish(user):\n    return user[\"active\"] and user[\"role\"] == \"admin\" or user[\"owns_resource\"] and not user[\"suspended\"]\n\n只能修改 return 那一行。\n\n輸出修正後的完整 return statement。\n不要解釋。", 600),
    ("Q15", "你是一個 coding agent，只有以下 tools：\n\nsearch_docs(query)\n  - 搜尋文件，只回傳 document ID，不回傳內容\n\nread_doc(id)\n  - 讀取文件內容\n\nrun_test(name)\n  - 執行指定測試\n\nedit_file(path, change)\n  - 修改檔案\n\nrestart_service()\n  - 重啟服務\n\n任務：\n修正 payment_timeout 的錯誤設定並部署。\n\n限制：\n\n1. 第一個動作必須先重現 failing test。\n2. payment_timeout 的正確值必須從官方文件取得，不准猜。\n3. search_docs 只會拿到 ID，因此必須 read_doc 才能看到正確值。\n4. 在重現失敗前禁止 edit_file。\n5. 修改後必須再次執行同一個 test。\n6. test PASS 後才能 restart_service。\n7. 使用最少 tool calls。\n\n只輸出 tool 名稱，以 → 分隔，不要帶參數。", 800),
    ("Q16", "輸入：\n\n[\n  {\"id\":\"a\",\"score\":7,\"tags\":[\"x\",\"y\"]},\n  {\"id\":\"b\",\"score\":8,\"tags\":[\"y\"]},\n  {\"id\":\"c\",\"score\":7,\"tags\":[\"x\"]},\n  {\"id\":\"d\",\"score\":9,\"tags\":[]},\n  {\"id\":\"e\",\"score\":6,\"tags\":[\"x\"]}\n]\n\n依序執行，禁止改變操作順序：\n\n1. 移除 score < 7 的項目。\n2. 如果 tags 包含 \"x\"，score 加 2。\n3. 按修改後 score 由大到小排序。\n4. score 相同時按 id 字母升冪排序。\n5. 最後只留下 id。\n\n只輸出合法 JSON array。", 1000),
    ("Q17", "系統採用「DENY 優先」：\n\n只要任何 DENY rule 命中，最終一定 DENY。\n否則，只要至少一條 ALLOW rule 命中，最終 ALLOW。\n都沒命中則 DENY。\n\nRules：\n\nR1 ALLOW：\nrole = editor 且 user.team = resource.team\n\nR2 ALLOW：\nrole = admin\n\nR3 DENY：\nresource.classification = restricted 且 clearance < 3\n\nR4 DENY：\naccount_suspended = true\n\n判斷：\n\n①\nrole=editor\nteam=red\nclearance=2\naccount_suspended=false\nresource.team=red\nresource.classification=restricted\n\n②\nrole=editor\nteam=blue\nclearance=3\naccount_suspended=false\nresource.team=blue\nresource.classification=restricted\n\n③\nrole=admin\nteam=red\nclearance=1\naccount_suspended=false\nresource.team=green\nresource.classification=restricted\n\n只能輸出：\n[結果1,結果2,結果3]\n\n結果只能是 ALLOW 或 DENY。", 1000),
    ("Q18", "一個推論系統每個 request 平均：\n\n- Prompt：1200 tokens\n- Output：300 tokens\n\n系統有兩個獨立 stage：\n\nPrompt engine：\n1200 tokens/s\n\nDecode engine：\n60 tokens/s\n\n兩個 stage 可以 pipeline：\n當 request A 在 decode 時，request B 可以同時進行 prompt processing。\n\n但同一個 stage 同時間只能處理一個 request。\n\n假設 request 永遠足夠多，忽略其他 overhead。\n\n問：系統長時間穩態的最大 throughput 是多少 requests/minute？\n\n只能輸出數字。", 1000),
    ("Q19", "以下是 production log：\n\n10:00:00 request order=817 received\n10:00:01 payment charge order=817 SUCCESS\n10:00:01 response write FAILED: connection reset\n\n10:00:04 request order=817 received\n10:00:05 payment charge order=817 SUCCESS\n10:00:05 response 200\n\nClient 規則：\n如果沒有收到 HTTP response，3 秒後自動 retry。\n\nServer：\n每次收到 POST /pay 都直接執行 charge。\n目前沒有 idempotency key，也沒有 request deduplication。\n\n資料庫最後出現兩筆成功扣款。\n\n回答兩件事：\n\nROOT_CAUSE=<最直接原因>\nFIX=<應採用的核心機制>\n\n每項最多 12 個英文單字。\n不要提出「關掉 retry」。", 600),
    ("Q20", "實作：\n\ndef compare_versions(a: str, b: str) -> int:\n\n版本格式：\n\n- 只包含十進位數字與 \".\"\n- 每個 component 至少一位數\n- component 可以有任意多位，甚至 100,000 位\n- component 前導 0 不影響數值\n- 尾端值為 0 的 component 不影響版本\n\n例如：\n\n1.0 == 1\n1.0.0 == 1\n1.0002 == 1.2\n1.10 > 1.2\n0001.0000003 == 1.3\n\n要求：\n\n- a < b 回傳 -1\n- a == b 回傳 0\n- a > b 回傳 1\n- 禁止使用 int()、float()、Decimal 或任何 arbitrary-precision numeric conversion\n- 必須正確處理 100,000 位 component\n- 時間複雜度 O(len(a) + len(b))\n\n請輸出完整 Python 函式。\n不要輸出測試程式。", 1500),
]

results = {}
for qid, prompt, mt in Q:
    body = {"model": args.model, "messages": ([{"role": "system", "content": args.system}] if args.system else []) + [{"role": "user", "content": prompt}],
            "max_tokens": (args.max_tokens or int(mt * args.tok_scale)), "temperature": 0, "stream": False}
    if args.thinking or args.no_thinking:
        body["chat_template_kwargs"] = {"enable_thinking": args.thinking}
        if args.effort:
            body["chat_template_kwargs"]["reasoning_effort"] = args.effort
    req = urllib.request.Request(f"{args.base}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    ch = d["choices"][0]
    results[qid] = {"content": ch["message"].get("content") or "",
                    "reasoning": ch["message"].get("reasoning_content") or "",
                    "finish": ch["finish_reason"], "tok": d["usage"]["completion_tokens"],
                    "sec": round(time.time() - t0, 1)}
    print(f"===== {qid} ({results[qid]['tok']} tok, {results[qid]['sec']}s, finish={results[qid]['finish']}) =====")
    print(results[qid]["content"])
    print()

json.dump(results, open(args.out, "w"), ensure_ascii=False, indent=2)
print(f"raw saved: {args.out}")
