// A 61-second explainer of round 1, rendered deterministically: every frame is a pure function of time t, so
// scripts/render.ts can seek frame by frame. Numbers on screen are quoted from EVIDENCE-INDEX.md (IDs shown in
// each scene's tag); the HumanEval+ ring is drawn from the per-task results via src/data.json.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import "./style.css";
import data from "./data.json";

const W = 1920, H = 1080;
// seeds chosen so the two lanes commit tokens in the measured ratio (155 : 74–81 tok/s ≈ 2 : 1)
const SEED_CODE = 27, SEED_PROSE = 50;
const GREEN = 0x76b900, BLUE = 0x4cc9f0, AMBER = 0xffb703, RED = 0xff4d6d;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const overlay = document.getElementById("overlay")!;
const fadeEl = document.getElementById("fade")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x05070d, 16, 40);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);

// ---------- helpers ----------
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const win = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const tmp = new THREE.Vector3();
function pin(el: HTMLElement, world: THREE.Vector3) {
  tmp.copy(world).project(camera);
  el.style.left = `${((tmp.x + 1) / 2) * W}px`;
  el.style.top = `${((1 - tmp.y) / 2) * H}px`;
}
function aim(pos: [number, number, number], look: [number, number, number]) {
  camera.position.set(...pos);
  camera.lookAt(...look);
  camera.updateMatrixWorld();
}
/** fade-and-rise an overlay element in at local time `at` */
function reveal(el: HTMLElement, p: number, at: number, d = 0.7, dy = 28) {
  const k = easeOut(win(p, at, at + d));
  el.style.opacity = String(k);
  el.style.transform = `${el.dataset.base ?? ""} translateY(${(1 - k) * dy}px)`;
}
function makeLayer(html: string) {
  const el = document.createElement("div");
  el.className = "layer";
  el.innerHTML = html;
  overlay.appendChild(el);
  const q = (k: string) => el.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  return { el, q };
}
function textTexture(text: string, w: number, h: number, font: string, color: string) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = color; g.font = font; g.textBaseline = "middle"; g.textAlign = "center";
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- shared environment ----------
scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 6);
scene.add(key);
const rimG = new THREE.PointLight(GREEN, 60, 30); rimG.position.set(-5, 3, -3); scene.add(rimG);
const rimB = new THREE.PointLight(BLUE, 40, 30); rimB.position.set(6, -1, 4); scene.add(rimB);
const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1); fill.position.set(-3, 1, 8); scene.add(fill);

const grid = new THREE.GridHelper(80, 80, 0x1d3045, 0x0e1826);
grid.position.y = -2.6;
scene.add(grid);

const dust = (() => {
  const r = rng(7), n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * 40; pos[i * 3 + 1] = (r() - 0.3) * 18; pos[i * 3 + 2] = (r() - 0.8) * 30; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7fb2e5, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(pts);
  return pts;
})();

const watermark = document.createElement("div");
watermark.className = "watermark mono";
watermark.textContent = "github.com/tc3oliver/qwen3.8-27b-5070ti-eval";
overlay.appendChild(watermark);

