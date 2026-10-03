# Reasoning-effort sweep (preliminary, before PROTOCOL.md)

Subject on the production server, 10Q Set A + B, temperature 0, per-question `max_tokens` = 4 × the question's
base budget, one run per setting, graded with `harness/grade_10q.py` (`grade_<setting>.json`).

| Setting | 10Q /40 | Tokens (20 questions) | Truncated |
|---|---:|---:|---:|
| thinking off | 16 | 2,484 | 1 |
| `xhigh` (vendor default) | 30 | 25,688 | 5 |
| `medium` | 28 | 19,406 | 5 |
| `low` | 32 | 17,242 | 3 |
| `low` + short-think instruction | 34 | 10,771 | 2 |
| `medium` + short-think instruction | **35** | **9,878** | 2 |

Single runs; speculative decoding makes reruns differ (the arena run of the same `medium` + short-think setting
scored 33/40). Read the ordering, not the one-point gaps.
