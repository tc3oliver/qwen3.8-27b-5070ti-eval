# Evaluation protocol (pre-registered)

Written on 2026-10-03, **before** any comparison run. Changes after the first comparison result must be
recorded in the changelog at the bottom with the reason, and all earlier results stay published.

## Question

Is Huihui-Qwen3.8-27B-abliterated GSQ-RCO IQ3_S + MTP (feveromo v3 recipe) the best local LLM for a single
RTX 5070 Ti 16 GB under llama.cpp, for three uses: **coding / code review**, **agentic tool calling**, and
**Chinese Q&A over long documents**?

The study is framed as a test, not a proof. Results are reported whichever way they go.

## Candidates

- The subject: Qwen3.8-27B GSQ-RCO IQ3_S + MTP, recipe v3 build (see `configs/`).
- Competitors: the strongest models the community currently runs on 16 GB cards, chosen from a documented
  survey (`reports/candidate-survey.md`) **before** testing. The selection and the reason for each exclusion
  are recorded there.

Every model runs with **its own best known configuration** on the same machine: recommended sampler, its
recommended thinking/reasoning mode, the largest context that fits without spilling VRAM to system RAM
(checked with the spill test below), full GPU offload unless the model is MoE and the community setup uses
partial offload. Each configuration is a file in `configs/` and is frozen before its runs.

## Environment

One machine, recorded in `ENVIRONMENT.md`. Windows 11 + WSL2; the Windows desktop holds part of the VRAM, so
usable VRAM is lower than on bare Linux. Every run logs free VRAM before start and the WSL VM's shared-memory
spill after load; **a run with spill > 300 MiB is invalid** and is redone at a smaller context.

## Suites and metrics

| Suite | What | Metric | Notes |
|---|---|---|---|
| Coding | HumanEval+ (evalplus v0.1.10), all 164 tasks | pass@1 (base + plus tests) | code executed in a subprocess, 60 s/task |
| Reasoning (zh) | 10Q Set A + Set B (20 hand-written Chinese questions) | score /40, strict rubric | 3 repeats, report mean and range |
| Code review | 10 snippets with one planted bug each | bug found (line + cause) | rubric fixed in the dataset file |
| Agent | 6 tool scenarios × 5 repeats, interleaved | task success; malformed tool calls; cross-request leakage; server errors | real tool execution with fake data |
| Long context (zh) | 4 facts planted at 10/40/70/95 % depth in 16K / 32K / ~60K-token Chinese documents | facts recalled exactly | sizes above a model's max context are reported as "n/a", not 0 |
| Latency (zh) | 20 everyday Chinese prompts | time to first token, time to first answer token, total time (p50 / p90); decode tok/s; prefill tok/s | streaming; Simplified-Chinese drift rate recorded |

Generation settings for all suites: the server's production sampler, `max_tokens` 16000, prompt cache off
between independent items. Single-item differences are not interpreted; only suite-level numbers with repeats are (see the 2026-10-03
changelog entry on adaptive speculative decoding).

## What "best" means

1. A model is **best overall** only if no other candidate is better on any suite by more than the noise
   margin (HumanEval+: 95 % Wilson interval; other suites: non-overlapping repeat ranges) **and** its p50
   time-to-answer on the latency suite is within 1.5× of the fastest candidate.
2. Otherwise the report gives the **Pareto front** (quality per suite vs. latency) and states for which
   use each front model is the best choice. "Best on a 5070 Ti" is then claimed only per use.
3. Tool-calling reliability is a gate for the agent use: any model with server errors or malformed calls in
   more than 2 of 30 agent runs cannot be "best for agents" regardless of score.

## Reporting

All raw outputs (JSON per item), configs, logs, and scripts are committed. The report lists every run,
including failed and invalid ones. Known biases are listed: the 10Q questions were written while testing
earlier models on this machine; HumanEval+ may be in some models' training data (affects all candidates).

## Changelog