// ---------- the graphics card ----------
function makeFan() {
  const f = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.85, roughness: 0.3 });
  const well = new THREE.Mesh(new THREE.CircleGeometry(0.8, 48), dark); f.add(well);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.045, 12, 64), metal); f.add(ring);
  const rotor = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3c4656, metalness: 0.4, roughness: 0.45 });
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 9) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.02), bladeMat);
    blade.position.set(0.45, 0, 0.05); blade.rotation.x = 0.5;
    pivot.add(blade); rotor.add(pivot);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 32), metal);
  hub.rotation.x = Math.PI / 2; hub.position.z = 0.07; rotor.add(hub);
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 40), new THREE.MeshBasicMaterial({ color: GREEN }));
  glow.position.z = 0.115; rotor.add(glow);
  f.add(rotor);
  f.userData.rotor = rotor;
  return f;
}
function makeGpu() {
  const g = new THREE.Group();
  const shroud = new THREE.MeshStandardMaterial({ color: 0x56606f, metalness: 0.55, roughness: 0.38 });
  const back = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.8, roughness: 0.4 });
  g.add(new THREE.Mesh(new RoundedBoxGeometry(5.2, 2.0, 0.55, 4, 0.08), shroud));
  const plate = new THREE.Mesh(new RoundedBoxGeometry(5.2, 2.0, 0.08, 2, 0.03), back);
  plate.position.z = -0.34; g.add(plate);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.045, 0.02), new THREE.MeshBasicMaterial({ color: GREEN }));
  strip.position.set(0, 0.9, 0.285); g.add(strip);
  const strip2 = strip.clone(); strip2.position.y = -0.9; g.add(strip2);
  const gold = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xd4a72c, metalness: 1, roughness: 0.3 }));
  gold.position.set(-0.7, -1.08, -0.33); g.add(gold);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.3),
    new THREE.MeshBasicMaterial({ map: textTexture("GEFORCE RTX 5070 Ti  ·  16 GB", 1536, 128, "700 64px sans-serif", "#d8e3ef"), transparent: true }));
  label.rotation.x = -Math.PI / 2; label.position.set(0, 1.001, 0); g.add(label);
  const fans = [-1.3, 1.3].map((x) => { const f = makeFan(); f.position.set(x, 0, 0.28); g.add(f); return f; });
  g.userData.spin = (a: number) => fans.forEach((f, i) => (f.userData.rotor.rotation.z = -a * (i ? 1.07 : 1)));
  return g;
}

// ---------- segments ----------
interface Seg { start: number; dur: number; group: THREE.Group; layer: HTMLElement; update(p: number): void | Promise<unknown> }
const segs: Seg[] = [];
let cursor = 0;
function seg(dur: number, group: THREE.Group, layer: HTMLElement, update: (p: number) => void | Promise<unknown>) {
  scene.add(group);
  segs.push({ start: cursor, dur, group, layer, update });
  cursor += dur;
}

