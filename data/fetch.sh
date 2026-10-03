#!/usr/bin/env bash
# Downloads third-party datasets (not redistributed in this repo) and verifies them.
set -euo pipefail
cd "$(dirname "$0")"
gh release download v0.1.10 -R evalplus/humanevalplus_release -p 'HumanEvalPlus.jsonl.gz' --clobber 2>/dev/null \
  || curl -fL -o HumanEvalPlus.jsonl.gz https://github.com/evalplus/humanevalplus_release/releases/download/v0.1.10/HumanEvalPlus.jsonl.gz
echo "272720b90ac375502c8ed23cd791c2a93dfb22a911641a494da74a426c09f101  HumanEvalPlus.jsonl.gz" | sha256sum -c -
