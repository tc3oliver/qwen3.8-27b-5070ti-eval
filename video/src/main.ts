// A 52-second explainer of round 1, rendered deterministically: every frame is a pure function of time t, so
// scripts/render.ts can seek frame by frame. Numbers on screen are quoted from EVIDENCE-INDEX.md (IDs shown in
// each scene's tag); the HumanEval+ ring is drawn from the per-task results via src/data.json.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import "./style.css";
import data from "./data.json";

const W = 1920, H = 1080;
// seed of the illustrative MTP draft lane in the speed scene (per-step acceptance is simulated, not replayed)
const SEED_CODE = 27;
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
/** scale-punch an overlay element in at local time `at` (overshoots, then settles) */
function pop(el: HTMLElement, p: number, at: number, d = 0.45, from = 1.35) {
  const k = win(p, at, at + d);
  const s = k <= 0 ? from : 1 + (from - 1) * Math.pow(1 - k, 3) * Math.cos(k * Math.PI * 1.5);
  el.style.opacity = String(easeOut(win(p, at, at + d * 0.4)));
  el.style.transform = `${el.dataset.base ?? ""} scale(${s})`;
}
/** count up from 0 to `to` between a and b */
const count = (p: number, a: number, b: number, to: number) => to * easeOut(win(p, a, b));
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

// ---------- the Pi terminal recording ----------
// public/pi/f000.jpg … f299.jpg = pi.cast 3.0–13.0 s at 30 fps, 1× real time (scripts/extract-pi.ts). Frames load on
// demand; setFrame() returns a Promise when the frame is not decoded yet, and seek() passes it on so the renderer
// waits for it. Each instance keeps its own small cache.
const PI_FRAMES = 300, PI_FPS = 30;
function makeTerminal(PH: number) {
  const PW = PH * (1618 / 1109);
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
  /** shows recording frame j (0…299); returns a Promise while it loads */
  function setFrame(j: number): Promise<unknown> | void {
    want = clamp(Math.floor(j), 0, PI_FRAMES - 1);
    for (let k = want + 1; k < Math.min(PI_FRAMES, want + 4); k++) frame(k); // prefetch for live preview
    for (const [k, pr] of loading) if (k < want - 2 || k > want + 8) { loading.delete(k); pr.then((t) => { if (mat.map !== t) t.dispose(); }); }
    if (shown === want) return;
    return frame(want).then(show);
  }
  return { monitor, mat, setFrame, PW, PH };
}
const clock = (s: number) => `00:${s.toFixed(1).padStart(4, "0")}`;

// ---------- segments ----------
interface Seg { start: number; dur: number; group: THREE.Group; layer: HTMLElement; update(p: number): void | Promise<unknown> }
const segs: Seg[] = [];
let cursor = 0;
function seg(dur: number, group: THREE.Group, layer: HTMLElement, update: (p: number) => void | Promise<unknown>) {
  scene.add(group);
  segs.push({ start: cursor, dur, group, layer, update });
  cursor += dur;
}