// 1. Title
{
  const group = new THREE.Group();
  const gpu = makeGpu(); group.add(gpu);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:250px;width:900px">
      <div class="kicker" data-k="k">Open evaluation · Round 1</div>
      <div class="h1" data-k="h" style="margin-top:22px">一張 16 GB 顯示卡<br>跑 27B 模型，<br>到底行不行？</div>
      <div class="sub" data-k="s" style="margin-top:30px">Qwen3.8-27B · GSQ-RCO IQ3_S + MTP 推測解碼<br>RTX 5070 Ti 16 GB · llama.cpp · 64K context</div>
      <div class="small" data-k="n" style="margin-top:22px">預先登錄的評測協議 · 每個數字都附證據等級與原始數據</div>
    </div>`);
  seg(6.5, group, el, (p) => {
    aim([lerp(-0.4, 0.3, p / 6.5), lerp(1.6, 0.9, p / 6.5), lerp(10.5, 8.6, easeOut(p / 6.5))], [1.6, 0.1, 0]);
    gpu.position.set(3.0, 0.25 + Math.sin(p * 1.1) * 0.08, 0);
    gpu.rotation.set(0.22, lerp(-0.85, -0.45, easeInOut(p / 6.5)), 0.04);
    gpu.userData.spin(p * 7);
    reveal(q("k"), p, 0.5); reveal(q("h"), p, 0.8); reveal(q("s"), p, 1.6); reveal(q("n"), p, 2.2);
  });
}

// 2. Context size vs decode speed (E23)
{
  const group = new THREE.Group();
  const rows = [
    { ctx: "64K", lo: 86, hi: 92, spill: "169 MiB", c: GREEN, note: "✓ 最大健康設定" },
    { ctx: "96K", lo: 41, hi: 74, spill: "421 MiB", c: AMBER, note: "" },
    { ctx: "120K", lo: 6.2, hi: 7.7, spill: "485 MiB", c: RED, note: "" },
    { ctx: "128K", lo: 5.9, hi: 5.9, spill: "未記錄", c: RED, note: "載得起來" },
  ];
  const base = -2.0, maxH = 3.0;
  const bars = rows.map((r, i) => {
    const x = -4.2 + i * 2.8;
    const solid = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4),
      new THREE.MeshStandardMaterial({ color: r.c, emissive: r.c, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.35 }));
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4),
      new THREE.MeshStandardMaterial({ color: r.c, transparent: true, opacity: 0.28, depthWrite: false }));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 1.8), new THREE.MeshStandardMaterial({ color: 0x1a2433, metalness: 0.6, roughness: 0.4 }));
    pad.position.set(x, base - 0.04, 0);
    group.add(solid, ghost, pad);
    return { x, solid, ghost, r };
  });
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:70px;width:1500px">
      <div class="kicker" data-k="k">Context length vs decode speed</div>
      <div class="h2" data-k="h" style="margin-top:14px">載得進去 ≠ 跑得動</div>
      <div class="sub" data-k="s" style="margin-top:12px">128K 也載得起來，但放不進 VRAM 的部分落到系統記憶體（由共享記憶體計數推得），解碼掉到 6 tok/s</div>
    </div>
    ${rows.map((r, i) => `
      <div class="abs label" data-k="v${i}" data-base="translate(-50%,-100%)"><div class="big" style="color:#${r.c.toString(16).padStart(6, "0")}">${r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}</div><div class="s">tok/s</div></div>
      <div class="abs label" data-k="c${i}" data-base="translate(-50%,0)"><div class="big">${r.ctx}</div><div class="s">共享記憶體 ${r.spill}</div>${r.note ? `<div class="s" style="color:${i ? "#ff8fa3" : "#a6e22e"}">${r.note}</div>` : ""}</div>`).join("")}
    <div class="tag" data-k="t"><b class="B">B</b>E23 · WSL2、桌面共用顯示卡；裸機 Linux 上原作者可跑 128K（C01）</div>`);
  seg(8.5, group, el, (p) => {
    aim([Math.sin(p * 0.25) * 1.2, 2.2, 13.5], [0, 0.0, 0]);
    bars.forEach((b, i) => {
      const k = easeOut(win(p, 0.9 + i * 0.4, 2.3 + i * 0.4));
      const hLo = Math.max(0.02, (b.r.lo / 92) * maxH * k), hHi = Math.max(0.02, (b.r.hi / 92) * maxH * k);
      b.solid.scale.y = hLo; b.solid.position.set(b.x, base + hLo / 2, 0);
      b.ghost.scale.y = hHi; b.ghost.position.set(b.x, base + hHi / 2, 0);
      b.ghost.visible = b.r.hi > b.r.lo;
      const v = q(`v${i}`), c = q(`c${i}`);
      pin(v, new THREE.Vector3(b.x, base + hHi + 0.35, 0.7));
      pin(c, new THREE.Vector3(b.x, base - 0.25, 0.9));
      reveal(v, p, 1.6 + i * 0.4); reveal(c, p, 0.7 + i * 0.4, 0.6, 12);
    });
    reveal(q("k"), p, 0.2); reveal(q("h"), p, 0.4); reveal(q("s"), p, 0.9); reveal(q("t"), p, 3.0, 0.6, 0);
  });
}

