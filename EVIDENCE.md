# Evidence levels

Every number in the report carries one of these levels. Only level A can decide a ranking.

| Level | Meaning | Comparable with each other? |
|---|---|---|
| **A** — measured here, this protocol | Run by `harness/run_arena.py` on this machine with the frozen settings in `results/<model>/<run>/frozen.json`, same suites, same `max_tokens` | yes |
| **B** — measured here, earlier | Same machine, before the protocol (e.g. `results/qwen38-27b-iq3s/2026-10-03-prelim/`, the 10Q history in the owner's deployment notes); settings, budgets and builds differ from level A | only within the same earlier experiment |
| **C** — published elsewhere | Model cards, vendor reports, community benchmarks (other hardware, harnesses, quants); copied with link and date, not re-checked | no — context only |

Rules when quoting: carry the level with the number; never put a level-C number in the same column as level-A
numbers without marking it; a level-B number never replaces a level-A one.
