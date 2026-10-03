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
spill after load; **a run with spill > 200 MiB is invalid** and is redone at a smaller context.

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
between independent items. Because speculative decoding makes even temperature-0 output non-deterministic,
single-item differences are not interpreted; only suite-level numbers with repeats are.

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

- 2026-10-03: protocol written. Preliminary Qwen3.8 numbers in `results/qwen38-27b-iq3s/2026-10-03-prelim/`
  were measured before this protocol and are kept for reference only; they are not part of the comparison.
