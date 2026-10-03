#!/usr/bin/env python3
"""Shows that the planted bugs in data/code_review.json are real by running the Python and SQL snippets on inputs
that expose them. (The JavaScript, Go and C snippets are not executed here.) Writes harness/tests/code_review_bugs_check.json."""
import json, os, sqlite3, sys, threading
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
items = {i["id"]: i for i in json.load(open(os.path.join(ROOT, "data/code_review.json")))}
out = {}
ns = {}; exec(items["py-binary-search-bound"]["code"], ns)
try: ns["binary_search"]([1, 3, 5], 9); out["py-binary-search-bound"] = "no error (bug NOT shown)"
except IndexError as e: out["py-binary-search-bound"] = f"binary_search([1,3,5], 9) raises IndexError: {e}"
ns = {}; exec(items["py-mutable-default"]["code"], ns); out["py-mutable-default"] = f"make_labels(['A','B']) -> {ns['make_labels'](['A','B'])} (expected [['a'], ['b']])"
ns = {}; exec(items["py-remove-while-iterating"]["code"], ns); S = ns["Session"]
out["py-remove-while-iterating"] = f"purge_expired([exp, exp, live]) leaves {[s.id for s in ns['purge_expired']([S('1',True),S('2',True),S('3',False)])]} (expected ['3'])"
ns = {}; exec(items["py-lock-check-then-act"]["code"], ns); c = ns["Counter"](); sys.setswitchinterval(1e-6)
ts = [threading.Thread(target=lambda: [c.incr("k") for _ in range(20000)]) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
out["py-lock-check-then-act"] = f"8 threads x 20000 incr -> {c.get('k')} (expected 160000)"
db = sqlite3.connect(":memory:"); db.executescript("create table customers(id,name); create table orders(customer_id); insert into customers values(1,'a'),(2,'b'); insert into orders values(1),(NULL);")
out["sql-not-in-null"] = f"customers without orders -> {db.execute(items['sql-not-in-null']['code'].split(chr(10),2)[2]).fetchall()} (expected [(2, 'b')])"
ns = {}; exec(items["py-sql-injection"]["code"], ns); db2 = sqlite3.connect(":memory:"); db2.executescript("create table users(id,name,email); insert into users values(1,'amy','a@x'),(2,'bob','b@x');")
out["py-sql-injection"] = f"find_user(\"x' OR '1'='1\") -> {ns['find_user'](db2, chr(120)+chr(39)+' OR '+chr(39)+'1'+chr(39)+'='+chr(39)+'1')} (any row returned = injection)"
out["not executed"] = ["js-foreach-async", "go-defer-in-loop", "c-malloc-nul", "js-assignment-in-if"]
json.dump(out, open(os.path.join(ROOT, "harness/tests/code_review_bugs_check.json"), "w"), ensure_ascii=False, indent=1)
for k, v in out.items(): print(k, ":", v)