// 3. Quality: one cube per HumanEval+ task (E01) plus the other suites
{
  const group = new THREE.Group();
  const n = data.tasks.length, R = 1.85;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25, emissive: 0x222222 }), n);
  const col = new THREE.Color();
  data.tasks.forEach((t, i) => mesh.setColorAt(i, col.setHex(t.ok ? GREEN : RED)));
  const ring = new THREE.Group(); ring.add(mesh);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(R - 0.12, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.35 }));
  ring.add(inner);
  ring.position.set(-3.4, -0.55, 0);
  group.add(ring);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
  const cards = [
    ["10/10", "程式碼審查：10 個植入的 bug，行號與原因全對", "E03"],
    ["12/12", "多輪工具呼叫，0 次格式錯誤的呼叫", "E04"],
    ["4/4", "60K tokens 中文長文裡埋的 4 個事實，全部找回", "E05"],
    ["1.45 s", "日常中文提問，第一個回答 token 出現（p50）", "E07"],
  ];
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:70px;width:1700px">
      <div class="kicker" data-k="k">Quality · pre-registered run</div>
      <div class="h2" data-k="h" style="margin-top:14px">HumanEval+ 164 題，通過 151 題</div>
    </div>
    <div class="abs label" data-k="pct" data-base="translate(-50%,-50%)"><div style="font-size:96px;font-weight:800;line-height:1" data-k="pv">0.0%</div><div class="s" data-k="pn" style="font-size:26px">0 / 164 pass@1</div></div>
    <div class="abs small" data-k="lg" style="left:140px;top:960px">每一塊 = 一題 · 綠 = 通過、紅 = 失敗 · 長度 = 該題解碼速度</div>
    <div class="abs" style="left:1130px;top:250px;width:700px;display:grid;gap:16px">
      ${cards.map(([num, what, ev], i) => `<div class="card" data-k="c${i}" style="padding:16px 26px"><div class="num" style="font-size:54px" style="font-size:54px;color:${i === 3 ? "#4cc9f0" : "#a6e22e"}">${num}</div><div class="what">${what}</div><div class="ev">${ev} · 等級 A</div></div>`).join("")}
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="A">A</b>E01 · 95% CI 86.9–95.3% · 每題取樣一次、temperature 1.0</div>`);
  seg(10.5, group, el, (p) => {
    aim([0.6, 0.6, 12.5], [0.6, -0.3, 0]);
    ring.rotation.set(-0.12 + Math.sin(p * 0.4) * 0.05, 0.25 - p * 0.012, 0);
    let passed = 0;
    data.tasks.forEach((t, i) => {
      const a = 0.6 + (i / n) * 3.0, k = easeOut(win(p, a, a + 0.35));
      if (t.ok && p >= a + 0.1) passed++;
      const L = (0.14 + (t.tps / 190) * 0.75) * Math.max(k, 0.0001);
      const th = Math.PI / 2 - (i / n) * Math.PI * 2;
      ps.set(Math.cos(th) * (R + L / 2), Math.sin(th) * (R + L / 2), 0);
      qt.setFromAxisAngle(zAxis, th - Math.PI / 2);
      sc.set(0.058, L, 0.16 * Math.max(k, 0.0001));
      mesh.setMatrixAt(i, m4.compose(ps, qt, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    ring.updateMatrixWorld();
    pin(q("pct"), ring.localToWorld(new THREE.Vector3(0, 0, 0)));
    q("pv").textContent = `${((passed / n) * 100).toFixed(1)}%`;
    q("pn").textContent = `${passed} / ${n} pass@1`;
    reveal(q("pct"), p, 0.5, 0.6, 0); reveal(q("lg"), p, 1.2, 0.6, 0);
    reveal(q("k"), p, 0.2); reveal(q("h"), p, 0.4);
    for (let i = 0; i < 4; i++) reveal(q(`c${i}`), p, 4.0 + i * 0.75, 0.7, 40);
    reveal(q("t"), p, 3.6, 0.6, 0);
  });
}

// 4. Speed follows MTP acceptance (E09) — an illustration: per-step acceptance is simulated, the rates are measured
{
  const group = new THREE.Group();
  const COLS = 40, ROWS = 5, GAP = 0.2, T = 0.32, CUBE = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const lanes = [
    { yTop: 0.95, q: 0.82, seed: SEED_CODE },
    { yTop: -1.25, q: 0.5, seed: SEED_PROSE },
  ].map((cfg) => {
    const r = rng(cfg.seed), steps: { t0: number; a: number; c0: number }[] = [];
    let c = 0;
    for (let t0 = 1.2; t0 + T <= 9.3; t0 += T) {
      let a = 0;
      while (a < 5 && r() < cfg.q) a++;
      steps.push({ t0, a, c0: c });
      c += a + 1;
    }
    const done = new THREE.InstancedMesh(CUBE, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2, emissive: 0x1a2a05 }), COLS * ROWS);
    const ghost = new THREE.InstancedMesh(CUBE, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x0a1a24 }), 6);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(COLS * GAP + 0.3, ROWS * GAP + 0.3), new THREE.MeshBasicMaterial({ color: 0x0f1724, transparent: true, opacity: 0.75 }));
    frame.position.set(-1.5 + ((COLS - 1) * GAP) / 2, cfg.yTop - ((ROWS - 1) * GAP) / 2, -0.12);
    group.add(frame, done, ghost);
    return { ...cfg, steps, done, ghost };
  });
  const cell = (idx: number, yTop: number, v: THREE.Vector3) => v.set(-1.5 + (idx % COLS) * GAP, yTop - Math.floor(idx / COLS) * GAP, 0);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const cGreen = new THREE.Color(GREEN), cWhite = new THREE.Color(0xeaffc2), cBlue = new THREE.Color(BLUE), cRed = new THREE.Color(RED);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:70px;width:1700px">
      <div class="kicker" data-k="k">Speed · MTP speculative decoding</div>
      <div class="h2" data-k="h" style="margin-top:14px">寫程式的速度，約是寫中文的兩倍</div>
      <div class="sub" data-k="s" style="margin-top:12px">MTP 先草擬最多 5 個 token，主模型一次驗證 — 猜中越多，跑得越快</div>
    </div>
    <div class="abs" data-k="l0" style="left:110px;top:380px;width:440px">
      <div style="font-size:30px;font-weight:700">程式碼 · HumanEval+</div>
      <div style="font-size:72px;font-weight:800;color:#a6e22e;line-height:1.1">155 <span style="font-size:30px">tok/s</span></div>
      <div class="small">草稿接受率中位數 0.74</div>
    </div>
    <div class="abs" data-k="l1" style="left:110px;top:650px;width:440px">
      <div style="font-size:30px;font-weight:700">中文說明與摘要</div>
      <div style="font-size:72px;font-weight:800;color:#ffb703;line-height:1.1">74–81 <span style="font-size:30px">tok/s</span></div>
      <div class="small">草稿接受率 0.28–0.41</div>
    </div>
    <div class="abs small" data-k="lg" style="left:620px;top:950px">
      <span style="color:#4cc9f0">■</span> 草稿　<span style="color:#a6e22e">■</span> 驗證通過　<span style="color:#ff4d6d">■</span> 猜錯丟棄　· 示意動畫；速度與接受率為實測
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="A">A</b>E09 · 同一輪內的相關性；recipe 附的草稿詞表依英文與程式碼排序</div>`);
  seg(10, group, el, (p) => {
    aim([0.4, 0.5, 11.2], [0.4, -0.2, 0]);
    group.rotation.y = -0.06 + Math.sin(p * 0.3) * 0.03;
    for (const lane of lanes) {
      let committed = 0, live: (typeof lane.steps)[number] | null = null;
      for (const st of lane.steps) {
        if (p >= st.t0 + 0.4 * T) committed = st.c0 + st.a + 1;
        if (p >= st.t0 && p < st.t0 + T) live = st;
      }
      committed = Math.min(committed, COLS * ROWS);
      for (let i = 0; i < COLS * ROWS; i++) {
        const on = i < committed;
        const fresh = live && i >= live.c0 && i < committed ? 1 - win(p, live.t0 + 0.4 * T, live.t0 + T) : 0;
        cell(i, lane.yTop, v);
        s.setScalar(on ? 1 : 0.0001);
        lane.done.setMatrixAt(i, m4.compose(v, qt.identity(), s));
        lane.done.setColorAt(i, col.copy(cGreen).lerp(cWhite, fresh));
      }
      for (let j = 0; j < 6; j++) {
        let show = false;
        if (live && j < 5 && live.c0 + j < COLS * ROWS) {
          const sp = (p - live.t0) / T;
          const accepted = j < live.a;
          cell(live.c0 + j, lane.yTop, v);
          if (sp < 0.4) { show = true; s.setScalar(easeOut(sp / 0.4 + 0.2 - j * 0.08)); col.copy(cBlue); v.z += 0.25; }
          else if (!accepted && j !== live.a) { show = true; const d = win(sp, 0.4, 1); s.setScalar(1 - d); col.copy(cRed); v.y -= d * 0.35; v.z += 0.25; }
        }
        if (!show) s.setScalar(0.0001);
        lane.ghost.setMatrixAt(j, m4.compose(v, qt.identity(), s));
        lane.ghost.setColorAt(j, col);
      }
      for (const m of [lane.done, lane.ghost]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    reveal(q("k"), p, 0.2); reveal(q("h"), p, 0.4); reveal(q("s"), p, 0.9);
    reveal(q("l0"), p, 1.0, 0.6, 0); reveal(q("l1"), p, 1.4, 0.6, 0); reveal(q("lg"), p, 2.0, 0.6, 0); reveal(q("t"), p, 3.0, 0.6, 0);
  });
}

// 5. The Pi terminal at 1× real time: frames 0–299 = pi.cast 3.0–13.0 s (scripts/extract-pi.ts → public/pi/).
// Frames load on demand; update() returns a Promise when the needed frame is not decoded yet, and seek() passes it
// on so the renderer waits for it.
{
  const group = new THREE.Group();
  const FRAMES = 300, FPS = 30, PH = 6.1, PW = PH * (1618 / 1109);
  // drawn after the (transparent) dust and without depth test, so no particle sits on top of the text
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthTest: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
  screen.renderOrder = 10;
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.24, PH + 0.5, 0.12, 3, 0.06), new THREE.MeshStandardMaterial({ color: 0x161c26, metalness: 0.6, roughness: 0.35 }));
  bezel.position.set(0, 0.13, -0.08);
  const dots = [0xff5f57, 0xfebc2e, 0x28c840].map((c, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), new THREE.MeshBasicMaterial({ color: c }));
    d.position.set(-PW / 2 + 0.18 + i * 0.18, PH / 2 + 0.19, 0); return d;
  });
  const title = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.25),
    new THREE.MeshBasicMaterial({ map: textTexture("pi — qwen38-27b-iq3s · RTX 5070 Ti", 1024, 64, "500 34px monospace", "#8a96aa"), transparent: true, toneMapped: false }));
  title.position.set(0, PH / 2 + 0.19, 0.001);
  const monitor = new THREE.Group(); monitor.add(bezel, screen, title, ...dots);
  group.add(monitor);

  const loader = new THREE.TextureLoader();
  const loading = new Map<number, Promise<THREE.Texture>>();
  const frame = (j: number) => {
    let pr = loading.get(j);
    if (!pr) {
      pr = loader.loadAsync(`${import.meta.env.BASE_URL}pi/f${String(j).padStart(3, "0")}.jpg`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.userData.i = j;
        return t;
      });
      loading.set(j, pr);
    }
    return pr;
  };
  let want = -1, shown = -1;
  const show = (t: THREE.Texture) => {
    if (t.userData.i !== want || t.userData.i === shown) return;
    const old = mat.map;
    mat.map = t; mat.needsUpdate = true; shown = t.userData.i;
    if (old && !loading.has(old.userData.i)) old.dispose();
  };

  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:120px;width:470px">
      <div class="kicker" data-k="k">Coding agent · Pi · 實錄</div>
      <div class="h2" data-k="h" style="margin-top:14px">1× 原速<br>沒有加速</div>
      <div class="sub" data-k="s" style="margin-top:22px;font-size:28px">讀完資料 → 串流寫出計畫<br>→ 開始 <span class="mono" style="color:#a6e22e">write index.html</span></div>
      <div class="card mono" data-k="c" style="margin-top:40px;padding:14px 24px;display:inline-block;font-size:44px;font-weight:700">
        <span style="color:#ff4d6d;font-size:30px;vertical-align:middle">●</span> <span data-k="clk">00:00.0</span><span style="color:#8a96aa;font-size:28px"> / 00:10</span>
      </div>
      <div class="small" data-k="n" style="margin-top:14px">錄影時間戳 = 真實時間，未剪接、未加速</div>
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="B">B</b>錄影：同一個 dashboard 任務另一次執行的開頭（results/qwen38-27b-iq3s/pi-2026-10/recording/pi.cast，3–13 s）</div>`);
  seg(10, group, el, (p) => {
    aim([0, 0.2, 11], [0, 0, 0]);
    const k = easeOut(win(p, 0, 1.0)), e = easeInOut(win(p, 9.0, 10));
    monitor.position.set(lerp(2.6, 1.95, k) + e * 0.4, -0.22, lerp(-2.2, 0, k) - e * 1.6);
    monitor.rotation.set(-0.02, lerp(-0.35, -0.05, k) - e * 0.2, 0);
    reveal(q("k"), p, 0.2); reveal(q("h"), p, 0.4); reveal(q("s"), p, 0.9); reveal(q("c"), p, 0.6, 0.5, 0); reveal(q("n"), p, 1.4);
    reveal(q("t"), p, 1.0, 0.6, 0);
    q("clk").textContent = `00:${p.toFixed(1).padStart(4, "0")}`;
    want = Math.min(FRAMES - 1, Math.floor(p * FPS));
    for (let j = want + 1; j < Math.min(FRAMES, want + 4); j++) frame(j); // prefetch for live preview
    for (const [j, pr] of loading) if (j < want - 2 || j > want + 8) { loading.delete(j); pr.then((t) => { if (mat.map !== t) t.dispose(); }); }
    if (shown === want) return;
    return frame(want).then(show);
  });
}

// 6. Pi coding agent builds the dashboard (E30, E31)
const dashTex = new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}dashboard.png`);
{
  const group = new THREE.Group();
  const PW = 6.6, PH = 4.1;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.24, PH + 0.5, 0.12, 3, 0.06), new THREE.MeshStandardMaterial({ color: 0x161c26, metalness: 0.6, roughness: 0.35 }));
  bezel.position.set(0, 0.13, -0.08);
  const dots = [0xff5f57, 0xfebc2e, 0x28c840].map((c, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), new THREE.MeshBasicMaterial({ color: c }));
    d.position.set(-PW / 2 + 0.18 + i * 0.18, PH / 2 + 0.19, 0); return d;
  });
  const monitor = new THREE.Group(); monitor.add(bezel, screen, ...dots);
  group.add(monitor);
  dashTex.then((t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const img = t.image as HTMLImageElement;
    t.repeat.set(1, (PH / PW) / (img.height / img.width));
    mat.map = t; mat.needsUpdate = true;
  });
  const stats = [["320 s", "從空資料夾到完成"], ["28", "回合"], ["27", "次工具呼叫"], ["0", "次工具錯誤"]];
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:120px;width:900px">
      <div class="kicker" data-k="k">Coding agent · Pi</div>
      <div class="h2" data-k="h" style="margin-top:14px">本機模型 + Pi agent<br>5 分 20 秒做出這個儀表板</div>
      <div data-k="g" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:40px;width:660px">
        ${stats.map(([n, w]) => `<div class="card" style="padding:16px 22px"><div class="num" style="font-size:52px">${n}</div><div class="what">${w}</div></div>`).join("")}
      </div>
      <div class="sub" data-k="o" style="margin-top:26px;font-size:28px">25,678 output tokens · 純 HTML / CSS / JS，無外部依賴</div>
    </div>
    <div class="abs label" data-k="badge" data-base="translate(-50%,-50%)">
      <div style="width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,#2f4d07,#152203);border:4px solid #76b900;display:grid;place-content:center;box-shadow:0 0 60px rgba(118,185,0,.55)">
        <div style="font-size:66px;font-weight:800;color:#c6ff6b;line-height:1">20/20</div><div class="s" style="color:#d6f5a8">瀏覽器檢查</div>
      </div>
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="B">B</b>E30 E31 · 單次執行；評分器事後只收緊過（18→19→20 項）；題目給了所有 selector，評分程式不公開給模型</div>`);
  seg(9.5, group, el, (p) => {
    aim([0, 0.2, 11], [0, 0, 0]);
    const k = easeOut(win(p, 0.2, 2.0));
    monitor.position.set(lerp(6, 2.75, k), lerp(-0.6, -0.1, k), lerp(-3, -0.4, k));
    monitor.rotation.set(-0.04, lerp(-0.9, -0.22, k) + Math.sin(p * 0.5) * 0.02, 0);
    if (mat.map) mat.map.offset.y = (1 - mat.map.repeat.y) * (1 - easeInOut(win(p, 2.5, 8.6)));
    pin(q("badge"), monitor.localToWorld(new THREE.Vector3(PW / 2 - 0.75, PH / 2 - 0.65, 0.3)));
    reveal(q("k"), p, 0.4); reveal(q("h"), p, 0.6); reveal(q("g"), p, 1.4); reveal(q("o"), p, 2.0);
    const b = easeOut(win(p, 3.0, 3.6));
    q("badge").style.opacity = String(b);
    q("badge").style.transform = `translate(-50%,-50%) scale(${lerp(1.6, 1, b)})`;
    reveal(q("t"), p, 2.6, 0.6, 0);
  });
}

// 7. Outro
{
  const group = new THREE.Group();
  const gpu = makeGpu(); gpu.scale.setScalar(0.85); group.add(gpu);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:0;right:0;top:110px;text-align:center">
      <div class="kicker" data-k="k">Round 1 · 2026-10</div>
      <div class="h2" data-k="h" style="margin-top:16px">第一輪只有受測模型的完整數據</div>
      <div class="sub" data-k="s" style="margin-top:14px">競爭模型那一輪因 VRAM 溢出作廢、正在重跑 — 本輪不下「誰最好」的結論</div>
      <div class="mono" data-k="u" style="margin-top:34px;font-size:40px;color:#c6ff6b">github.com/tc3oliver/qwen3.8-27b-5070ti-eval</div>
      <div class="small" data-k="n" style="margin-top:12px">協議 · 原始數據 · 評分器全部公開 · Apache-2.0 / CC BY 4.0</div>
    </div>`);
  seg(6, group, el, (p) => {
    aim([0, 0.4, 10], [0, 0.2, 0]);
    gpu.position.set(0, -1.75 + Math.sin(p) * 0.06, 0);
    gpu.rotation.set(0.3, -0.25 + p * 0.09, 0);
    gpu.userData.spin(p * 7);
    reveal(q("k"), p, 0.3); reveal(q("h"), p, 0.5); reveal(q("s"), p, 1.0); reveal(q("u"), p, 1.6); reveal(q("n"), p, 2.1);
  });
}

