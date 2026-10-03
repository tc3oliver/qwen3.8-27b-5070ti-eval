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

Why effort medium + short-think: on the 10Q suite it scored 39/40 vs 37/40 for the recipe's xhigh, with about
half the thinking tokens (`results/qwen38-27b-iq3s/2026-10-03-prelim/`). This choice was made before the
protocol and is frozen for the comparison.
