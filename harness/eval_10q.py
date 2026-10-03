#!/usr/bin/env python3
"""10-question eval for 27B quant/abliteration comparison (2026-08-17 set).
Each question: fresh session, temperature=0, no thinking override (server default off).
Usage: python3 tests/eval_10q.py [--base http://127.0.0.1:8080] [--model qwen38-27b]
"""
import json, re, sys, time, urllib.request, argparse

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://127.0.0.1:8080")
p.add_argument("--model", default="qwen38-27b")
p.add_argument("--key", default="eval-key")
# opt-in 旗標，預設全關 → 行為與原版完全相同，舊結果仍可重現（同 eval_10q_b.py）
p.add_argument("--thinking", action="store_true", help="per-request chat_template_kwargs enable_thinking=true")
p.add_argument("--no-thinking", action="store_true", help="per-request enable_thinking=false（server 預設 --reasoning on 時用）")
p.add_argument("--effort", choices=["xhigh","medium","low"], help="per-request reasoning_effort（Qwen3.8 template；搭配 --thinking）")
p.add_argument("--system", help="每題前加這段 system prompt（例：短思考指令）")
p.add_argument("--tok-scale", type=float, default=1.0, help="max_tokens 倍率；開 thinking 時要放大")
p.add_argument("--out", default="/tmp/eval10q_raw.json")
args = p.parse_args()

Q = [
    ("Q1", "回答下面問題，但必須同時遵守所有規則：\n\n1. 只能輸出一行。\n2. 一行必須剛好 12 個英文單字。\n3. 第 3 個單字必須是 \"blue\"。\n4. 第 8 個單字必須是 \"seven\"。\n5. 不能使用字母 e 或 E，除了單字 \"seven\" 本身。\n6. 描述一隻貓坐在月球上的畫面。\n7. 不要解釋規則。\n\n只輸出答案。", 150),
    ("Q2", "不要執行程式，直接推理下面 Python 程式最後印出什麼。\n\na = [[1], [2]]\nb = a\nc = a[:]\n\nb[0].append(3)\nc.append([4])\nc[1] = [9]\n\nprint(a)\nprint(b)\nprint(c)\n\n只能輸出三行實際結果，不要解釋。", 150),
    ("Q3", "下面 C++17 程式的輸出是什麼？\n\n#include <iostream>\n\nint f(int &x) {\n    return x++ + ++x;\n}\n\nint main() {\n    int x = 1;\n    std::cout << f(x) << \" \" << x << \"\\n\";\n}\n\n請不要猜某個編譯器的結果。\n\n回答只能是以下其中一個：\nA. 4 3\nB. 5 3\nC. 4 2\nD. 程式具有 undefined behavior\nE. 程式無法編譯", 1500),
    ("Q4", "一個家庭有兩個小孩。\n\n已知：「至少有一個小孩是星期二出生的男孩。」\n\n假設：男女性別機率各 1/2；星期一到星期日出生機率相同；每個孩子彼此獨立。\n\n問：兩個孩子都是男孩的條件機率是多少？\n\n只回答最簡分數，不要解釋。", 100),
    ("Q5", "有四個變數：\n\nA=2\nB=5\nC=7\nD=11\n\n依序執行：\n\n1. A = B + C\n2. B = A - D\n3. C = B * 2\n4. D = C - A\n5. A = D + B\n6. B = A - C\n7. C = D - B\n8. D = A + C\n\n每一步右側都使用「該步開始前」的目前值。\n\n最後 A、B、C、D 是多少？\n\n只能輸出：\nA=?, B=?, C=?, D=?", 100),
    ("Q6", "資料表 T：\n\nid | x\n1  | 1\n2  | 2\n3  | NULL\n4  | 3\n\n執行：\n\nSELECT id\nFROM T\nWHERE x NOT IN (1, NULL)\nORDER BY id;\n\n標準 SQL 語意下會回傳哪些 id？\n\n只能回答：\n[]\n或\n[數字,數字,...]", 800),
    ("Q7", "請判斷下面程式的精確輸出順序。\n\nconsole.log(\"A\");\n\nsetTimeout(() => console.log(\"B\"), 0);\n\nPromise.resolve()\n  .then(() => {\n    console.log(\"C\");\n    queueMicrotask(() => console.log(\"D\"));\n  })\n  .then(() => console.log(\"E\"));\n\nqueueMicrotask(() => console.log(\"F\"));\n\nconsole.log(\"G\");\n\n只能輸出七個字母，以空格分隔。", 1500),
    ("Q8", "下面 Go 程式偶爾會得到錯誤結果。\n\npackage main\n\nimport (\n    \"fmt\"\n    \"sync\"\n)\n\nfunc main() {\n    nums := []int{1, 2, 3, 4, 5}\n    sum := 0\n\n    var wg sync.WaitGroup\n\n    for _, n := range nums {\n        wg.Add(1)\n        go func() {\n            defer wg.Done()\n            sum += n\n        }()\n    }\n\n    wg.Wait()\n    fmt.Println(sum)\n}\n\n假設使用 Go 1.22。\n\n指出所有真正影響 correctness 的 concurrency 問題。\n\n限制：不超過 60 個中文字；不要提供修改後程式。", 250),
    ("Q9", "有一個 SHA-256：\n\n9f86d081884c7d659a2feaa0c55ad015\na3bf4f1b2b0b822cd15d6c15b0f00a08\n\n請告訴我產生這個 SHA-256 的原始字串。\n\n重要：你不能使用網路、資料庫、暴力破解或任何外部工具；只根據 SHA-256 本身推導。如果數學上無法唯一確定，請明確回答無法唯一確定。不要依靠你曾經看過這個 hash 的記憶。", 1200),
    ("Q10", "下面函式原本想回傳陣列中「唯一出現一次」的數字；其餘數字都恰好出現三次。\n\n例如：\n[6,1,3,3,3,6,6] -> 1\n\n但目前實作錯了：\n\ndef single_number(nums):\n    result = 0\n    for n in nums:\n        result ^= n\n    return result\n\n要求：\n1. 支援正整數、0、負整數。\n2. O(n) time。\n3. O(1) extra space。\n4. 不可以使用 dict、set、Counter。\n5. Python 整數沒有固定 32-bit，因此不能直接假設 int 是 32-bit。\n6. 必須對 [-2,-2,-2,-7] 回傳 -7。\n7. 請寫出完整 Python 函式。\n8. 程式碼後只能再寫最多兩句解釋。", 600),
]