- 2026-10-03: protocol written.
- 2026-10-03 (before any comparison run): candidate set and configurations fixed — see
  `reports/candidate-survey.md` (Selection) and `configs/*/config.env`. Decisions recorded here:
  - **Settings search.** Each config lists candidate settings `ctx:kv:n_cpu_moe:ngl:spec` in a fixed order of
    preference (65,536 context first, then higher-precision KV, then fewer MoE expert layers on the CPU / fewer
    offloaded layers, speculation kept if possible). `harness/run_arena.py` uses the first candidate that loads,
    spills ≤ 300 MiB over the idle baseline, and answers a chat turn; it is frozen in `frozen.json` before the suites.
  - **Reasoning settings — known asymmetry.** Competitors run their model card's sampler and template-default
    reasoning level. The subject (and the official-weights control, to isolate abliteration) runs effort `medium`
    + short-think, a setting chosen on the 10Q suite before this protocol; this favours the subject on 10Q and
    is reported as such. The Unsloth Qwen3.8 config runs the vendor default (`xhigh`, stock llama.cpp, upstream
    MTP n=2) and shows Qwen3.8 without that tuning.
  - **Speculative decoding** follows each model's own published llama.cpp usage: recipe MTP (subject/control),
    upstream MTP n=2 (Unsloth), DFlash drafter (Muse); none for Ornith (its card's llama.cpp example has none),
    Gemma and gpt-oss.
  - **Uniform `max_tokens` 16000** for every suite item, including 10Q (whose per-question budgets are overridden).
- 2026-10-03 (still before any comparison run): **no further downloads** (owner's constraint). The measured set
  becomes the models already on this machine: the subject, the official-weights control, Unsloth UD-Q3_K_XL,
  Ornith-1.5-35B-A3B APEX-I-Mini (already downloaded), Muse-Glimmer-30B **UD-Q2_K_XL** (local file; a lower
  quant than the survey's IQ3_M and without its DFlash drafter — a disadvantage to Muse), and Ornith-1.5-9B
  Q6_K (this machine's previous production model). Gemma-4-26B-A4B and gpt-oss-20b are **not measured**;
  they appear only as published numbers. Results are graded by evidence level (`EVIDENCE.md`), and only
  level-A results can decide a ranking. The claim is therefore limited to "best among the measured models",
  with the unmeasured candidates listed. Preliminary Qwen3.8 numbers in `results/qwen38-27b-iq3s/2026-10-03-prelim/`
  were measured before this protocol and are kept for reference only; they are not part of the comparison.
- 2026-10-03, during settings search (no suite had run): **spill limit 200 → 300 MiB.** The first search
  (`results/arena-2026-10.sizing-attempt-1.log`, `results/*/arena-2026-10/sizing-attempt-1/`) measured the idle
  baseline with no CUDA process at 1 MiB, while every healthy loaded model reads 136–232 MiB (pinned host buffers
  such as `CUDA_Host` compute buffers count as shared memory). Two identical-architecture, same-size Qwen3.8 files
  landed at 168 and 232 MiB at 64K, so a 200 MiB cut decided their context by noise. Evidence for the new limit:
  healthy settings 136–232 MiB with normal decode; real spill 421–485 MiB with decode collapsing to 6–73 tok/s
  (`results/qwen38-27b-iq3s/2026-10-03-prelim/ctx-sweep/summary.txt`). 300 MiB separates the two groups. The
  settings search was rerun from scratch with the new limit.
- 2026-10-03, before any suite had run: **time-boxed first run (owner: about one hour).** Only the subject and
  Ornith-1.5-35B-A3B are measured now, with `run_arena.py --quick`: full HumanEval+ (164), long context (16K/32K/60K),
  one repeat of 10Q and code review, 12 agent episodes (6 scenarios × 2), 10 latency prompts. Repeat-based noise
  margins are therefore unavailable for 10Q and code review in this run; differences there are reported but not
  claimed. The other four frozen configurations are kept for a later run.
- 2026-10-03, during the time-boxed run: **10Q grading made automatic** (`harness/grade_10q.py`). Written after the
  subject's 10Q answers were generated but before any arena 10Q answer was read; validated on the hand-graded
  preliminary answers (agrees exactly on the short-think run; on the thinking-off run it differs on one item, Q8,
  where an answer that blames the loop variable `n` — not a bug in Go 1.22 — now scores 0 instead of the earlier
  hand-given 1; the rule applies to every model). A substring bug that scored "120" as a near-miss for "12" was
  fixed before any arena answer was graded. Q8 and Q9 stay flagged for human review.
- 2026-10-03, after the time-boxed run: **Ornith-1.5-35B-A3B run invalid (spill came and went during the run;
  `results/ornith-1.5-35b-a3b-apex/arena-2026-10/invalid-spill-1/INVALID.md`).** The settings search only checked
  spill at load time, so the runner now also samples it every 60 s during the suites; two consecutive samples over
  the limit stop the model, archive its outputs as `invalid-spill-N/`, mark the setting bad, and rerun from the
  next candidate. Ornith's next candidate is `65536:q8_0:4:all:0`. The subject's run (spill 168 MiB at start and
  end) is unaffected; it predates the monitor, which is noted in the report.
- 2026-10-03, after round 1 (no rule change, disclosures): **(a) correction** — temperature-0 variation comes from the
  recipe's *adaptive* draft length and the server's warm-up state, not from speculative decoding as such: a fixed
  draft length reproduces bit for bit (`results/qwen38-27b-iq3s/determinism-2026-10/`, EVIDENCE-INDEX E25).
  **(b) round-1 deviations** — the 60K long-context item ran with `max_tokens` 4,967 (the harness lowers it to fit
  65,536); HumanEval+ is one sample per task under each model's production sampler (temperature 1.0 for the subject),
  not greedy; the subject's spill was sampled only at start and end (the 60 s monitor came after its run).
  **(c) grader revisions after seeing results** — the dashboard grader was tightened twice after the Pi run
  (`harness/tests/dashboard/README.md`); every revision only made checks stricter.
