#!/usr/bin/env python3
"""Grades 10Q answers (eval_10q.py Set A Q1-Q10, eval_10q_b.py Set B Q11-Q20) with fixed rules.
2 = correct and obeys the output constraint; 1 = correct but violates the format/length constraint;
0 = wrong, empty, or truncated. Code answers (Q10, Q14, Q20) are executed. Q8 and Q9 need a semantic judgement:
the rule below decides, and the item is flagged "review" so a human can check it.
Usage: python3 harness/grade_10q.py A.json B.json [--out grades.json]"""
import argparse, json, re

def clean(t):
    t = (t or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\n|\n?```$", "", t.strip()).strip()
    return t

def code_block(t):
    m = re.findall(r"```(?:python|py)?\s*\n(.*?)```", t or "", re.S)
    return m[-1] if m else None

def exact_or_contains(text, want, norm=lambda s: re.sub(r"\s+", " ", s).strip()):
    c = norm(clean(text))
    if c == norm(want): return 2, "exact"
    if norm(want) in c: return 1, "correct with extra text"
    return 0, "wrong"

def q1(t):
    line = clean(t)
    if "\n" in line: return 0, "more than one line"
    w = re.findall(r"[A-Za-z']+", line)
    bad = [x for x in w if re.search("[eE]", x) and x.lower() not in ("seven", "blue")]
    ok = len(w) == 12 and w[2].lower() == "blue" and w[7].lower() == "seven" and not bad and \
         re.search(r"\bcats?\b", line, re.I) and re.search(r"\bmoon\b", line, re.I)
    return (2, "all constraints") if ok else (0, f"words={len(w)} w3={w[2:3]} w8={w[7:8]} e-words={bad}")

def q2(t): return exact_or_contains(t, "[[1, 3], [2]]\n[[1, 3], [2]]\n[[1, 3], [9], [4]]", lambda s: "\n".join(l.strip() for l in s.strip().splitlines() if l.strip()))

def q3(t):
    c = clean(t)
    if not re.search(r"\bD\b|undefined behavior|未定義", c): return 0, "not D"
    if re.search(r"答案[:：]?\s*[ABCE]\b|^[ABCE][.\s]", c): return 0, "other option chosen"
    return (2, "only the option") if len(c) <= 40 else (1, "D with explanation")

def simple(want):
    return lambda t: exact_or_contains(t, want)

def number(want):
    """Exact number; the number appearing as a whole token in longer text scores 1 ("120" is not "12")."""
    def f(t):
        c = clean(t).strip("*` ")
        if c == want: return 2, "exact"
        return (1, "correct with extra text") if re.search(rf"(?<![\d./]){re.escape(want)}(?![\d./])", c) else (0, f"wrong: {c[:30]!r}")
    return f

def q5(t):
    c = clean(t); vals = dict(re.findall(r"([ABCD])\s*=\s*(-?\d+)", c))
    if vals != {"A": "-9", "B": "-11", "C": "1", "D": "-8"}: return 0, f"values {vals}"
    return (2, "exact") if len(c) <= 30 else (1, "correct with extra text")

def q6(t):
    c = clean(t); last = [l.strip() for l in c.splitlines() if l.strip()][-1:] or [""]
    if c == "[]": return 2, "exact"
    if last[0].strip("*` ") == "[]": return 1, "[] with explanation"
    return 0, "wrong"

def q7(t): return exact_or_contains(t, "A G C F D E B")

def q8(t):
    c = clean(t); n = len(re.sub(r"\s", "", c))
    race = re.search(r"sum", c) and re.search(r"競|race|原子|同步|並發|并发", c, re.I)
    # wrong if it blames the loop variable n as a problem (Go 1.22 gives each iteration its own n)
    blames_n = re.search(r"(迴圈|循环|循環)?變?數?\s*n\b[^。；;]{0,20}(共享|捕獲|捕获|閉包|闭包|都是最後|全部相同)", c) and \
               not re.search(r"n[^。；;]{0,25}(不是問題|不是问题|無問題|无问题|已修正|已修复|不受影響|非問題|没有问题|沒有問題|Go ?1\.22)", c)
    if not race or blames_n: return 0, "misses the sum race or blames n"
    return (2, f"{n} chars") if n <= 60 else (1, f"{n} chars > 60")

def q9(t):
    c = clean(t)
    if not re.search(r"無法唯一確定|无法唯一确定|無法唯一|cannot be uniquely", c): return 0, "no 'cannot determine'"
    if re.search(r"(原始字串|答案|原文)(就)?是\s*[\"「`]?test", c): return 0, "asserts 'test'"
    return 2, "cannot determine"

def run_q10(code):
    ns = {}; exec(code, ns); f = ns["single_number"]
    import random
    cases = [([6, 1, 3, 3, 3, 6, 6], 1), ([-2, -2, -2, -7], -7), ([5], 5), ([0, 0, 0, -1], -1),
             ([2**70] * 3 + [-3], -3), ([4, 4, 4, -(2**65) + 1], -(2**65) + 1)]
    rnd = random.Random(7)
    for _ in range(300):
        xs = rnd.sample(range(-10**9, 10**9), 5); u = rnd.randint(-10**9, 10**9)
        if u in xs: continue
        a = [x for x in xs for _ in range(3)] + [u]; rnd.shuffle(a); cases.append((a, u))
    return sum(f(a) != e for a, e in cases), len(cases)

def q10(t):
    code = code_block(t)
    if not code: return 0, "no code"
    try: bad, n = run_q10(code)
    except Exception as e: return 0, f"error {type(e).__name__}"
    if bad: return 0, f"fails {bad}/{n}"
    after = t.split("```")[-1].strip()
    sentences = [s for s in re.split(r"[。.!?！？]\s*", after) if s.strip()]
    return (2, f"passes {n}") if len(sentences) <= 2 else (1, f"passes {n}, {len(sentences)} sentences after code")

def q11(t): return exact_or_contains(t, "IMPOSSIBLE")
def q12(t): return exact_or_contains(t.replace("->", "→"), "3 | A→C→E", lambda s: re.sub(r"\s+", "", s))
q13 = number("5")

def q14(t):
    c = clean(t); m = re.search(r"return\s+(.+)", c)
    if not m: return 0, "no return"
    expr = m.group(1).strip()
    try: fn = eval("lambda user: " + expr)
    except Exception: return 0, "not a valid expression"
    import itertools
    for a, s, r, o in itertools.product([True, False], [True, False], ["admin", "editor"], [True, False]):
        u = {"active": a, "suspended": s, "role": r, "owns_resource": o}
        if bool(fn(u)) != (a and not s and (r == "admin" or o)): return 0, f"wrong for {u}"
    return (2, "single correct return") if len([l for l in c.splitlines() if l.strip()]) == 1 else (1, "correct with extra text")

def q15(t):
    c = clean(t); want = ["run_test", "search_docs", "read_doc", "edit_file", "run_test", "restart_service"]
    got = re.findall(r"(run_test|search_docs|read_doc|edit_file|restart_service)", c)
    if got != want: return 0, f"chain {got}"
    if "(" in c: return 1, "parameters included"
    return (2, "exact") if len(c) <= 90 else (1, "correct with extra text")

def q16(t):
    c = clean(t)
    try:
        if json.loads(c) == ["a", "c", "d", "b"]: return 2, "exact"
    except Exception: pass
    return (1, "correct with extra text") if re.search(r'\[\s*"a"\s*,\s*"c"\s*,\s*"d"\s*,\s*"b"\s*\]', c) else (0, "wrong")

def q17(t): return exact_or_contains(t, "[DENY,ALLOW,DENY]", lambda s: re.sub(r"\s+", "", s))
q18 = number("12")

def q19(t):
    c = clean(t)
    rc = re.search(r"ROOT_CAUSE\s*=\s*(.+)", c); fx = re.search(r"FIX\s*=\s*(.+)", c)
    if not rc or not fx: return 0, "format"
    rc, fx = rc.group(1).strip(), fx.group(1).strip()
    words_ok = len(rc.split()) <= 12 and len(fx.split()) <= 12
    rc_ok = re.search(r"retr", rc, re.I) and re.search(r"idempot|dedup|duplicate|non-?idempotent", rc, re.I)
    fx_ok = re.search(r"idempot|dedup", fx, re.I) and not re.search(r"disable retr|no retr", fx, re.I)
    if rc_ok and fx_ok: return (2, "both") if words_ok else (1, "both, over 12 words")
    return (1, "only one part right") if (rc_ok or fx_ok) else (0, "wrong")

def q20(t):
    code = code_block(t)
    if not code: return 0, "no code"
    if re.search(r"\bint\s*\(|float\s*\(|Decimal", code): return 0, "uses forbidden conversion"
    T = [("1.0", "1", 0), ("1.0.0", "1", 0), ("1.0002", "1.2", 0), ("1.10", "1.2", 1), ("0001.0000003", "1.3", 0), ("2", "10", -1),
         ("1.2", "1.10", -1), ("1.0.1", "1", 1), ("0", "0.0.0", 0), ("1.01", "1.001", 0), ("10.0", "9.99", 1), ("1.0.0.0.1", "1", 1)]
    try:
        ns = {}; exec(code, ns); g = ns["compare_versions"]
        bad = [x for x in T if g(x[0], x[1]) != x[2]]
        big = "1" + "0" * 100000
        if g(big, "9" * 100000) != 1 or g("000" + big, big) != 0: bad.append("100k")
    except Exception as e: return 0, f"error {type(e).__name__}"
    return (0, f"fails {bad}") if bad else (2, "passes 12 + 100k")

RULES = {"Q1": q1, "Q2": q2, "Q3": q3, "Q4": simple("13/27"), "Q5": q5, "Q6": q6, "Q7": q7, "Q8": q8, "Q9": q9, "Q10": q10,
         "Q11": q11, "Q12": q12, "Q13": q13, "Q14": q14, "Q15": q15, "Q16": q16, "Q17": q17, "Q18": q18, "Q19": q19, "Q20": q20}
REVIEW = {"Q8", "Q9"}

def grade(paths):
    rows = {}
    for p in paths:
        for q, r in json.load(open(p)).items():
            if r.get("finish") == "length" or not (r.get("content") or "").strip():
                s, why = 0, f"empty/truncated (finish={r.get('finish')})"
            else:
                s, why = RULES[q](r["content"])
            rows[q] = {"score": s, "why": why, "tok": r.get("tok"), "review": q in REVIEW}
    return rows

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("files", nargs="+"); ap.add_argument("--out")
    a = ap.parse_args()
    rows = grade(a.files)
    for q in sorted(rows, key=lambda k: int(k[1:])):
        r = rows[q]; print(f"{q:4} {r['score']}  {'[review] ' if r['review'] else ''}{r['why']}")
    total = sum(r["score"] for r in rows.values()); print(f"total {total}/{2 * len(rows)}")
    if a.out: json.dump({"total": total, "max": 2 * len(rows), "items": rows}, open(a.out, "w"), ensure_ascii=False, indent=1)
