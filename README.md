# Qwen3.8-27B on RTX 5070 Ti — does the fastest recipe also win on quality?

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

![Evidence: pre-registered](https://img.shields.io/badge/protocol-pre--registered-2ea44f)
![Hardware: RTX 5070 Ti 16 GB](https://img.shields.io/badge/GPU-RTX%205070%20Ti%2016%20GB-76b900)
![Runtime: llama.cpp](https://img.shields.io/badge/runtime-llama.cpp%20%2B%20recipe%20v3-blue)
[![License: Apache-2.0 / CC BY 4.0](https://img.shields.io/badge/license-Apache--2.0%20%7C%20CC%20BY%204.0-lightgrey)](LICENSE-CONTENT.md)

The [feveromo recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) makes a 27B model decode at about
twice the speed of stock llama.cpp on a 16 GB card. Speed was never the open question. This repository asks the
other one: on a single RTX 5070 Ti, measured end to end — coding, agents, long Chinese documents, real latency —
is it the model you should run? And what does it take to measure that honestly on a desktop GPU?

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif" width="820" alt="Pi coding agent driven by Qwen3.8-27B on an RTX 5070 Ti, writing the dashboard below">
</p>

<p align="center"><i>The <a href="https://github.com/badlogic/pi-mono">Pi</a> coding agent driven by the local model,
building a dashboard of this study's own results. It finished in 5 min 20 s and passed 20/20 hidden browser
checks (<a href="EVIDENCE-INDEX.md">E30</a>):</i></p>

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/desktop-light.png" width="820" alt="Dashboard built by the local model">
</p>

## What we found

Every claim links to its entry in [`EVIDENCE-INDEX.md`](EVIDENCE-INDEX.md), which points at the raw data. Evidence
levels: **A** measured under the pre-registered protocol · **B** measured here outside it (context only) — see
[`EVIDENCE.md`](EVIDENCE.md).

1. **Temperature 0 is not enough to reproduce an answer.** With the recipe's adaptive speculative decoding, the
   same request to a freshly started server came back as 885, 918, 1,219, 962 and 918 tokens. With the draft
   length fixed it was 3,080 tokens five times out of five — and a server that had been running for hours gave
   that same fixed-length output exactly. The two paths even reached different answers to the same question
   (5 and 7). A one-shot benchmark of such a server samples its warm-up state. [E25, B]
2. **One 16 GB card, one 27B model, a real coding workload.** HumanEval+ 151/164 (92.1 %, 95 % CI 86.9–95.3),
   10 of 10 planted bugs found with the right cause, 12 of 12 tool-calling episodes with no malformed call, all
   four facts recalled from a 60K-token Chinese document, first answer token after 1.45 s (p50) on everyday
   Chinese prompts at 88.5 tok/s. [E01–E07, A]
3. **"It loaded" is not "it works" — and not "it keeps working".** At 128K context the model loads and then
   decodes at 5.9 tok/s, because Windows silently pages the overflow into system RAM. A MoE competitor passed the
   settings check at 294 MiB of spill, then spilled further mid-run and swung between 99 and 27 tok/s; its run
   was thrown out, and the harness now samples spill every minute. [E21, E23, B]
4. **The vendor's default thinking budget was the worst-value setting.** Effort `medium` plus a one-line
   short-think instruction scored 35/40 on our reasoning set with 9,878 tokens; the vendor default `xhigh` scored
   30/40 with 25,688. [E24, B]
5. **Quant size buys context, not just quality.** The community-default Unsloth UD-Q3_K_XL is 1 GB larger than
   the recipe's IQ3_S, and on this card that is the difference between 64K and 32K of usable context. [E20, A]

## Results so far (round 1, 2026-10-03)

| | Qwen3.8-27B IQ3_S + MTP (subject) | Ornith-1.5-35B-A3B (MoE) |
|---|---:|---:|
| Evidence | **A** | **B** — run invalidated by VRAM spill |
| HumanEval+ pass@1 (164) | **92.1 %** (86.9–95.3) | — (stopped at 32/164) |
| 10Q reasoning, 1 run | 33/40, 11,886 tokens | 32/40, 57,346 tokens |
| Code review (10 planted bugs) | 10/10 | 10/10 |
| Agent tool calling | 12/12, 0 malformed | 12/12, 0 malformed |
| Long-context recall 16K / 32K / 60K | 4/4 · 4/4 · 4/4 | 4/4 · 4/4 · 4/4 |
| 60K prompt: prefill, first token | 1,689 tok/s, 39.4 s | not valid |
| Everyday prompts: first answer token p50 / p90 | 1.45 s / 2.46 s | not valid |
| Decode | 88.5 tok/s | not valid |
| Pi agent builds the dashboard | 320 s, 20/20 checks | not run |

Raw results: [`results/`](results/) · combined table: [`results/arena-2026-10-summary.md`](results/arena-2026-10-summary.md).
Four more configurations (official non-abliterated weights, Unsloth quant, Muse-Glimmer-30B, Ornith-1.5-9B) have
frozen settings and are queued; the Ornith-35B rerun uses the next pre-registered setting.

## How it is measured

- **Pre-registered.** [`PROTOCOL.md`](PROTOCOL.md) fixed the suites, the settings search and the definition of
  "best" before any comparison run; every later change is logged there with its reason, and invalid runs stay in
  the repository.
- **Every model on its own best footing.** Each runs its model card's sampler and reasoning mode, the largest
  context that fits without spilling (checked against the Windows driver's counters, not just "it loaded"), and
  its own speculative decoding if it ships one. Settings are frozen per model in `frozen.json` before the suites.
- **Suites.** HumanEval+ (all 164, executed), 20 hand-written Chinese reasoning questions graded by code,
  10 planted-bug code reviews, multi-turn tool calling with real tool execution and leak detection, needle recall
  in 16K–60K-token Traditional-Chinese Wikipedia text, streaming latency on everyday prompts, and a coding-agent
  task with hidden browser tests.
- **Graders are tested before they are trusted.** HumanEval+'s checker passes all 164 reference solutions; every
  planted bug is reproduced; the 10Q grader matches earlier hand grading; the dashboard grader passes a reference solution 20/20 and
  catches all six defects planted in a broken copy.

## Reproduce

```bash
git clone https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval && cd qwen3.8-27b-5070ti-eval
data/fetch.sh                                   # HumanEval+ (checksum verified)
data/fetch_models.sh ~/models                    # pinned GGUF revisions, SHA-256 verified
# build llama.cpp: the recipe's instructions for the subject, stock master for the others (ENVIRONMENT.md)
python3 harness/run_arena.py --quick qwen38-27b-iq3s      # settings search + all suites for one model
python3 harness/summarize.py                              # results/<run>-summary.md
```

Paths to the builds are set at the top of `harness/run_arena.py`; the runner stops a production service named
`llm-chat` while it runs and restarts it afterwards — change `PROD_SERVICE` if yours differs.

## Limits and known biases

- One machine, Windows 11 + WSL2, with the desktop sharing the card: absolute speeds and context limits are lower
  than on bare Linux (the recipe reaches 128K there).
- Round 1 is time-boxed: one run of 10Q and code review, 12 agent episodes, 10 latency prompts.
- The subject's reasoning setting was tuned on the 10Q set before the protocol, which favours it on 10Q.
- The 10Q questions were written on this machine while testing earlier models; HumanEval+ may be in training data.
- Gemma-4-26B-A4B and gpt-oss-20b were not measured (no further downloads); see the candidate survey for
  published numbers.

## Credits

Build, CUDA patch, launch flags and draft vocabulary:
[feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) (not redistributed
here). Weights: [huihui-ai](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF),
[ISTA-DASLab](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF), [Unsloth](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF),
[SC117](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF). Coding agent: [Pi](https://github.com/badlogic/pi-mono).
Benchmark: [EvalPlus HumanEval+](https://github.com/evalplus/evalplus). Filler text: Chinese Wikipedia (CC BY-SA 4.0).

## License and citation

Code under Apache-2.0, prose, results and hand-written data under CC BY 4.0 ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)).
If you use the results, please cite [`CITATION.cff`](CITATION.cff) and carry the evidence level with the number.
