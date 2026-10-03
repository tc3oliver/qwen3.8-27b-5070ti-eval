# Round-1 explainer video

A 51-second, 1080p/30 fps video of the round-1 findings, written in TypeScript with three.js and rendered
deterministically: every frame is a pure function of time, so `scripts/render.ts` seeks frame by frame in headless
Chromium (software WebGL — the GPU stays free for the model) and pipes the frames to ffmpeg (H.264). The soundtrack is
synthesized in code as well (see [Soundtrack](#soundtrack)) and muxed on as AAC.

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
npm run render                       # music + frames + mux → ../media/qwen38-5070ti-round1.mp4 (about 20–30 min on CPU)
npx tsx scripts/render.ts --still 3,22   # single frames → stills/
npx tsx scripts/render.ts --poster 17.5 # poster candidate (155 tok/s frame) → stills/poster-candidate.png
```

The renderer uses a Playwright-managed Chromium from `~/.cache/ms-playwright` (or `--chrome PATH`). Text uses
Microsoft JhengHei / Noto Sans TC; a machine without either falls back to another CJK font and the layout may shift.

## Soundtrack

The music is original and license-clean. `scripts/music.ts` synthesizes it sample by sample in plain Node: polyBLEP
saws, FM bells, filtered noise, a Freeverb-style reverb and a ping-pong delay. There are no samples, loops or
third-party music. Noise comes from a seeded PRNG, so every run produces byte-identical audio.

- About 120 BPM in D major, I–V–vi–IV (Dmaj9 – A – Bm7 – Gmaj7). There is a V build into the 155 hit and a G–A–D
  cadence at the end. Parts: four-on-the-floor kick with side-chain ducking, off-beat hats, rolling bass, chord stabs,
  16th arp and pad. The kick drops out for the 12–14 s build and the 32.5–37.5 s terminal scene.
- Hits and ticks sit on the visual event times from `src/main.ts`, listed in the `EV` table at the top of the script,
  rather than only on the beat grid:

  | Event | Time (s) | Sound |
  |---|---|---|
  | Headline / card reveals | 0.35, 5.25, 8.7, 15.6, 17.0, 21.7, 37.85, 38.8, 39.2, 45.85 | soft pop |
  | Memory bar full | 8.0 | chime + pop |
  | 155 tok/s lands | 14.0 | kick + sub + crash + chord stab, after a snare roll and riser |
  | HumanEval+ ring fills / completes | 21.8–23.7 / 23.8 | ascending pentatonic chime / chord chime |
  | Quality cards | 24.9, 26.15, 27.4, 28.65 | pop + rising bell |
  | Dashboard flies in | 37.5 | kick + sub + crash, after a riser |
  | 20/20 badge | 40.1 | kick + sub + crash + chord stab + bell chord |
  | Scene changes | 5, 12, 21.5, 32.5, 45.5 | riser / whoosh that peaks on the change |
  | Final chord | 48.0 | tonic rings out, fades over the last 1.5 s to end at 51.0 |

  Onset analysis of the rendered audio puts these within 0–8 ms of the visual times.
- Mastered with a two-pass ffmpeg `loudnorm` (linear) to −16 LUFS integrated, true peak ≤ −1.5 dBTP. The muxed AAC
  measures −16.0 LUFS and −4.0 dBTP.

```bash
npm run music              # → out/music.wav (48 kHz stereo, 24-bit; out/ is git-ignored), about 10 s
npm run music -- --stem    # also out/stem-fx.wav: hits/ticks/risers only, for checking sync
npm run mux                # put out/music.wav on ../media/qwen38-5070ti-round1.mp4 (video stream copied, AAC 192k)
```

`npm run render` runs `music` first, and a full-length render muxes the audio on at the end. Partial renders
(`--from`/`--to`) stay silent.

## Embedding in an article

```html
<video src="https://raw.githubusercontent.com/tc3oliver/qwen3.8-27b-5070ti-eval/main/media/qwen38-5070ti-round1.mp4"
       poster="https://raw.githubusercontent.com/tc3oliver/qwen3.8-27b-5070ti-eval/main/media/qwen38-5070ti-round1-poster.png"
       controls muted playsinline preload="metadata" style="width:100%;border-radius:12px"></video>
```

The video has a soundtrack, but browsers only autoplay muted video: keep `muted` if you add `autoplay`, and readers
unmute with the controls. Without `autoplay`, you can drop `muted` so it plays with sound when clicked.

raw.githubusercontent.com serves the file as `application/octet-stream`; most browsers play it, but for a blog it
is more robust to copy the MP4 next to the post (e.g. Hugo `static/` or a page bundle) and use a relative `src`.
