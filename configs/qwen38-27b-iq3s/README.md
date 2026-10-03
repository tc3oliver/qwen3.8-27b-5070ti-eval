# Qwen3.8-27B GSQ-RCO IQ3_S + MTP (subject)

- Weights: `huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF` @ `3f101cd22b7999228bbd5d79a33975414eb9758b`,
  file `Huihui-Qwen3.8-27B-abliterated-GSQ-RCO-IQ3_S-mtp.gguf`, 12,120,016,416 bytes,
  SHA-256 `eea0638e283433e27b0edbd409b552be467a75ecc777d91c51db554c0a644c19`
- Build: recipe v3 (see `ENVIRONMENT.md`)
- Launch: `launch.sh` (the recipe's v3 runtime settings with these changes: context 131072 → 65536 because
  128K spills on this machine; reasoning effort xhigh → medium; short-think chat template
  `chat-template-qwen38-shortthink.jinja` — original template kept as `chat-template-qwen38.jinja`; host/port/key/alias)
- Draft vocabulary: recipe's `draft-vocab-generic.txt`
- Thinking: on (template default), effort medium + injected short-think instruction

Why effort medium + short-think: in the preliminary sweep (E24, grade B, one run per setting) it scored 35/40
with 9,878 tokens (38 % of xhigh's) vs 30/40 with 25,688 tokens for the recipe's xhigh
(`results/qwen38-27b-iq3s/2026-10-03-prelim/effort-sweep.md`). This choice was made before the
protocol and is frozen for the comparison.
