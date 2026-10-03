// Puts the soundtrack (out/music.wav from scripts/music.ts) on a rendered video: the video stream is copied as is,
// the audio is encoded AAC 192k. Replaces any audio already in the file, so it can be re-run. render.ts calls mux()
// after a full render; standalone: npm run mux [-- --video ../media/x.mp4 --audio out/music.wav]
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ffmpeg from "ffmpeg-static";

export function mux(video: string, audio = "out/music.wav") {
  video = resolve(video);
  const tmp = video.replace(/\.mp4$/, ".mux.mp4");
  const r = spawnSync(ffmpeg as unknown as string, ["-y", "-loglevel", "error", "-i", video, "-i", resolve(audio),
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg mux failed (${r.status})`);
  renameSync(tmp, video);
  console.log(`muxed ${audio} into ${video}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: a } = parseArgs({ options: {
    video: { type: "string", default: "../media/qwen38-5070ti-round1.mp4" }, audio: { type: "string", default: "out/music.wav" },
  } });
  mux(a.video!, a.audio!);
}