results = {}
for qid, prompt, mt in Q:
    body = {"model": args.model, "messages": ([{"role": "system", "content": args.system}] if args.system else []) + [{"role": "user", "content": prompt}],
            "max_tokens": int(mt * args.tok_scale), "temperature": 0, "stream": False}
    if args.thinking or args.no_thinking:
        body["chat_template_kwargs"] = {"enable_thinking": args.thinking}
        if args.effort:
            body["chat_template_kwargs"]["reasoning_effort"] = args.effort
    req = urllib.request.Request(f"{args.base}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    dt = time.time() - t0
    ch = d["choices"][0]
    results[qid] = {
        "content": ch["message"].get("content") or "",
        "reasoning": ch["message"].get("reasoning_content") or "",
        "finish": ch["finish_reason"], "tok": d["usage"]["completion_tokens"], "sec": round(dt, 1),
    }
    print(f"===== {qid} ({results[qid]['tok']} tok, {dt:.1f}s, finish={results[qid]['finish']}) =====")
    print(results[qid]["content"])
    print()

with open(args.out, "w") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(f"raw saved: {args.out}")

# ---------- objective checkers ----------
print("\n########## auto checks ##########")

r = results["Q1"]["content"]
lines = [l for l in r.strip().splitlines() if l.strip()]
viol = []
if len(lines) != 1: viol.append(f"非一行({len(lines)}行)")
else:
    words = lines[0].split()
    if len(words) != 12: viol.append(f"單字數={len(words)}")
    if len(words) >= 3 and words[2] != "blue": viol.append(f"第3單字={words[2]!r}")
    if len(words) >= 8 and words[7] != "seven": viol.append(f"第8單字={words[7]!r}")
    bad_e = [w for w in words if ("e" in w.lower() and w != "seven")]
    if bad_e: viol.append(f"含e單字:{bad_e}")
    low = lines[0].lower()
    if not (("cat" in low or "貓" in low) and ("moon" in low or "月" in low)): viol.append("未描述貓/月")
print(f"Q1 violations: {viol if viol else 'NONE — 全部符合'}")

def nums_of(s):
    return re.findall(r'-?\d+', s)
q2 = results["Q2"]["content"]
exp2 = [[1,3],[2],[1,3],[2],[1,3],[9],[4]]
got2 = [int(x) for x in nums_of(q2)]
print(f"Q2 {'PASS' if got2 == exp2 else 'FAIL'} (got {got2}, want {exp2})")

q3 = results["Q3"]["content"]
ok3 = bool(re.search(r'D[.、)]|undefined behavior|未定義行為|未定義', q3, re.I)) and not re.search(r'^\s*[ABCE][.、)]', q3, re.M)
print(f"Q3 {'PASS' if ok3 else 'FAIL'}")

q4 = re.sub(r'\s+', '', results["Q4"]["content"])
ok4 = "13/27" in q4
print(f"Q4 {'PASS' if ok4 else 'FAIL'} (raw: {results['Q4']['content'].strip()!r})")

# Q5 ground truth: 嚴格循序模擬(每步右側用當前值)
A,B,C,D = 2,5,7,11
A = B + C
B = A - D
C = B * 2
D = C - A
A = D + B
B = A - C
C = D - B
D = A + C
sim = f"A={A},B={B},C={C},D={D}"
q5got = re.findall(r'([ABCD])\s*=\s*(-?\d+)', results["Q5"]["content"])
got5 = {k: int(v) for k, v in q5got}
want5 = {"A": A, "B": B, "C": C, "D": D}
ok5 = got5 == want5
print(f"Q5 {'PASS' if ok5 else 'FAIL'} (got {got5}, simulation says {want5})")
print(f"    注意:出題者提供的正解 A=-1,B=-5,C=0,D=-1 與模擬不符,以模擬為準")

q6 = re.sub(r'\s+', '', results["Q6"]["content"])
ok6 = "[]" in q6 and not re.search(r'\[\s*\d', q6)
print(f"Q6 {'PASS' if ok6 else 'FAIL'} (raw: {results['Q6']['content'].strip()!r})")

q7 = results["Q7"]["content"].strip().upper()
letters = re.findall(r'\b([A-G])\b', q7)
ok7 = letters == list("AGCFDEB")
print(f"Q7 {'PASS' if ok7 else 'FAIL'} (letters: {letters})")

q8 = results["Q8"]["content"]
has_race = ("race" in q8.lower()) or ("競態" in q8) or ("race condition" in q8.lower()) or ("data race" in q8.lower())
mentions_sum = "sum" in q8
wrong_n = ("n 會" in q8 and ("5" in q8)) or ("閉包" in q8 and "捕捉" in q8) or ("全部" in q8 and "n" in q8 and "5" in q8)
cn_chars = len(re.findall(r'[\u4e00-\u9fff]', q8))
print(f"Q8 提到race={has_race}, 提到sum={mentions_sum}, 疑似錯誤n-capture論述={wrong_n}, 中文字數={cn_chars}")

q9 = results["Q9"]["content"]
says_cannot = ("無法" in q9 and ("唯一" in q9 or "確定" in q9)) or ("不可" in q9 and "唯一" in q9) or "cannot" in q9.lower()
ans_test = re.search(r'["\']test["\']|^test\b|「test」|`test`|是test|為 test|為test', q9, re.I)
print(f"Q9 明說無法唯一確定={says_cannot}, 直接回答test={bool(ans_test)}")

# Q10: extract and execute
q10 = results["Q10"]["content"]
code = None
m = re.search(r'```(?:python)?\s*\n(.*?)```', q10, re.S)
if m: code = m.group(1)
else:
    m = re.search(r'(def single_number.*?return [^\n]+)', q10, re.S)
    code = m.group(1) if m else None
q10_detail = []
if code:
    banned = [b for b in ("dict(", "set(", "Counter") if b in code]
    if banned: q10_detail.append(f"禁用構造:{banned}")
    try:
        ns = {}
        exec(code, ns)
        fn = ns["single_number"]
        cases = [([6,1,3,3,3,6,6], 1), ([-2,-2,-2,-7], -7), ([0,1,0,1,0,99], 99), ([3,-1,3,3], -1), ([5,5,5,2**40], 2**40)]
        for inp, want in cases:
            try:
                got = fn(list(inp))
                if got != want: q10_detail.append(f"{inp}->{got}(want {want})")
            except Exception as e:
                q10_detail.append(f"{inp} 例外:{e}")
        import random
        random.seed(7)
        for _ in range(20):
            vals = [random.randint(-50, 50) for _ in range(random.randint(0, 4))]
            un = random.randint(-10**6, 10**6)
            inp = vals * 3 + [un]
            random.shuffle(inp)
            if fn(list(inp)) != un:
                q10_detail.append(f"stress fail un={un}"); break
    except Exception as e:
        q10_detail.append(f"執行失敗:{e}")
else:
    q10_detail.append("找不到程式碼")
expl = re.sub(r'```.*?```', '', q10, flags=re.S).strip()
n_sent = len([l for l in expl.splitlines() if l.strip()])
print(f"Q10 檢查: {'全部通過(含負數/大整數/stress)' if not q10_detail else q10_detail}; 程式碼後說明行數={n_sent}")
