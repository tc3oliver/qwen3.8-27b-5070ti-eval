# Invalid run: VRAM spill came and went during the run

Setting `65536:q8_0:0:all:0` passed the settings search with 294 MiB of shared memory (limit 300). During the
suites the WSL VM's shared memory moved above the limit (359 MiB at 13:17). Decode speed per request of ≥ 200
tokens, by minutes since server start (`server.log`, `decode-over-time.txt`):

| Minutes | Suite | Median decode |
|---|---|---:|
| 0–4 | latency | 26.6 tok/s |
| 4–8 | agent, code review, long context | 99.4 tok/s |
| 8–21 | 10Q | 98.7 tok/s |
| 21–25 | HumanEval+ (start) | 98.7 tok/s |
| 25–28 | HumanEval+ | 29.4 tok/s |

The slow windows match spill, not the workload: the same request sizes ran at ~99 tok/s in between. The latency
suite ran entirely inside a slow window, so Ornith's latency numbers from this run are not representative. The run
was stopped at HumanEval+ task 32 of 164. Under PROTOCOL.md it is invalid; outputs are kept for transparency and
are not used in the comparison. Correctness-only results (agent 12/12, code review 10/10, long context 4/4 at
16K/32K/60K, 10Q 32/40) are reported as level B. Rerun at the next candidate, `65536:q8_0:4:all:0`.
