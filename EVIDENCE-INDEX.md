# Evidence index

Every number that may be quoted outside this repository (README, articles, cards, posts) is listed here with
its evidence level (`EVIDENCE.md`) and the file it comes from. Quote the ID's value as written; if a number is
not in this table, it is not ready to be quoted.

Correction 2026-10-03: an earlier note said temperature-0 variation came from MTP in general; E25 shows it comes from the *adaptive* draft length and the server's warm-up state.

Levels: **A** measured here under `PROTOCOL.md` · **B** measured here, outside the protocol or in an invalid run
(context only) · **C** published elsewhere · **todo** claimed but the raw evidence is not saved yet — do not quote.

## Subject: Qwen3.8-27B GSQ-RCO IQ3_S + MTP (recipe v3), 64K, RTX 5070 Ti under WSL2

| ID | Claim | Value | Level | Source |
|---|---|---|---|---|
| E01 | HumanEval+ pass@1 (164 tasks) | 151/164 = 92.1 % (95 % CI 86.9–95.3 %) | A | `results/qwen38-27b-iq3s/arena-2026-10/humanevalplus.json` |
| E02 | 10Q reasoning (20 Chinese questions, 1 run) | 33/40 using 11,886 tokens | A | `…/arena-2026-10/10q_grades_r1.json`, `10q_A_r1.json`, `10q_B_r1.json` |
| E03 | Code review, 10 planted bugs | 10/10 line and cause | A | `…/arena-2026-10/code_review.json` |
| E04 | Agent tool calling, 12 episodes | 12/12, 0 malformed calls, 0 server errors | A | `…/arena-2026-10/agent.json` |
| E05 | Long-context recall, 4 facts in Chinese text | 4/4 at 16K, 32K and 60K tokens | A | `…/arena-2026-10/longctx.json` |
| E06 | 60K-token prompt | prefill 1,689 tok/s, first token after 39.4 s | A | `…/arena-2026-10/longctx.json` |
| E07 | Everyday Chinese prompts (10) | first answer token p50 1.45 s / p90 2.46 s; full answer p50 4.86 s / p90 8.11 s; mean decode 88.5 tok/s (74–106) | A | `…/arena-2026-10/latency.json` |
| E09 | Decode speed follows the MTP draft acceptance rate, which depends on the content | HumanEval+ code: acceptance median 0.74, decode median 155 tok/s (p10 134, p90 177); Chinese explanations and summaries: acceptance 0.28–0.41, decode 74–81 tok/s; short coding prompts in Chinese: 0.39–0.53, 90–106 tok/s | A (correlation within one run) | `…/arena-2026-10/humanevalplus.json`, `latency.json` |
| E08 | VRAM spill during the run | 168 MiB at start and end (limit 300); sampled only before and after — the 60 s monitor was added after this run | A | `…/arena-2026-10/frozen.json`, `spill_end.json` |

## Competitors and setup findings

| ID | Claim | Value | Level | Source |
|---|---|---|---|---|
| E20 | Unsloth UD-Q3_K_XL (13.15 GB) context on this machine; the subject's IQ3_S file (12.12 GB) for comparison | Unsloth fits 32K only; 64K and 48K spill 452–484 MiB. IQ3_S (12,120,016,416 bytes) fits 64K | A | `results/qwen38-27b-unsloth-q3kxl/arena-2026-10/frozen.json` (`tried`); `results/qwen38-27b-iq3s/arena-2026-10/frozen.json`; file size in `configs/qwen38-27b-iq3s/README.md` |
| E21 | Ornith-1.5-35B-A3B passed the settings check, then spilled mid-run | shared memory 294 → 359 MiB; decode ~99 tok/s, falling to ~27 tok/s in two windows | B (invalid run) | `results/ornith-1.5-35b-a3b-apex/arena-2026-10/invalid-spill-1/INVALID.md`, `decode-over-time.txt` |
| E22 | Ornith-1.5-35B-A3B 10Q (from the invalid run; correctness is unaffected by speed) | 32/40 using 57,346 tokens (4.8× the subject) | B | `…/invalid-spill-1/10q_grades_r1.json` |
| E24 | Reasoning effort: `medium` + short-think vs the vendor default `xhigh` (10Q, 4× budget, 1 run each) | 35/40 with 9,878 tokens vs 30/40 with 25,688 tokens (38 % of the tokens); thinking off 16/40 | B (preliminary) | `results/qwen38-27b-iq3s/2026-10-03-prelim/effort-sweep.md` |
| E25 | Identical temperature-0 request from a fresh server: adaptive MTP vs fixed draft length 5 | adaptive: 885–1,219 tokens across 5 runs (answer 5); fixed: 3,080 tokens ×5 (answer 7); a long-running adaptive server gave the same length and answer as the fixed runs | B (dedicated experiment, 1 prompt) | `results/qwen38-27b-iq3s/determinism-2026-10/README.md` |
| E30 | Pi coding agent + subject builds the dashboard task from scratch (1 run, production server) | 320 s, 28 turns, 27 tool calls (read 2, bash 16, write 5, edit 4), 0 tool errors, 25,678 output tokens; hidden browser checks 20/20 on the third grader revision (18/18 → 19/19 → 20/20; each revision only tightened checks after the run). TASK.md gave the model every selector; only the grader code was hidden | B (dedicated experiment, 1 run) | `results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/summary.json`, `grade-v3/` |
| E31 | The dashboard grader separates correct from broken work | reference solution 20/20; copy with 6 injected defects 13/20, all 6 caught; reference and grader written by the same side; known gap for near-equal values | B | `harness/tests/dashboard/README.md` |
| E32 | HumanEval+ checker validity | passes all 164 canonical solutions | A | `harness/tests/humanevalplus_grader_check.json` |
| E33 | Code-review planted bugs are real | the 6 Python/SQL bugs reproduce when run; the 4 JS/Go/C bugs were not executed | A | `harness/tests/code_review_bugs_check.json` |
| E23 | Large contexts on this machine (subject) | 131,072: loads, one test request decoded at 5.9 tok/s; 122,880: shared memory 485 MiB, 6.2–7.7 tok/s; 98,304: 421 MiB, 41–74 tok/s; 65,536: 169 MiB, 86–92 tok/s. Overflow into system RAM is inferred from the shared-memory counter | B (preliminary) | `…/2026-10-03-prelim/ctx-sweep/summary.txt`, `qwen38-v3-128k.log` |

## Pending evidence (do not quote yet)

| ID | Claim | Status |
|---|---|---|

## Published elsewhere (level C)

| ID | Claim | Source |
|---|---|---|
| C01 | Recipe v3 (author's measurements): against stock llama.cpp on the same weights, real agent sessions decode 1.9× as fast and a 92.9K-token prompt 2.3× as fast; agent sessions 147.2 tok/s decode, 2,177 tok/s prefill; 128K on bare Linux at 14,530 MiB peak | [feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) (2026-09-28) |
| C02 | Vendor and community numbers for the unmeasured candidates (Gemma-4-26B-A4B, gpt-oss-20b, …) | `reports/candidate-survey.md` |
