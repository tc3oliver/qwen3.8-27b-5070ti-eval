# Qwen3.8-27B on RTX 5070 Ti — does the fastest recipe also win on quality?

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

![Protocol: pre-registered](https://img.shields.io/badge/protocol-pre--registered-2ea44f)
![GPU: RTX 5070 Ti 16 GB](https://img.shields.io/badge/GPU-RTX%205070%20Ti%2016%20GB-76b900)
![Runtime: llama.cpp + recipe v3](https://img.shields.io/badge/runtime-llama.cpp%20%2B%20recipe%20v3-blue)
[![License: Apache-2.0 / CC BY 4.0](https://img.shields.io/badge/license-Apache--2.0%20%7C%20CC%20BY%204.0-lightgrey)](LICENSE-CONTENT.md)

The [feveromo recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) runs a 27B model on a 16 GB card;
its author reports 1.9× the decode speed of stock llama.cpp on real agent sessions with the same weights
([C01](EVIDENCE-INDEX.md)). Speed was never the open question. This repository asks the other one: on a single
RTX 5070 Ti, measured on coding, agents, long Chinese documents and latency, is it the model you should run? And
what does it take to measure that honestly on a desktop GPU?

**Status: round 1 (2026-10-03).** The subject has a complete, valid run; the first competitor's run was invalidated
by VRAM spill and is being repeated. Round 1 therefore contains **no comparative claim**, only measurements of the
subject and what we learned about measuring on this card.

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif" width="820" alt="The Pi coding agent driven by Qwen3.8-27B on an RTX 5070 Ti, writing the dashboard below">
</p>

<p align="center"><i>The <a href="https://github.com/badlogic/pi-mono">Pi</a> coding agent, driven by the local model,
building a dashboard of this study's own results in 5 min 20 s; it passes 20/20 checks of a grader validated
against a reference solution (one run, level B — <a href="EVIDENCE-INDEX.md">E30, E31</a>):</i></p>

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/desktop-light.png" width="820" alt="Dashboard built by the local model">
</p>

**Video (61 s):** [round-1 explainer](media/qwen38-5070ti-round1.mp4), rendered frame by frame in TypeScript + three.js; every number on screen carries its evidence ID ([`video/`](video/)).

<p align="center"><a href="media/qwen38-5070ti-round1.mp4"><img src="media/qwen38-5070ti-round1-poster.png" width="820" alt="Round-1 explainer video"></a></p>

## What we found

Every claim cites [`EVIDENCE-INDEX.md`](EVIDENCE-INDEX.md), which points at the raw data. **A** = measured under the
pre-registered protocol; **B** = measured here outside it (context, not ranking); see [`EVIDENCE.md`](EVIDENCE.md).

1. **On one 16 GB card the subject scores 92.1 % on HumanEval+** (151/164, 95 % CI 86.9–95.3), finds all 10
   planted bugs with the right cause, completes 12/12 tool-calling episodes without a malformed call, recalls all
   four facts planted in a 60K-token Chinese document, and starts answering everyday Chinese prompts after 1.45 s
   (p50). [E01–E07, A]
2. **The same model writes code about twice as fast as it writes Chinese prose.** Decode speed follows how many of
   the speculative-decoding drafts are accepted: on HumanEval+ the median acceptance was 0.74 and decode 155 tok/s;
   on Chinese explanations and summaries acceptance was 0.28–0.41 and decode 74–81 tok/s. The draft vocabulary that
   ships with the recipe is ranked from English text and code. [E09, A — correlation within one run]
3. **On one prompt, temperature 0 did not reproduce the output.** With the recipe's adaptive draft length, the same
   request to a freshly started server came back as 885, 918, 1,219, 962 and 918 tokens. With the draft length
   fixed it was 3,080 tokens five times out of five, and a server that had been running (still adaptive) for hours
   gave exactly that output — we infer its controller had settled on the same width; widths were not logged. The
   two paths reached different answers (5 and 7). One prompt, five runs per condition. [E25, B]
4. **"It loaded" is not "it works".** At 131,072 tokens of context the subject loads and decoded a test request at
   5.9 tok/s; at 122,880 the shared-memory counter read 485 MiB and decode was 6–8 tok/s, which we attribute to the
   Windows driver placing the overflow in system RAM. 64K is the largest healthy setting. A MoE competitor passed the
   settings check, then spilled further mid-run and swung between 99 and 27 tok/s; its run was declared invalid and
   excluded from the comparison (outputs kept), and the harness now samples spill every minute. [E21, E23, B]
5. **A preliminary hint on thinking budgets.** In a single-run sweep on our reasoning set (4× token budget), the
   vendor-default effort `xhigh` used 25,688 tokens and scored 30/40; effort `medium` plus a one-line short-think
   instruction used 9,878 tokens and scored 35/40. Five `xhigh` answers hit the token cap, and the same `medium`
   setting scored 33/40 in the round-1 run. This shows token cost; it is not a proven quality ranking. [E24, B]

## Round 1 results (2026-10-03)

| | Qwen3.8-27B IQ3_S + MTP (subject) | Ornith-1.5-35B-A3B (MoE) |
|---|---:|---:|
| Evidence | **A** | **B** — run invalidated by VRAM spill |
| HumanEval+ pass@1 (164) | **92.1 %** (86.9–95.3) | — (stopped at 32/164) |
| 10Q reasoning, 1 run | 33/40, 11,886 tokens | 32/40, 57,346 tokens |
| Code review (10 planted bugs) | 10/10 | 10/10 |
| Agent tool calling | 12/12, 0 malformed | 12/12, 0 malformed |
| Long-context recall 16K / 32K / 60K | 4/4 · 4/4 · 4/4 | 4/4 · 4/4 · 4/4 |
| 60K prompt: prefill, first token | 1,689 tok/s, 39.4 s | not valid |
| Everyday Chinese prompts: first answer token p50 / p90 | 1.45 s / 2.46 s | not valid |
| Decode, Chinese prose / code | 88.5 tok/s mean (74–106) / 155 tok/s median | not valid |

**Coding agent, one run (level B):** Pi + the subject built the dashboard task in 320 s: 28 turns, 27 tool calls,
0 tool errors, 25,678 output tokens, 20/20 grader checks ([E30](EVIDENCE-INDEX.md)).

Raw results: [`results/`](results/) · combined table: [`results/arena-2026-10-summary.md`](results/arena-2026-10-summary.md).
Four more configurations (official non-abliterated weights, the Unsloth quant, Muse-Glimmer-30B, Ornith-1.5-9B)
have frozen settings and are queued; the Ornith-35B rerun uses its next pre-registered setting. Already measured in
the settings search: the community-default Unsloth UD-Q3_K_XL (13.15 GB, stock llama.cpp) spilled 452–484 MiB at
48K and 64K and was usable only at 32K, while the recipe's IQ3_S (12.12 GB) fits 64K; file size is one of several
differences between the two setups, and quality was not measured. [E20, A]

## How it is measured

- **Pre-registered.** [`PROTOCOL.md`](PROTOCOL.md) fixed the suites, the settings search and the definition of
  "best" before any comparison run; every later change and deviation is logged there with its reason, and invalid
  runs stay in the repository.
- **Settings per model.** Each model runs its model card's sampler and reasoning mode (except the subject and its
  official-weights control, which use the tuned effort-`medium` + short-think setting; see Limits), and the first
  context size on a fixed list, starting at 64K, that loads with at most 300 MiB of spill as read from the Windows
  driver's counters. Speculative decoding follows each model's own published usage. Settings are frozen in
  `frozen.json` before the suites.
- **Suites.** HumanEval+ (all 164, executed), 20 hand-written Chinese reasoning questions graded by code,
  10 planted-bug code reviews, multi-turn tool calling with real tool execution and leak detection, needle recall
  in 16K–60K-token Traditional-Chinese Wikipedia text, streaming latency on everyday Chinese prompts, and a
  coding-agent task with a browser-based grader.
- **Graders are tested before they are trusted.** The HumanEval+ checker passes all 164 canonical solutions
  [E32]; the six Python/SQL planted bugs reproduce when run (the four JS/Go/C ones were not executed) [E33]; the
  10Q grader agrees with earlier hand grading on one run and differs on one item (Q8) on another, documented in
  `PROTOCOL.md`; Q8 and Q9 are flagged for human review and counted unreviewed in 33/40; the dashboard grader
  passes a reference solution 20/20 and catches all six defects planted in a broken copy [E31].

## Reproduce

```bash
git clone https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval && cd qwen3.8-27b-5070ti-eval
data/fetch.sh                                   # HumanEval+ (checksum verified)
data/fetch_models.sh ~/models                    # pinned GGUF revisions, SHA-256 verified
# build llama.cpp: the recipe's instructions for the subject, stock master for the others (ENVIRONMENT.md)
python3 harness/run_arena.py --quick qwen38-27b-iq3s   # --quick = round 1's time-boxed subset; omit for the full scope
python3 harness/summarize.py                           # results/<run>-summary.md
```

Build paths are set at the top of `harness/run_arena.py`. The runner stops a production service named `llm-chat`
while it runs and restarts it afterwards. Change `PROD_SERVICE` if yours differs.

## Limits and known biases

- One machine, Windows 11 + WSL2, with the desktop sharing the card: absolute speeds and context limits are lower
  than on bare Linux (the recipe's author reaches 128K there [C01, published, not re-checked]).
- Round 1 is time-boxed: one run of 10Q and code review, 12 agent episodes, 10 latency prompts; HumanEval+ is one
  sample per task at the production sampler (temperature 1.0), not greedy; the 60K item ran with `max_tokens` 4,967.
- The subject's reasoning setting was tuned on the 10Q set before the protocol, which favours it on 10Q; the 10Q
  questions were written on this machine while testing earlier models; HumanEval+ may be in training data.
- The subject's spill was sampled only before and after its run; the one-minute monitor was added afterwards.
- The dashboard grader was tightened twice after the Pi run (18/18 → 19/19 → 20/20); TASK.md gave the model every
  selector, so only the grader code was hidden. 1 of 10 latency answers drifted into Simplified Chinese.
- Gemma-4-26B-A4B and gpt-oss-20b were not measured (no further downloads); published numbers are in the
  candidate survey.

## Credits

Build, CUDA patch, launch flags and draft vocabulary:
[feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) (not redistributed
here). Weights: [huihui-ai](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF),
[ISTA-DASLab](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF), [Unsloth](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF),
[SC117](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF). Coding agent: [Pi](https://github.com/badlogic/pi-mono).
Benchmark: [EvalPlus HumanEval+](https://github.com/evalplus/evalplus). Filler text: Chinese Wikipedia (CC BY-SA 4.0).

## License and citation

Code under Apache-2.0; prose, results and hand-written data under CC BY 4.0 ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)).
If you use the results, please cite [`CITATION.cff`](CITATION.cff) and carry the evidence level with the number.
