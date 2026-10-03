# Round-1 explainer video

A 51-second, 1080p/30 fps video of the round-1 findings, written in TypeScript with three.js and rendered
deterministically: every frame is a pure function of time, so `scripts/render.ts` seeks frame by frame in headless
Chromium (software WebGL — the GPU stays free for the model) and pipes the frames to ffmpeg (H.264).

Output: [`media/qwen38-5070ti-round1.mp4`](../media/qwen38-5070ti-round1.mp4) · poster: [`media/qwen38-5070ti-round1-poster.png`](../media/qwen38-5070ti-round1-poster.png)

| Time | Scene | On-screen numbers | Evidence |
|---|---|---|---|
| 0–5 s | Cold open: the real Pi terminal at 1× real time (`pi.cast` 3–8 s), "this is a 16 GB RTX 5070 Ti" | — | B (recording) |
| 5–12 s | A 27B model on a 16 GB card: memory bar drawn to scale (16 GiB card), model file 12.12 GB — the file size, not measured VRAM use; at 64K the run's shared-memory spill was 168 MiB at start and end, limit 300 MiB | 12.12 GB; 168 / 300 MiB | E20, E08 (A) |
| 12–21.5 s | Speed: counter to 155 tok/s, the median decode on HumanEval+ code (p10 134, p90 177), with an illustrative MTP draft lane (per-step acceptance simulated, median acceptance 0.74 measured); the recipe author's 1.9× over stock llama.cpp on agent sessions, labelled as not re-verified; Chinese prose 74–81 tok/s as a caveat | 155, 134, 177, 0.74, 74–81 tok/s; 1.9× | E09 (A), C01 (C) |
| 21.5–32.5 s | Quality rapid-fire: HumanEval+ ring — one bar per task from `humanevalplus.json` (colour = pass/fail, length = that task's decode speed) — then code review, tool calls, long context, latency | 92.1 % (151/164, CI 86.9–95.3 %); 10/10; 12/12, 0 malformed; 4/4 at 60K (and 16K, 32K); 1.45 s p50 | E01, E03, E04, E05, E07 (A) |
| 32.5–37.5 s | Back to the Pi terminal (`pi.cast` 8–13 s): it finishes its plan and starts `write index.html`. A separate run of the same dashboard task, recorded by `harness/record_pi.py`, not the E30 run | — | B (recording) |
| 37.5–45.5 s | The dashboard the Pi agent built: 5 min 20 s, 28 turns, 0 tool errors, 27 tool calls, 20/20 checks | 5:20, 28, 0, 27, 20/20 | E30, E31 (B) |
| 45.5–51 s | Outro: protocol, raw data and graders are public; model-vs-model comparison comes in the next round | — | — |

On-screen numbers are quoted from [`EVIDENCE-INDEX.md`](../EVIDENCE-INDEX.md); each scene shows its IDs and level.
The 12.12 GB figure (E20) is the model file size, not measured VRAM use.

```bash
cd video && npm install
npx tsx scripts/extract-data.ts      # src/data.json from results/ (committed)
npx tsx scripts/extract-pi.ts        # public/pi/: 300 frames of pi.cast 3–13 s via ../tools/bin/agg (generated, git-ignored)
npm run dev                          # live preview in a browser
npm run render                       # → ../media/qwen38-5070ti-round1.mp4 (about 20–30 min on CPU)
npx tsx scripts/render.ts --still 3,22   # single frames → stills/
npx tsx scripts/render.ts --poster 17.5 # poster candidate (155 tok/s frame) → stills/poster-candidate.png
```

The renderer uses a Playwright-managed Chromium from `~/.cache/ms-playwright` (or `--chrome PATH`). Text uses
Microsoft JhengHei / Noto Sans TC; a machine without either falls back to another CJK font and the layout may shift.

## Embedding in an article

```html
<video src="https://raw.githubusercontent.com/tc3oliver/qwen3.8-27b-5070ti-eval/main/media/qwen38-5070ti-round1.mp4"
       poster="https://raw.githubusercontent.com/tc3oliver/qwen3.8-27b-5070ti-eval/main/media/qwen38-5070ti-round1-poster.png"
       controls muted playsinline preload="metadata" style="width:100%;border-radius:12px"></video>
```

raw.githubusercontent.com serves the file as `application/octet-stream`; most browsers play it, but for a blog it
is more robust to copy the MP4 next to the post (e.g. Hugo `static/` or a page bundle) and use a relative `src`.
