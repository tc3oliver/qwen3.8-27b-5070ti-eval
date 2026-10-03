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
| E07 | Everyday Chinese prompts (10) | first answer token p50 1.45 s / p90 2.46 s; full answer p50 4.86 s / p90 8.11 s; decode 88.5 tok/s | A | `…/arena-2026-10/latency.json` |
| E08 | VRAM spill during the run | 168 MiB at start and end (limit 300) | A | `…/arena-2026-10/frozen.json`, `spill_end.json` |

## Competitors and setup findings

| ID | Claim | Value | Level | Source |
|---|---|---|---|---|
| E20 | Unsloth UD-Q3_K_XL (13.15 GB) context on this machine | fits 32K only; 64K and 48K spill 452–484 MiB | A | `results/qwen38-27b-unsloth-q3kxl/arena-2026-10/frozen.json` (`tried`) |
| E21 | Ornith-1.5-35B-A3B passed the settings check, then spilled mid-run | shared memory 294 → 359 MiB; decode ~99 tok/s, falling to ~27 tok/s in two windows | B (invalid run) | `results/ornith-1.5-35b-a3b-apex/arena-2026-10/invalid-spill-1/INVALID.md`, `decode-over-time.txt` |
| E22 | Ornith-1.5-35B-A3B 10Q (from the invalid run; correctness is unaffected by speed) | 32/40 using 57,346 tokens (4.8× the subject) | B | `…/invalid-spill-1/10q_grades_r1.json` |
| E24 | Reasoning effort: `medium` + short-think vs the vendor default `xhigh` (10Q, 4× budget, 1 run each) | 35/40 with 9,878 tokens vs 30/40 with 25,688 tokens (38 % of the tokens); thinking off 16/40 | B (preliminary) | `results/qwen38-27b-iq3s/2026-10-03-prelim/effort-sweep.md` |
| E25 | Identical temperature-0 request from a fresh server: adaptive MTP vs fixed draft length 5 | adaptive: 885–1,219 tokens across 5 runs (answer 5); fixed: 3,080 tokens ×5 (answer 7); a long-running adaptive server reproduces the fixed output exactly | B (dedicated experiment, 1 prompt) | `results/qwen38-27b-iq3s/determinism-2026-10/README.md` |
| E23 | 128K context on this machine (subject) | loads, then decodes 5.9 tok/s (spill 484 MiB); 64K is the largest healthy setting | B (preliminary) | `results/qwen38-27b-iq3s/2026-10-03-prelim/ctx-sweep/summary.txt` |

## Pending evidence (do not quote yet)

| ID | Claim | Status |
|---|---|---|
| T03 | Pi coding agent builds the dashboard task | run in progress (`results/qwen38-27b-iq3s/pi-2026-10/`) |

## Published elsewhere (level C)

| ID | Claim | Source |
|---|---|---|
| C01 | Recipe v3: real agent sessions decode 147.2 tok/s, prefill 2,177 tok/s; 128K on bare Linux at 14,530 MiB peak | [feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) (2026-09-28) |
| C02 | Vendor and community numbers for the unmeasured candidates (Gemma-4-26B-A4B, gpt-oss-20b, …) | `reports/candidate-survey.md` |
