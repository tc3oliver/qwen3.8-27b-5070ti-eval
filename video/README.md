# Round-1 explainer video

A 61-second, 1080p/30 fps video of the round-1 findings, written in TypeScript with three.js and rendered
deterministically: every frame is a pure function of time, so `scripts/render.ts` seeks frame by frame in headless
Chromium (software WebGL — the GPU stays free for the model) and pipes the frames to ffmpeg (H.264).

Output: [`media/qwen38-5070ti-round1.mp4`](../media/qwen38-5070ti-round1.mp4) · poster: [`media/qwen38-5070ti-round1-poster.png`](../media/qwen38-5070ti-round1-poster.png)

| Scene | Content | Evidence |
|---|---|---|
| 1 | The question: a 27B model on one 16 GB card | — |
| 2 | Context length vs decode speed: 64K 86–92 tok/s → 128K 5.9 tok/s | E23 (B) |
| 3 | HumanEval+ ring — one bar per task from `humanevalplus.json` (colour = pass/fail, length = that task's decode speed) — plus code review, tool calls, long context, latency | E01, E03–E05, E07 (A) |
| 4 | MTP speculative decoding: code 155 tok/s vs Chinese prose 74–81 tok/s. The per-step accept/reject animation is an illustration; seeds are chosen so the lanes fill at the measured ≈ 2 : 1 ratio | E09 (A) |
| 5 | The Pi terminal at 1× real time: 10 s of `pi.cast` (3–13 s): it reads the data, streams its plan and starts `write index.html`. A separate run of the same dashboard task (its first 45 s, recorded by `harness/record_pi.py`), not the E30 run | B (recording) |
| 6 | The Pi agent's dashboard, 320 s, 20/20 checks | E30, E31 (B) |
| 7 | Round 1 makes no comparative claim; link to this repository | — |

On-screen numbers are quoted from [`EVIDENCE-INDEX.md`](../EVIDENCE-INDEX.md); each scene shows its IDs and level.

```bash
cd video && npm install
npx tsx scripts/extract-data.ts      # src/data.json from results/ (committed)
npx tsx scripts/extract-pi.ts        # public/pi/: 300 frames of pi.cast 3–13 s via ../tools/bin/agg (generated, git-ignored)
npm run dev                          # live preview in a browser
npm run render                       # → ../media/qwen38-5070ti-round1.mp4 (about 20–30 min on CPU)
npx tsx scripts/render.ts --still 3,22   # single frames → stills/
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