// ---------- timeline ----------
const DURATION = cursor;
/** draws time t; returns a Promise when the frame needs an asset that is still loading (render.ts awaits it) */
function seek(t: number): Promise<void> | void {
  t = clamp(t, 0, DURATION - 1e-6);
  const i = segs.findIndex((s) => t < s.start + s.dur);
  segs.forEach((s, j) => { s.group.visible = j === i; s.layer.style.opacity = j === i ? "1" : "0"; });
  const s = segs[i], p = t - s.start;
  const wait = s.update(p);
  const fin = i === 0 ? 0.8 : 0.35, fout = i === segs.length - 1 ? 1.0 : 0.35;
  fadeEl.style.opacity = String(Math.max(1 - p / fin, 1 - (s.dur - p) / fout, 0));
  watermark.style.opacity = i === segs.length - 1 ? "0" : "1";
  dust.rotation.y = t * 0.012;
  dust.position.y = Math.sin(t * 0.2) * 0.2;
  grid.position.z = (t * 0.6) % 1;
  renderer.render(scene, camera);
  if (wait) return wait.then(() => renderer.render(scene, camera));
}

declare global { interface Window { __seek: (t: number) => Promise<void> | void; __duration: number; __ready: Promise<unknown> } }
window.__seek = seek;
window.__duration = DURATION;
window.__ready = Promise.all([dashTex, document.fonts.ready]);

if (!new URLSearchParams(location.search).has("render")) {
  const stage = document.getElementById("stage")!;
  const fit = () => (stage.style.transform = `scale(${Math.min(innerWidth / W, innerHeight / H)})`);
  addEventListener("resize", fit); fit();
  const t0 = performance.now();
  const loop = () => { seek(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  window.__ready.then(loop);
}
