# Candidate survey (2026-10-03)

Done before any comparison run, as `PROTOCOL.md` requires. Method: web research of Hugging Face model cards,
GitHub repositories and blog benchmarks for models the community runs on 16 GB cards. **Limitations:** reddit.com
could not be fetched and one search tool was out of credit, so there is no direct r/LocalLLaMA evidence; all
quality numbers below are the model makers' own (different harnesses, not comparable across vendors).

## Candidates found

| # | Model | Quant that fits ~13–14.5 GB | Arch | Why it is a contender |
|---|---|---|---|---|
| 1 | Qwen3.8-27B (official), ISTA-DASLab GSQ-RCO | `Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp.gguf` ([repo](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF)) | dense 27B hybrid (16 full-attn + 48 Gated DeltaNet), MTP | same quant the subject is derived from; Huihui abliterated layers 22–52 → isolates the cost of abliteration. ISTA: IQ3_S = BF16 on LiveCodeBench v6 (85.71 vs 85.71) |
| 2 | Qwen3.8-27B, Unsloth | `UD-Q3_K_XL`, 13.1 GB ([repo](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)) | same | the default community quant; usually run on stock llama.cpp with `--spec-type draft-mtp --spec-draft-n-max 2` |
| 3 | Ornith-1.5-35B-A3B | SC117 `APEX-I-Mini` 13.38 GB with MTP ([repo](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF)); AtomicChat `AD-IQ3_XXS-IQ2_S` 13.7 GB ([repo](https://huggingface.co/AtomicChat/Ornith-1.5-35B-A3B-GGUF)) | MoE ~35B / ~3B active | card: SWE-bench Verified 79.0, Terminal-Bench 2.1 67.8 ([card](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B)); no 16 GB speed data found |
| 4 | Muse-Glimmer-30B (Meta) | bartowski `IQ3_M` 13.11 GB ([repo](https://huggingface.co/bartowski/Muse-Glimmer-30B-GGUF)) | dense 30B, sliding-window + gated GQA (small KV), DFlash drafter | card: SWE-Pro 51.2, MCP Atlas 75.5; Chinese support not stated |
| 5 | Gemma-4-26B-A4B-it | AtomicChat `IQ4_XS` 13.9 GB | MoE 25.2B / 3.8B active | card: LCB v6 77.1, Tau2 68.2; RTX 4080 llama.cpp: 121.7 / 114.9 / 96.1 tok/s at 19K / 32K / 64K ([Glukhov](https://www.glukhov.org/llm-performance/benchmarks/best-llm-on-16gb-vram-gpu/)) |
| 6 | gpt-oss-20b (OpenAI) | native MXFP4 ~12.8 GiB | MoE ~21B / 3.6B active | established tool-calling reference; 139.9 tok/s on a 16 GB GPU under Ollama |

Excluded: Gemma-4-31B dense (29.2 → 8.1 tok/s from 19K to 64K on a 4080 — not usable at the context sizes
tested); Qwen3.8-35B-A3B-Distill (unofficial third-party distill); Qwen3.8-Flash-Next (needs ≥ 66 GB).

## llama.cpp notes

- Stock llama.cpp supports Qwen3.8 MTP (`--spec-type draft-mtp`, PR #22673); the feveromo patch is local.
- Ornith 35B needs `qwen3_5_moe` support (≈ b10472+) and `--jinja`; Muse Glimmer needs ≈ b10353+ and `--jinja`
  (tool parsing), drafter via `-md`; gpt-oss needs the harmony template (`--jinja`).

## Direct 16 GB comparisons found

None with quality evaluation. Glukhov's RTX 4080 llama.cpp speed tables cover Qwen3.5/3.6 and Gemma 4 only;
Atomic Chat's ranking (Qwen3.8-27B > Ornith-35B-A3B > gpt-oss-20b > Gemma-4-26B-A4B) is vendor-published with
its own quants and no measurements.

## Selection

_To be filled when the candidate set is chosen (before the first comparison run)._