// 1. Cold open: the real Pi terminal at 1× (recording 0–5 s = pi.cast 3–8 s)
{
  const group = new THREE.Group();
  const term = makeTerminal(6.1); group.add(term.monitor);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:0;right:0;bottom:0;height:470px;background:linear-gradient(to bottom,rgba(5,7,13,0),rgba(5,7,13,.82) 38%,rgba(5,7,13,.96))"></div>
    <div class="abs" style="left:110px;bottom:120px;width:1500px">
      <div class="h1" data-k="h" style="font-size:96px">這是一張 16 GB 的 RTX 5070 Ti</div>
      <div class="sub" data-k="s" style="margin-top:14px;font-size:36px">上面跑著 27B 模型，正驅動 Pi coding agent 寫程式</div>
    </div>
    <div class="abs card mono" data-k="c" style="right:80px;top:64px;padding:12px 22px;font-size:34px;font-weight:700">
      <span style="color:#ff4d6d;font-size:26px;vertical-align:middle">●</span> 1× 原速
      <span style="color:#8a96aa;font-size:26px;font-weight:500;margin-left:10px" data-k="clk">00:00.0</span>
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="B">B</b>錄影：dashboard 任務的一次執行（pi.cast 3–8 s），時間戳為真實時間，未剪接、未加速</div>`);
  seg(5, group, el, (p) => {
    aim([0, 0.1, 11], [0, 0.1, 0]);
    // slow push-in on a slightly turned screen
    term.monitor.position.set(lerp(0.25, -0.05, p / 5), 0.55, lerp(1.2, 2.0, easeOut(p / 5)));
    term.monitor.rotation.set(-0.02, lerp(-0.12, -0.03, easeOut(p / 5)), 0);
    pop(q("h"), p, 0.35, 0.5, 1.18); reveal(q("s"), p, 1.0, 0.5, 18);
    reveal(q("c"), p, 0.15, 0.3, 0); reveal(q("t"), p, 0.8, 0.5, 0);
    q("clk").textContent = clock(p);
    return term.setFrame(p * PI_FPS);
  });
}

// 2. A 27B model on a 16 GB card: model file size (E20 as cited in README) and the measured spill at 64K (E08)
{
  const group = new THREE.Group();
  const gpu = makeGpu(); group.add(gpu);
  // bar to scale: the card has 16 GiB (= 17.18 GB); the model file is 12.12 GB (decimal) = 70.6 % of it
  const FILE_FRAC = 12.12e9 / (16 * 2 ** 30);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:120px;width:1000px">
      <div class="kicker" data-k="k">Qwen3.8-27B · IQ3_S + MTP · llama.cpp</div>
      <div class="h1" data-k="h" style="margin-top:18px">27B 模型，<br>塞進 16 GB 顯示卡</div>
    </div>
    <div class="abs" data-k="bar" style="left:110px;top:600px;width:1060px">
      <div style="display:flex;justify-content:space-between;font-size:24px;color:#8a96aa;margin-bottom:10px"><span>顯示卡記憶體</span><span>16 GB</span></div>
      <div style="position:relative;height:70px;border-radius:12px;border:2px solid rgba(232,237,245,.35);background:rgba(14,20,32,.7);overflow:hidden">
        <div data-k="fill" style="position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#4a7a00,#76b900);box-shadow:0 0 30px rgba(118,185,0,.6)"></div>
        <div data-k="fl" style="position:absolute;left:24px;top:0;bottom:0;display:flex;align-items:center;font-size:30px;font-weight:800;color:#0b1200"><span>模型檔&nbsp;<span data-k="gb">0.00</span>&nbsp;GB</span></div>
      </div>
      <div data-k="ctx" style="margin-top:12px;margin-left:${(FILE_FRAC * 100).toFixed(1)}%;transform:translateX(-50%);display:inline-block;font-size:24px;color:#4cc9f0;white-space:nowrap">▲ 其餘空間：64K context 與運算緩衝</div>
    </div>
    <div class="abs card" data-k="sp" style="left:110px;top:800px;width:1060px;padding:16px 26px;display:flex;align-items:center;gap:26px">
      <div style="font-size:54px;font-weight:800;color:#a6e22e;line-height:1">✓</div>
      <div style="flex:1">
        <div style="font-size:30px;font-weight:700">64K context 跑完整輪測試，溢出到共享記憶體 <span style="color:#a6e22e">168 MiB</span></div>
        <div style="position:relative;height:12px;border-radius:6px;background:rgba(255,255,255,.08);margin-top:12px">
          <div data-k="sf" style="position:absolute;left:0;top:0;bottom:0;width:0;border-radius:6px;background:#a6e22e"></div>
          <div style="position:absolute;right:0;top:-6px;bottom:-6px;width:3px;background:#ff4d6d"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:20px;color:#8a96aa;margin-top:6px"><span>開始與結束時各量一次</span><span>協議上限 300 MiB</span></div>
      </div>
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="A">A</b>E20 · E08 · 12.12 GB 是模型檔大小，不是實測的顯存用量；長條以 16 GiB 等比例繪製</div>`);
  seg(7, group, el, (p) => {
    // swoop in from the side, then drift
    const k = easeOut(win(p, 0, 1.6));
    aim([lerp(4.5, 0.6, k), lerp(2.6, 1.0, k), lerp(8.0, 10.2, k)], [2.4, 0.3, 0]);
    gpu.position.set(4.2, 0.9 + Math.sin(p * 1.4) * 0.06, -0.4);
    gpu.rotation.set(0.28, lerp(-1.3, -0.5, easeInOut(win(p, 0, 2.2))) + p * 0.03, 0.05);
    gpu.userData.spin(p * 9);
    reveal(q("k"), p, 0.1, 0.4); pop(q("h"), p, 0.25, 0.5, 1.15);
    reveal(q("bar"), p, 0.9, 0.4, 16);
    const f = easeInOut(win(p, 1.2, 3.0));
    q("fill").style.width = `${(FILE_FRAC * 100 * f).toFixed(2)}%`;
    q("gb").textContent = (12.12 * f).toFixed(2);
    q("fl").style.opacity = String(win(p, 1.4, 1.8));
    reveal(q("ctx"), p, 3.1, 0.4, 10);
    q("ctx").style.transform = `translateX(-50%) translateY(${(1 - easeOut(win(p, 3.1, 3.5))) * 10}px)`;
    reveal(q("sp"), p, 3.7, 0.45, 24);
    q("sf").style.width = `${((168 / 300) * 100 * easeOut(win(p, 4.0, 4.9))).toFixed(1)}%`;
    reveal(q("t"), p, 1.5, 0.5, 0);
  });
}

