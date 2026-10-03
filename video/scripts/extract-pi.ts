// Cuts a 10-second window out of the Pi terminal recording and turns it into 300 JPEG frames at 30 fps
// (public/pi/f000.jpg … f299.jpg, generated and git-ignored) for the 1× real-time scene in main.ts.
// Source: results/qwen38-27b-iq3s/pi-2026-10/recording/pi.cast (harness/record_pi.py; real-time timestamps).
// Events before FROM are emitted at t = 0 so the screen state is correct on the first frame; events in
// [FROM, FROM + LEN] are shifted by -FROM; nothing is sped up or idle-compressed. Rendered with ../tools/bin/agg.
// Run: npx tsx scripts/extract-pi.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const FROM = 3.0, LEN = 10.0, FPS = 30;
const root = fileURLToPath(new URL("../../", import.meta.url));
const cast = join(root, "results/qwen38-27b-iq3s/pi-2026-10/recording/pi.cast");
const out = fileURLToPath(new URL("../public/pi/", import.meta.url));

const [header, ...lines] = readFileSync(cast, "utf8").split("\n").filter(Boolean);
const events: [number, string, string][] = [];
for (const l of lines) {
  const [t, kind, data] = JSON.parse(l) as [number, string, string];
  if (t > FROM + LEN) break;
  events.push([t < FROM ? 0 : +(t - FROM).toFixed(4), kind, data]);
}
events.push([LEN, "o", ""]); // pad so the GIF runs to the full LEN even if the window ends quietly

const tmp = mkdtempSync(join(tmpdir(), "pi-cast-"));
const trimmed = join(tmp, "pi.cast"), gif = join(tmp, "pi.gif");
writeFileSync(trimmed, [header, ...events.map((e) => JSON.stringify(e))].join("\n") + "\n");
execFileSync(join(root, "tools/bin/agg"), [
  "--theme", "monokai", "--font-size", "24", "--idle-time-limit", "100", "--fps-cap", String(FPS),
  "--last-frame-duration", "1", "--font-dir", join(homedir(), ".local/share/fonts"),
  "--font-family", "DejaVu Sans Mono,Microsoft JhengHei", "--quiet", trimmed, gif,
], { stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// fps=30 resamples the variable-delay GIF onto a constant 30 fps grid; the first LEN*FPS frames are t = 0 … LEN - 1/FPS
execFileSync(ffmpeg as unknown as string, ["-y", "-loglevel", "error", "-i", gif, "-vf", `fps=${FPS}`,
  "-frames:v", String(LEN * FPS), "-q:v", "3", "-start_number", "0", join(out, "f%03d.jpg")], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });

const n = readdirSync(out).filter((f) => f.endsWith(".jpg")).length;
if (n !== LEN * FPS) throw new Error(`expected ${LEN * FPS} frames, got ${n}`);
console.log(`${events.length} events (cast ${FROM}–${FROM + LEN} s) → ${n} frames in public/pi/`);
