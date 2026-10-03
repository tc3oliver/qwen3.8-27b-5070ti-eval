# Qwen3.8-27B on RTX 5070 Ti — does the fastest recipe also win on quality?

An independent, pre-registered evaluation of the
[feveromo RTX 5070 Ti recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) —
Huihui-Qwen3.8-27B-abliterated GSQ-RCO IQ3_S with embedded MTP, patched llama.cpp, adaptive speculative
decoding — against the strongest models the community runs on 16 GB cards, on coding, agentic tool calling,
and long-context Chinese Q&A.

The recipe already shows the speed: about 2× stock llama.cpp on the same weights. This repository asks the
question the speed numbers leave open: on one 16 GB card, is it also the model you should run?

Status: **setting up** — protocol written, candidate survey in progress, no comparison results yet.

> **Upstream:** the build, the CUDA kernel patch, the launch flags and the draft vocabulary come from
> [feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) (v3,
> 2026-09-28); the weights are [huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF).
> This repository adds the evaluation, the comparison, and the configuration changes listed in
> `configs/qwen38-27b-iq3s/README.md`; it does not modify the patch.

## Layout

| Path | Contents |
|---|---|
| `PROTOCOL.md` | pre-registered method: candidates, suites, metrics, definition of "best" |
| `ENVIRONMENT.md` | hardware, OS, drivers, toolchains, builds |
| `configs/` | one frozen launch configuration per model |
| `harness/` | evaluation scripts (all talk to an OpenAI-compatible llama-server) |
| `data/` | dataset fetch script and the hand-written datasets |
| `results/<model>/<run>/` | raw per-item outputs and summaries |
| `reports/` | candidate survey and final report |

## Reproduce

```bash
data/fetch.sh                      # downloads HumanEval+ and checks its SHA-256
# start the model under test (see configs/<model>.md), then e.g.
python3 harness/eval_humanevalplus.py --url http://127.0.0.1:8080 --key eval-key \
  --out results/<model>/<run>/humanevalplus.json
```
