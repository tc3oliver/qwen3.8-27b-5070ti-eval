# Same prompt, temperature 0, different answers: adaptive MTP and warm-up state

One question (10Q Q13, partial-order counting; correct answer 5), sent as the identical request every time:
temperature 0, seed 3407, prompt cache off. Subject configuration (recipe v3 build, MTP, effort `medium` +
short-think). RTX 5070 Ti, 2026-10-03.

| Condition | Runs | Completion tokens | Answer | File |
|---|---:|---|---|---|
| Fresh server, **adaptive** draft length (recipe default) | 5 | 885, 918, 1,219, 962, 918 | 5 ×5 | `q13-fresh-adaptive.json` |
| Fresh server, **fixed** draft length 5 (`--spec-draft-adaptive` removed) | 5 | 3,080 ×5 | 7 ×5 | `q13-fresh-fixed-n5.json` |
| Production server just restarted (adaptive) | 3 | 2,215, 1,875, 845 | 5 ×3 | `q13-after-restart.json` |
| Production server after hours of traffic (adaptive) | 5 | 3,080 ×5 | 7 ×5 | `q13-repeat.json` |
| same, interleaved with other questions, cache on | 4 | 3,080 ×4 | 7 ×4 | `q13-cache-on-interleaved.json` |
| same, seeds 1, 2, 3 and random | 5 | 3,080 ×5 | 7 ×5 | `q13-seeds.json` |
| same, after an 8K-token Chinese document and a code question | 3 | 3,080 ×3 | 7 ×3 | `q13-history.json` |

What it shows:

1. With a fixed draft length the output is bit-for-bit reproducible from a fresh process.
2. With the adaptive draft length, a fresh process gives a different completion on every run. The adaptive
   controller picks 1–5 draft tokens per cycle from online estimates of acceptance and verify cost, so the
   verify batch width — and with it the floating-point path through the model — changes from cycle to cycle.
3. After enough traffic the long-running production server reproduced the fixed-5 output exactly
   (3,080 tokens, answer 7), consistent with the controller having settled on width 5.
4. Seed, prompt cache and the preceding requests made no difference in the settled state.
5. The two paths end in different answers to the same question (5 vs 7). Speculative decoding is lossless in
   exact arithmetic; here the numeric differences between verify widths were enough to change a greedy result.

Consequence for benchmarking: a single run of a server with adaptive speculative decoding measures one sample of
a distribution that also depends on the server's warm-up state. Repeat runs, report the spread, and record
whether the server was fresh.

Limits: one prompt, five runs per condition; the mechanism in point 3 is inferred from the matching output, not
from logging the controller's chosen widths.
