import json,urllib.request,sys,time
src=open("harness/eval_10q_b.py").read(); s=src.index("\nQ = ["); e=src.index("\n]\n",s)+3; ns={}; exec(src[s:e],ns); Q={q:p for q,p,_ in ns["Q"]}
rows=[]
for i in range(int(sys.argv[2])):
    body={"messages":[{"role":"user","content":Q["Q13"]}],"max_tokens":16000,"temperature":0,"seed":3407,"cache_prompt":False}
    d=json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8090/v1/chat/completions",json.dumps(body).encode(),{"Content-Type":"application/json","Authorization":"Bearer eval-key"}),timeout=900))
    r={"run":i+1,"completion_tokens":d["usage"]["completion_tokens"],"answer":(d["choices"][0]["message"].get("content") or "").strip()[:20],"draft_n":d["timings"].get("draft_n"),"draft_accepted":d["timings"].get("draft_n_accepted")}; rows.append(r); print(sys.argv[1], r, flush=True)
json.dump({"condition":sys.argv[1],"what":"Q13 from a freshly started server, temperature 0, seed 3407, cache off","date":time.strftime("%Y-%m-%d %H:%M"),"runs":rows},
          open(f"results/qwen38-27b-iq3s/determinism-2026-10/q13-fresh-{sys.argv[1]}.json","w"),ensure_ascii=False,indent=1)