// 3. Speed: 155 tok/s median decode on HumanEval+ code (E09); author's 1.9× vs stock llama.cpp (C01, not re-verified).
// The draft lane on the right is an illustration of MTP: per-step acceptance is simulated, only the rates are measured.
{
  const group = new THREE.Group();
  const COLS = 26, ROWS = 6, GAP = 0.2, T = 0.3, X0 = 1.1, Y0 = 1.15, CUBE = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const r = rng(SEED_CODE), steps: { t0: number; a: number; c0: number }[] = [];
  for (let t0 = 0.9, c = 0; t0 + T <= 9.0; t0 += T) {
    let a = 0;
    while (a < 5 && r() < 0.82) a++;
    steps.push({ t0, a, c0: c });
    c += a + 1;
  }
  const done = new THREE.InstancedMesh(CUBE, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2, emissive: 0x1a2a05 }), COLS * ROWS);
  const ghost = new THREE.InstancedMesh(CUBE, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x0a1a24 }), 6);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(COLS * GAP + 0.3, ROWS * GAP + 0.3), new THREE.MeshBasicMaterial({ color: 0x0f1724, transparent: true, opacity: 0.75 }));
  frame.position.set(X0 + ((COLS - 1) * GAP) / 2, Y0 - ((ROWS - 1) * GAP) / 2, -0.12);
  const lane = new THREE.Group(); lane.add(frame, done, ghost); group.add(lane);
  const cell = (idx: number, v: THREE.Vector3) => v.set(X0 + (idx % COLS) * GAP, Y0 - Math.floor(idx / COLS) * GAP, 0);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const cGreen = new THREE.Color(GREEN), cWhite = new THREE.Color(0xeaffc2), cBlue = new THREE.Color(BLUE), cRed = new THREE.Color(RED);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:90px;width:900px">
      <div class="kicker" data-k="k">Speed · 寫程式</div>
      <div class="sub" data-k="s" style="margin-top:12px;font-size:34px">HumanEval+ 程式碼，解碼速度中位數</div>
    </div>
    <div class="abs" data-k="n" data-base="" style="left:100px;top:210px;transform-origin:left center;white-space:nowrap">
      <span data-k="nv" style="font-size:260px;font-weight:800;color:#a6e22e;line-height:1;letter-spacing:-6px;text-shadow:0 0 60px rgba(118,185,0,.45)">0</span>
      <span style="font-size:72px;font-weight:800;margin-left:18px">tok/s</span>
    </div>
    <div class="abs small" data-k="pr" style="left:118px;top:500px;font-size:26px">p10 134 · p90 177 tok/s · 164 題逐題實測</div>
    <div class="abs" data-k="lt" style="left:1050px;top:205px;width:800px">
      <div style="font-size:28px;font-weight:700">MTP 推測解碼</div>
      <div class="small" style="font-size:22px">先草擬最多 5 個 token，主模型一次驗證；寫程式時草稿接受率中位數 0.74</div>
    </div>
    <div class="abs small" data-k="lg" style="left:1050px;top:560px;font-size:21px">
      <span style="color:#4cc9f0">■</span> 草稿　<span style="color:#a6e22e">■</span> 驗證通過　<span style="color:#ff4d6d">■</span> 猜錯丟棄　· 示意動畫
    </div>
    <div class="abs card" data-k="c1" data-base="" style="left:110px;top:640px;width:1000px;display:flex;align-items:center;gap:30px;padding:20px 30px;border-color:rgba(76,201,240,.45)">
      <div style="font-size:96px;font-weight:800;color:#4cc9f0;line-height:1">1.9×</div>
      <div>
        <div style="font-size:30px;font-weight:700">真實 agent session 的解碼速度，<br>是原版 llama.cpp 的 1.9 倍（同一份權重）</div>
        <div style="font-size:21px;color:#8a96aa;margin-top:8px">recipe 作者數據，本研究未重新驗證</div>
      </div>
    </div>
    <div class="abs" data-k="cv" style="left:110px;top:860px;font-size:24px;color:#ffcf66;padding:8px 16px;border:1px solid rgba(255,183,3,.5);border-radius:8px;background:rgba(255,183,3,.08)">
      速度跟內容有關：寫中文說明與摘要時約 74–81 tok/s（同一輪實測）
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="A">A</b>E09 · 155 為 HumanEval+ 程式碼的解碼中位數；速度與草稿接受率的關係是同一輪內的相關性　<b class="C">C</b>C01 · 作者數據</div>`);
  seg(9.5, group, el, (p) => {
    // push in, then a slow lateral drift
    aim([lerp(1.6, 0.3, easeOut(win(p, 0, 2.5))) - p * 0.03, lerp(0.9, 0.5, easeOut(win(p, 0, 2.5))), lerp(13.5, 11.0, easeOut(win(p, 0, 2.5)))], [0.3, -0.1, 0]);
    lane.rotation.y = -0.18 + Math.sin(p * 0.3) * 0.03;
    let committed = 0, live: (typeof steps)[number] | null = null;
    for (const st of steps) {
      if (p >= st.t0 + 0.4 * T) committed = st.c0 + st.a + 1;
      if (p >= st.t0 && p < st.t0 + T) live = st;
    }
    // once the grid is full, it scrolls by a row so the lane keeps moving
    const cap = COLS * ROWS, shift = Math.max(0, Math.ceil((committed - cap) / COLS)) * COLS;
    for (let i = 0; i < cap; i++) {
      const gi = i + shift, on = gi < committed;
      const fresh = live && gi >= live.c0 && gi < committed ? 1 - win(p, live.t0 + 0.4 * T, live.t0 + T) : 0;
      cell(i, v);
      s.setScalar(on ? 1 : 0.0001);
      done.setMatrixAt(i, m4.compose(v, qt.identity(), s));
      done.setColorAt(i, col.copy(cGreen).lerp(cWhite, fresh));
    }
    for (let j = 0; j < 6; j++) {
      let show = false;
      const idx = live ? live.c0 + j - shift : -1;
      if (live && j < 5 && idx >= 0 && idx < cap) {
        const sp = (p - live.t0) / T;
        cell(idx, v);
        if (sp < 0.4) { show = true; s.setScalar(easeOut(sp / 0.4 + 0.2 - j * 0.08)); col.copy(cBlue); v.z += 0.25; }
        else if (j > live.a) { show = true; const d = win(sp, 0.4, 1); s.setScalar(1 - d); col.copy(cRed); v.y -= d * 0.35; v.z += 0.25; }
      }
      if (!show) s.setScalar(0.0001);
      ghost.setMatrixAt(j, m4.compose(v, qt.identity(), s));
      ghost.setColorAt(j, col);
    }
    for (const m of [done, ghost]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    reveal(q("k"), p, 0.1, 0.4); reveal(q("s"), p, 0.3, 0.4);
    q("nv").textContent = String(Math.round(count(p, 0.4, 2.0, 155)));
    // the counter lands at 155 with a punch
    q("n").style.opacity = String(easeOut(win(p, 0.3, 0.6)));
    const land = win(p, 2.0, 2.5);
    q("n").style.transform = `scale(${land > 0 && land < 1 ? 1 + 0.12 * Math.sin(land * Math.PI) : 1})`;
    reveal(q("pr"), p, 2.3, 0.4, 10);
    reveal(q("lt"), p, 0.8, 0.5, 14); reveal(q("lg"), p, 1.2, 0.5, 0);
    pop(q("c1"), p, 3.6, 0.5, 1.12);
    reveal(q("cv"), p, 5.0, 0.5, 12);
    reveal(q("t"), p, 2.4, 0.5, 0);
  });
}

// 4. Capability rapid-fire: one bar per HumanEval+ task (E01), then E03, E04, E05, E07
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
  group.add(ring);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
  const cards = [
    ["10/10", "植入的 10 個 bug 全部抓到", "程式碼審查 · 行號與原因都對", "E03", "#a6e22e"],
    ["12/12", "多輪工具呼叫任務全部完成", "0 次格式錯誤的呼叫", "E04", "#a6e22e"],
    ["4/4", "60K tokens 中文長文，埋的事實全找回", "16K、32K 也是 4/4", "E05", "#a6e22e"],
    ["1.45 s", "日常中文提問，第一個回答 token 出現", "中位數（p50）", "E07", "#4cc9f0"],
  ];
  const { el, q } = makeLayer(`
    <div class="abs" style="left:110px;top:70px;width:1700px">
      <div class="kicker" data-k="k">Quality · 預先註冊的正式測試</div>
      <div class="h2" data-k="h" style="margin-top:14px">HumanEval+ 164 題，通過 151 題</div>
    </div>
    <div class="abs label" data-k="pct" data-base="translate(-50%,-50%)"><div style="font-size:104px;font-weight:800;line-height:1" data-k="pv">0.0%</div><div class="s" data-k="pn" style="font-size:26px">0 / 164 pass@1</div></div>
    <div class="abs small" data-k="lg" style="left:140px;top:965px;font-size:22px">每一塊 = 一題 · 綠 = 通過、紅 = 失敗 · 長度 = 該題解碼速度</div>
    <div class="abs" style="left:960px;top:250px;width:880px;display:grid;gap:18px">
      ${cards.map(([num, what, sub, ev, c], i) => `<div class="card" data-k="c${i}" data-base="" style="display:flex;align-items:center;gap:28px;padding:16px 28px;transform-origin:left center">
        <div style="font-size:76px;font-weight:800;line-height:1;width:220px;flex:none;color:${c}">${num}</div>
        <div><div style="font-size:28px;font-weight:700">${what}</div><div style="font-size:22px;color:#8a96aa;margin-top:4px">${sub} · ${ev} · 等級 A</div></div>
      </div>`).join("")}
    </div>
    <div class="tag" data-k="t" style="bottom:20px"><b class="A">A</b>E01 E03 E04 E05 E07 · HumanEval+ 95% CI 86.9–95.3% · 每題取樣一次、temperature 1.0</div>`);
  seg(11, group, el, (p) => {
    // starts close on the ring, pulls back as the cards arrive
    const k = easeInOut(win(p, 2.4, 3.6));
    aim([lerp(-3.4, 0.6, k) + Math.sin(p * 0.5) * 0.15, lerp(0.6, 0.6, k), lerp(9.6, 12.5, k)], [lerp(-3.4, 0.6, k), lerp(0.25, -0.3, k), 0]);
    ring.position.set(-3.6, -0.55, 0);
    ring.rotation.set(-0.12 + Math.sin(p * 0.4) * 0.05, 0.25 - p * 0.015, 0);
    let passed = 0;
    data.tasks.forEach((t, i) => {
      const a = 0.3 + (i / n) * 1.9, kk = easeOut(win(p, a, a + 0.3));
      if (t.ok && p >= a + 0.1) passed++;
      const L = (0.14 + (t.tps / 190) * 0.75) * Math.max(kk, 0.0001);
      const th = Math.PI / 2 - (i / n) * Math.PI * 2;
      ps.set(Math.cos(th) * (R + L / 2), Math.sin(th) * (R + L / 2), 0);
      qt.setFromAxisAngle(zAxis, th - Math.PI / 2);
      sc.set(0.058, L, 0.16 * Math.max(kk, 0.0001));
      mesh.setMatrixAt(i, m4.compose(ps, qt, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    ring.updateMatrixWorld();
    pin(q("pct"), ring.localToWorld(new THREE.Vector3(0, 0, 0)));
    q("pv").textContent = `${((passed / n) * 100).toFixed(1)}%`;
    q("pn").textContent = `${passed} / ${n} pass@1`;
    const done = win(p, 2.3, 2.7);
    q("pct").style.opacity = String(easeOut(win(p, 0.2, 0.6)));
    q("pct").style.transform = `translate(-50%,-50%) scale(${done > 0 && done < 1 ? 1 + 0.14 * Math.sin(done * Math.PI) : 1})`;
    reveal(q("lg"), p, 3.4, 0.5, 0);
    reveal(q("k"), p, 0.1, 0.4); pop(q("h"), p, 0.2, 0.45, 1.1);
    for (let i = 0; i < 4; i++) pop(q(`c${i}`), p, 3.4 + i * 1.25, 0.45, 1.3);
    reveal(q("t"), p, 3.0, 0.5, 0);
  });
}

// 5. Back to the Pi terminal (recording 5–10 s = pi.cast 8–13 s), then the finished dashboard (E30, E31)
const dashTex = new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}dashboard.png`);
{
  const group = new THREE.Group();
  const term = makeTerminal(6.1); group.add(term.monitor);
  const PW = 6.6, PH = 4.1;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x161c26, metalness: 0.6, roughness: 0.35, transparent: true });
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.24, PH + 0.5, 0.12, 3, 0.06), bezelMat);
  bezel.position.set(0, 0.13, -0.08);
  const dots = [0xff5f57, 0xfebc2e, 0x28c840].map((c, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), new THREE.MeshBasicMaterial({ color: c }));
    d.position.set(-PW / 2 + 0.18 + i * 0.18, PH / 2 + 0.19, 0); return d;
  });
  const dash = new THREE.Group(); dash.add(bezel, screen, ...dots);
  group.add(dash);
  dashTex.then((t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const img = t.image as HTMLImageElement;
    t.repeat.set(1, (PH / PW) / (img.height / img.width));
    mat.map = t; mat.needsUpdate = true;
  });
  const CUT = 5; // recording runs 0–5 s of this scene, dashboard reveal from CUT
  const stats = [["28", "回合"], ["0", "次工具錯誤"]];
  const { el, q } = makeLayer(`
    <div data-k="A">
      <div class="abs" style="left:0;right:0;bottom:0;height:300px;background:linear-gradient(to bottom,rgba(5,7,13,0),rgba(5,7,13,.9) 45%,rgba(5,7,13,.96))"></div>
      <div class="abs" style="left:110px;bottom:110px;width:1500px">
        <div class="kicker" data-k="ak">Coding agent · Pi · 錄影繼續</div>
        <div class="h2" data-k="ah" style="margin-top:10px;font-size:64px">讀完資料、列好計畫，接著寫 <span class="mono" style="color:#a6e22e">index.html</span></div>
      </div>
      <div class="abs card mono" data-k="ac" style="right:80px;top:64px;padding:12px 22px;font-size:34px;font-weight:700">
        <span style="color:#ff4d6d;font-size:26px;vertical-align:middle">●</span> 1× 原速
        <span style="color:#8a96aa;font-size:26px;font-weight:500;margin-left:10px" data-k="clk">00:05.0</span>
      </div>
      <div class="tag" data-k="at" style="bottom:20px"><b class="B">B</b>錄影：同一個 dashboard 任務的另一次執行（pi.cast 8–13 s），不是下面計分的那一次</div>
    </div>
    <div data-k="B" style="opacity:0">
      <div class="abs" style="left:110px;top:110px;width:900px">
        <div class="kicker" data-k="k">Coding agent · Pi · 單次實測</div>
        <div class="h2" data-k="h" style="margin-top:14px;font-size:56px;white-space:nowrap">本機模型 + Pi agent<br><span style="color:#a6e22e">5 分 20 秒</span>做出這個 dashboard</div>
        <div data-k="g" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:40px;width:640px">
          ${stats.map(([nn, w], i) => `<div class="card" data-k="g${i}" data-base="" style="padding:16px 22px"><div class="num" style="font-size:72px">${nn}</div><div class="what">${w}</div></div>`).join("")}
        </div>
        <div class="sub" data-k="o" style="margin-top:24px;font-size:26px">從零寫起 · 27 次工具呼叫 · 純 HTML / CSS / JS，不用框架</div>
      </div>
      <div class="abs label" data-k="badge" data-base="translate(-50%,-50%)">
        <div style="width:230px;height:230px;border-radius:50%;background:radial-gradient(circle,#2f4d07,#152203);border:4px solid #76b900;display:grid;place-content:center;box-shadow:0 0 70px rgba(118,185,0,.6)">
          <div style="font-size:72px;font-weight:800;color:#c6ff6b;line-height:1">20/20</div><div class="s" style="color:#d6f5a8">瀏覽器檢查</div>
        </div>
      </div>
      <div class="tag" data-k="t" style="bottom:20px"><b class="B">B</b>E30 E31 · 單次執行；評分器事後只收緊過（18→19→20 項）；題目給了所有 selector，評分程式不公開給模型</div>
    </div>`);
  seg(13, group, el, (p) => {
    aim([0, 0.2, 11], [0, 0, 0]);
    // A: terminal, same framing as the cold open, then it flies back and out
    const out = easeInOut(win(p, CUT - 0.3, CUT + 0.6));
    term.monitor.visible = out < 1;
    term.mat.opacity = 1 - out;
    term.monitor.position.set(lerp(-0.05, -6.5, out), lerp(0.55, 0.3, out), lerp(2.0, -6, out));
    term.monitor.rotation.set(-0.02, lerp(-0.03, 0.6, out), 0);
    q("A").style.opacity = String(1 - win(p, CUT - 0.4, CUT));
    reveal(q("ak"), p, 0.1, 0.4); reveal(q("ah"), p, 0.3, 0.5); reveal(q("ac"), p, 0.0, 0.3, 0); reveal(q("at"), p, 0.4, 0.5, 0);
    q("clk").textContent = clock(Math.min(10, 5 + p));
    // B: dashboard flies in from the right
    const k = easeOut(win(p, CUT - 0.1, CUT + 1.4));
    dash.visible = k > 0;
    dash.position.set(lerp(7, 3.05, k), lerp(-0.6, -0.1, k), lerp(-3, -0.4, k));
    dash.rotation.set(-0.04, lerp(-0.9, -0.22, k) + Math.sin(p * 0.5) * 0.02, 0);
    mat.opacity = bezelMat.opacity = k;
    const pb = p - CUT;
    if (mat.map) mat.map.offset.y = (1 - mat.map.repeat.y) * (1 - easeInOut(win(pb, 2.0, 7.6)));
    q("B").style.opacity = String(win(p, CUT, CUT + 0.3));
    pin(q("badge"), dash.localToWorld(new THREE.Vector3(PW / 2 - 0.8, PH / 2 - 0.7, 0.3)));
    reveal(q("k"), pb, 0.2, 0.4); pop(q("h"), pb, 0.35, 0.5, 1.12);
    pop(q("g0"), pb, 1.3, 0.4, 1.3); pop(q("g1"), pb, 1.7, 0.4, 1.3);
    reveal(q("o"), pb, 2.2, 0.5, 12);
    pop(q("badge"), pb, 2.6, 0.55, 1.7);
    reveal(q("t"), pb, 1.0, 0.5, 0);
    if (p < CUT + 0.6) return term.setFrame((5 + Math.min(p, 5 - 1e-6)) * PI_FPS);
  });
}

