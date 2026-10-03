#!/usr/bin/env bash
# Downloads every model in models.tsv at its pinned revision and checks the SHA-256 against the Hub's LFS oid.
# Usage: data/fetch_models.sh <dest-dir>
set -euo pipefail
DEST=${1:?dest dir}; cd "$(dirname "$0")"
grep -v '^#' models.tsv | while IFS=$'\t' read -r repo rev file; do
  d="$DEST/$(echo "$repo" | tr '/' '__')"; mkdir -p "$d"
  want=$(curl -fs "https://huggingface.co/api/models/$repo/tree/$rev" | python3 -c "import json,sys; print(next(f['lfs']['oid'] for f in json.load(sys.stdin) if f['path']=='$file'))")
  echo "== $repo/$file"
  curl -fL --retry 5 --continue-at - -o "$d/$file" "https://huggingface.co/$repo/resolve/$rev/$file?download=true" 2>&1 | tail -c 200 | tr '\r' '\n' | tail -1
  got=$(sha256sum "$d/$file" | cut -d' ' -f1)
  [ "$got" = "$want" ] && echo "OK  $got  $file" || { echo "SHA MISMATCH $file: got $got want $want"; exit 1; }
done
