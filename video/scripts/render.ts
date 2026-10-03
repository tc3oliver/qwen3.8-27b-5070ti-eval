// Renders dist/ frame by frame in headless Chromium (software WebGL, so the GPU stays free for the model) and
// encodes H.264 with ffmpeg-static. Usage: npm run render [-- --fps 30 --from 0 --to <s> --out ../media/x.mp4]
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import ffmpeg from "ffmpeg-static";
import { chromium } from "playwright-core";

const { values: a } = parseArgs({ options: {
  fps: { type: "string", default: "30" }, from: { type: "string", default: "0" }, to: { type: "string" },
  out: { type: "string", default: "../media/qwen38-5070ti-round1.mp4" }, still: { type: "string" },
  chrome: { type: "string" },
} });
const dist = resolve("dist");
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url!, "http://x").pathname));
  const f = existsSync(p) && statSync(p).isDirectory() ? join(p, "index.html") : p;
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" });
  createReadStream(f).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;

const cache = join(homedir(), ".cache/ms-playwright");
const chrome = a.chrome ?? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .map((d) => join(cache, d, "chrome-linux64/chrome")).concat(readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).map((d) => join(cache, d, "chrome-linux/chrome"))).find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("page error:", e));
await page.goto(`http://127.0.0.1:${port}/index.html?render`);
await page.waitForFunction(() => (window as any).__ready !== undefined);
await page.evaluate(() => (window as any).__ready);
const duration: number = await page.evaluate(() => (window as any).__duration);

const shot = async (t: number) => { await page.evaluate((t) => (window as any).__seek(t), t); return page.screenshot({ type: "png" }); };
if (a.still) {
  for (const t of a.still.split(",").map(Number)) {
    mkdirSync("stills", { recursive: true });
    await page.evaluate((t) => (window as any).__seek(t), t);
    await page.screenshot({ path: `stills/t${t.toFixed(1)}.png` });
    console.log(`stills/t${t.toFixed(1)}.png`);
  }
} else {
  const fps = Number(a.fps), from = Number(a.from), to = Math.min(Number(a.to ?? duration), duration);
  const out = resolve(a.out!); mkdirSync(dirname(out), { recursive: true });
  const enc = spawn(ffmpeg as unknown as string, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round((to - from) * fps), t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const buf = await shot(from + i / fps);
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once("drain", r));
    if (i % 60 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  enc.stdin.end();
  await new Promise((r) => enc.on("close", r));
  console.log(`wrote ${out} (${frames} frames, ${duration.toFixed(1)} s timeline) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
server.close();