// 6. Outro
{
  const group = new THREE.Group();
  const gpu = makeGpu(); gpu.scale.setScalar(0.85); group.add(gpu);
  const { el, q } = makeLayer(`
    <div class="abs" style="left:0;right:0;top:120px;text-align:center">
      <div class="kicker" data-k="k">Round 1 · 2026-10</div>
      <div class="h2" data-k="h" style="margin-top:16px">一張 16 GB 顯示卡，27B 模型</div>
      <div class="sub" data-k="s" style="margin-top:14px">協議、原始數據、評分器全部公開 · 模型之間的比較留到下一輪</div>
      <div class="mono" data-k="u" style="margin-top:34px;font-size:42px;color:#c6ff6b">github.com/tc3oliver/qwen3.8-27b-5070ti-eval</div>
    </div>`);
  seg(5.5, group, el, (p) => {
    aim([0, 0.4, lerp(11.5, 10, easeOut(p / 5.5))], [0, 0.2, 0]);
    gpu.position.set(0, -1.75 + Math.sin(p) * 0.06, 0);
    gpu.rotation.set(0.3, -0.25 + p * 0.09, 0);
    gpu.userData.spin(p * 7);
    reveal(q("k"), p, 0.2, 0.5); pop(q("h"), p, 0.35, 0.5, 1.12); reveal(q("s"), p, 0.9, 0.5); reveal(q("u"), p, 1.3, 0.5);
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
  const fin = i === 0 ? 0.25 : 0.18, fout = i === segs.length - 1 ? 1.0 : 0.18;
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
