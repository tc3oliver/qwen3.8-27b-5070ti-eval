// Pulls the per-task numbers the video draws from the committed results, so every bar and cube traces back
// to a file listed in EVIDENCE-INDEX.md. Run: npx tsx scripts/extract-data.ts
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../results/qwen38-27b-iq3s/arena-2026-10/", import.meta.url);
const he = JSON.parse(readFileSync(new URL("humanevalplus.json", root), "utf8"));
const tasks = he.results.map((r: any) => ({
  ok: !!r.ok,
  tps: Math.round(r.decode_tps ?? 0),
  acc: r.draft_n ? +(r.draft_acc / r.draft_n).toFixed(3) : 0,
}));
const passed = tasks.filter((t: any) => t.ok).length;
writeFileSync(new URL("../src/data.json", import.meta.url), JSON.stringify({ source: "results/qwen38-27b-iq3s/arena-2026-10/humanevalplus.json (E01, E09)", passed, total: tasks.length, tasks }));
console.log(`humaneval+ ${passed}/${tasks.length}`);
