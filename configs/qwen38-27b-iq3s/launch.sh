#!/usr/bin/env bash
# Subject: Huihui Qwen3.8-27B GSQ-RCO IQ3_S + MTP on the feveromo v3 build.
# Needs: LLAMA_BIN (recipe v3 build of llama-server), MODEL (the GGUF), RECIPE (a checkout of
# feveromo/recipes-qwen3.8-27b-5070ti, for draft-vocab-generic.txt). Flags follow the recipe's v3 runtime
# configuration; differences are listed in README.md next to this file.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
: "${LLAMA_BIN:?path to the recipe-v3 llama-server}" "${MODEL:?path to the GGUF}" "${RECIPE:?recipe checkout}"
ctx=${CTX:-65536}

args=(
  --model "$MODEL" --alias qwen38-27b-iq3s
  --host 127.0.0.1 --port "${PORT:-8080}" --api-key "${API_KEY:-eval-key}"
  # memory: everything on the GPU, never fall back silently
  --ctx-size "$ctx" --n-gpu-layers all --fit off --no-context-shift
  --flash-attn on --cache-type-k q4_0 --cache-type-v q4_0
  --batch-size 512 --ubatch-size 256 --threads 8 --threads-batch 8 --parallel 1
  --cache-ram 0 --ctx-checkpoints 0 --slots --metrics
  # chat: thinking on, effort medium + short-think instruction (see README.md)
  --jinja --reasoning on --reasoning-effort medium --reasoning-budget 16384 --reasoning-preserve
  --chat-template-file "$here/chat-template-qwen38-shortthink.jinja"
  --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 --presence-penalty 0.0 --repeat-penalty 1.0
  # embedded MTP head, adaptive 1-5 draft tokens, fused reduced-vocabulary drafting
  --spec-type draft-mtp --spec-draft-n-max 5 --spec-draft-adaptive
  --spec-draft-type-k q4_0 --spec-draft-type-v q4_0
  --spec-draft-vocab "$RECIPE/draft-vocab-generic.txt" --spec-draft-vocab-n 16384
  --spec-draft-fuse-catchup --spec-coupled-sampling
)
export LD_LIBRARY_PATH=/usr/local/cuda-13.1/lib64:$(dirname "$LLAMA_BIN")
exec env -u GGML_CUDA_ENABLE_UNIFIED_MEMORY "$LLAMA_BIN" "${args[@]}"
