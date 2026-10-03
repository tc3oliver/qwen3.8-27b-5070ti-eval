// Synthesizes the soundtrack in plain Node DSP (no samples, no third-party music): an original ~120 BPM electronic
// cue in D major whose hits, ticks and risers sit on the visual events of src/main.ts. Deterministic: the noise comes
// from a seeded PRNG, so the same code always gives the same samples.
// Usage: npm run music [-- --stem] → out/music.wav (48 kHz stereo, -16 LUFS, true peak ≤ -1.5 dBTP via two-pass
// ffmpeg loudnorm). --stem also writes out/stem-fx.wav (hits/ticks/risers only, un-normalized) for sync checks.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import ffmpeg from "ffmpeg-static";

const { values: a } = parseArgs({ options: { stem: { type: "boolean", default: false } } });
const SR = 48000, DUR = 51.0, N = Math.round(SR * DUR), BEAT = 0.5; // 120 BPM, bar = 2 s
const TAU = Math.PI * 2;

// ---------- visual event times (seconds), taken from src/main.ts ----------
// segment starts: 0 cold open, 5 memory, 12 speed, 21.5 quality, 32.5 terminal → 37.5 dashboard (CUT), 45.5 outro
const CUTS = [5, 12, 21.5, 32.5, 45.5];
const EV = {
  coldHeadline: 0.35,           // pop(h, 0.35)
  memHeadline: 5.25,            // 5 + pop(h, 0.25)
  barFull: 8.0,                 // 5 + fill win(1.2, 3.0)
  spillCard: 8.7,               // 5 + reveal(sp, 3.7)
  countStart: 12.4,             // 12 + count(0.4 → 2.0)
  land155: 14.0,                // 12 + land punch win(2.0, 2.5)
  card19: 15.6,                 // 12 + pop(c1, 3.6)
  caveat: 17.0,                 // 12 + reveal(cv, 5.0)
  qualHeadline: 21.7,           // 21.5 + pop(h, 0.2)
  ringStart: 21.8, ringEnd: 23.7, // 21.5 + bars grow from 0.3 … 2.2
  ringDone: 23.8,               // 21.5 + pct punch win(2.3, 2.7)
  cards: [24.9, 26.15, 27.4, 28.65], // 21.5 + 3.4 + i·1.25
  dashboard: 37.5,              // 32.5 + CUT 5
  dashHeadline: 37.85,          // pb 0.35
  stats: [38.8, 39.2],          // pb 1.3, 1.7
  badge: 40.1,                  // pb 2.6 — 20/20 badge
  outroHeadline: 45.85,         // 45.5 + 0.35
  final: 48.0,                  // last downbeat: tonic chord rings out
};
const HITS = [EV.land155, EV.dashboard, EV.badge, EV.final]; // grid kicks near these are replaced by the hit's own

// ---------- harmony: D major, I–V–vi–IV with a V build before the 155 hit and a V–I cadence at the end ----------
const CH: Record<string, number[]> = {
  D: [62, 66, 69, 73, 76],  // Dmaj9
  A: [61, 64, 69, 71],      // A add9
  Asus: [62, 64, 69, 71],   // Asus4 add9
  Bm: [62, 66, 69, 71],     // Bm7
  G: [62, 66, 67, 71],      // Gmaj7
};
const ROOT: Record<string, number> = { D: 38, A: 33, Asus: 33, Bm: 35, G: 31 };
const PROG: [number, string][] = [
  [0, "D"], [2, "A"], [4, "Bm"], [6, "G"], [8, "Bm"], [10, "G"], [12, "Asus"], [13, "A"],
  [14, "D"], [16, "A"], [18, "Bm"], [20, "G"], [22, "D"], [24, "A"], [26, "Bm"], [28, "G"], [30, "D"],
  [32, "Bm"], [34, "G"], [36, "Asus"], [37, "A"], [37.5, "D"], [39, "G"], [40.1, "D"], [42, "A"], [44, "Bm"],
  [46, "G"], [47, "A"], [48, "D"],
];
const chordAt = (t: number) => { let c = PROG[0][1]; for (const [s, n] of PROG) if (t >= s - 1e-9) c = n; return c; };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- primitives ----------
let seed = 0x5eed1234;
const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
const inR = (t: number, ...rs: [number, number][]) => rs.some(([x, y]) => t >= x - 1e-9 && t < y - 1e-9);
const near = (t: number, ts: number[], d: number) => ts.some((h) => Math.abs(h - t) < d);
/** piecewise-linear automation */
const auto = (pts: [number, number][]) => (t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t < pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
/** zero-delay-feedback state-variable filter (stable under fast modulation) */
class SVF {
  ic1 = 0; ic2 = 0; g = 0; k = 1;
  set(fc: number, q = 0.707) { this.g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR); this.k = 1 / q; return this; }
  run(x: number) {
    const { g, k } = this, a1 = 1 / (1 + g * (g + k)), v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + g * a1 * v3, v2 = this.ic2 + g * v1;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  }
}
const blep = (p: number, dt: number) => p < dt ? (p /= dt, p + p - p * p - 1) : p > 1 - dt ? (p = (p - 1) / dt, p * p + p + p + 1) : 0;
class Saw { p: number; constructor(p = 0) { this.p = p; } next(f: number) { const dt = f / SR; const y = 2 * this.p - 1 - blep(this.p, dt); this.p += dt; if (this.p >= 1) this.p -= 1; return y; } }

// buses: DRY (drums), SC (side-chained music), FX (hits/ticks/risers), REV / DLY (mono sends)
const mk = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const DRY = mk(), SC = mk(), FX = mk(), REV = new Float32Array(N), DLY = new Float32Array(N);
type Bus = ReturnType<typeof mk>;
interface Out { bus: Bus; pan?: number; rev?: number; dly?: number }
function emit(o: Out, i: number, s: number) {
  if (i < 0 || i >= N) return;
  const th = ((o.pan ?? 0) + 1) * (Math.PI / 4);
  o.bus.L[i] += s * Math.cos(th) * Math.SQRT2; o.bus.R[i] += s * Math.sin(th) * Math.SQRT2;
  if (o.rev) REV[i] += s * o.rev;
  if (o.dly) DLY[i] += s * o.dly;
}
/** runs fn(x, n) for each sample of a voice starting at time t, lasting len seconds */
function voice(t: number, len: number, o: Out, fn: (x: number, n: number) => number) {
  const i0 = Math.round(t * SR), n1 = Math.round(len * SR);
  for (let n = 0; n < n1; n++) { const i = i0 + n; if (i >= N) break; if (i >= 0) emit(o, i, fn(n / SR, n)); else fn(n / SR, n); }
}
const att = (x: number, a: number) => (x < a ? x / a : 1);

// ---------- instruments ----------
const kicks: number[] = [];
function kick(t: number, g = 0.9) {
  kicks.push(t);
  let ph = 0;
  voice(t, 0.5, { bus: DRY }, (x) => {
    ph += (46 + 115 * Math.exp(-x / 0.032)) / SR;
    const body = Math.sin(TAU * ph) * Math.exp(-x / 0.2) * att(x, 0.0015);
    return g * (Math.tanh(1.6 * body) / Math.tanh(1.6) + noise() * 0.12 * Math.exp(-x / 0.003));
  });
}
function hat(t: number, g: number, open = false, pan = 0.15) {
  const f = new SVF().set(8500, 0.8), d = open ? 0.06 : 0.022;
  voice(t, d * 6, { bus: DRY, pan }, (x) => g * f.run(noise()).hp * Math.exp(-x / d));
}
function clap(t: number, g: number) {
  const f = new SVF().set(1500, 1.1);
  voice(t, 0.45, { bus: DRY, rev: 0.22 }, (x) => {
    let e = Math.exp(-x / 0.11) * 0.6;
    for (const k of [0, 0.011, 0.022]) if (x >= k) e += Math.exp(-(x - k) / 0.005);
    return g * f.run(noise()).bp * e * 1.6;
  });
}
function snare(t: number, g: number, o: Out = { bus: FX, rev: 0.15 }) {
  const f = new SVF().set(2100, 0.8);
  voice(t, 0.25, o, (x) => g * (f.run(noise()).bp * 1.4 * Math.exp(-x / 0.06) + 0.45 * Math.sin(TAU * 195 * x) * Math.exp(-x / 0.04)));
}
function crash(t: number, g: number, dec = 1.0) {
  for (const pan of [-0.6, 0.6]) {
    const hp = new SVF().set(3800, 0.7), lp = new SVF().set(10500, 0.7);
    voice(t, dec * 4, { bus: FX, pan, rev: 0.25 }, (x) => g * lp.run(hp.run(noise()).hp).lp * Math.exp(-x / dec) * att(x, 0.002));
  }
}
function sub(t: number, g: number) {
  let ph = 0;
  voice(t, 1.6, { bus: FX }, (x) => { ph += (36 + 40 * Math.exp(-x / 0.1)) / SR; return g * Math.sin(TAU * ph) * Math.exp(-x / 0.55) * att(x, 0.004); });
}
/** filtered-noise riser ending exactly at t1 */
function riser(t0: number, t1: number, g: number, f0 = 350, f1 = 7000) {
  const T = t1 - t0;
  for (const pan of [-0.45, 0.45]) {
    const f = new SVF();
    voice(t0, T, { bus: FX, pan, rev: 0.3 }, (x) => {
      const u = x / T; f.set(f0 * Math.pow(f1 / f0, u), 2.2);
      return g * f.run(noise()).bp * u * u * Math.min(1, (T - x) / 0.012);
    });
  }
}
/** whoosh through a cut: noise sweeps up into tc, then falls away and pans across */
function whoosh(tc: number, g: number, pre = 0.7, post = 0.35) {
  const f = new SVF();
  voice(tc - pre, pre + post, { bus: FX, rev: 0.35 }, (x) => {
    const u = x - pre;
    let fc: number, e: number;
    if (u < 0) { const k = 1 + u / pre; fc = 300 * Math.pow(18, k); e = k * k; }
    else { const k = 1 - u / post; fc = 5400 * Math.pow(0.25, u / post); e = k * k * k; }
    f.set(fc, 1.6);
    return g * f.run(noise()).bp * e;
  });
}
/** soft "pop": a short upward-gliding sine blip with a tiny click */
function pop(t: number, g: number, f = 900, pan = 0) {
  let ph = 0;
  voice(t, 0.2, { bus: FX, pan, rev: 0.1 }, (x) => {
    ph += f * (0.55 + 0.45 * (1 - Math.exp(-x / 0.012))) / SR;
    return g * (Math.sin(TAU * ph) * Math.exp(-x / 0.045) * att(x, 0.001) + noise() * 0.25 * Math.exp(-x / 0.0015));
  });
}
/** FM bell / glass chime */
function bell(t: number, m: number, g: number, pan = 0, dec = 0.9, bus: Bus = FX) {
  const f = mtof(m);
  voice(t, dec * 5, { bus, pan, rev: 0.35, dly: 0.2 }, (x) =>
    g * Math.sin(TAU * f * x + (2.2 * Math.exp(-x / 0.12) + 0.25) * Math.sin(TAU * f * 2 * x)) * Math.exp(-x / dec) * att(x, 0.002));
}
function pluck(t: number, m: number, g: number, pan: number, cut: number) {
  const o = new Saw(), f = new SVF(), hz = mtof(m);
  voice(t, 0.45, { bus: SC, pan, rev: 0.12, dly: 0.28 }, (x) => {
    f.set(250 + cut * Math.exp(-x / 0.07), 0.9);
    return g * f.run(o.next(hz)).lp * Math.exp(-x / 0.15) * att(x, 0.002);
  });
}
function stab(t: number, chord: number[], g: number, len = 0.5, bus: Bus = SC) {
  chord.forEach((m, j) => [-7, 7].forEach((det, s) => {
    const o = new Saw((j * 0.31 + s * 0.5) % 1), f = new SVF(), hz = mtof(m) * Math.pow(2, det / 1200);
    voice(t, len, { bus, pan: s ? 0.35 : -0.35, rev: 0.25 }, (x) => {
      f.set(500 + 2600 * Math.exp(-x / 0.1), 0.8);
      return (g / chord.length) * f.run(o.next(hz)).lp * Math.exp(-x / 0.17) * att(x, 0.003);
    });
  }));
}
function bassNote(t: number, m: number, len: number, g: number) {
  const o = new Saw(), f = new SVF(), hz = mtof(m);
  let ph = 0;
  voice(t, len + 0.03, { bus: SC }, (x) => {
    f.set(170 + 850 * Math.exp(-x / 0.05), 0.85);
    ph += hz / SR;
    const env = att(x, 0.003) * Math.min(1, (len + 0.03 - x) / 0.03);
    return g * Math.tanh(1.5 * (0.7 * f.run(o.next(hz)).lp + 0.6 * Math.sin(TAU * ph))) * env;
  });
}

// ---------- arrangement ----------
// kick: four on the floor, out for the build into 155 (12–14) and the terminal breakdown (32.5–37.5)
for (let t = 0; t < 48.01; t += BEAT)
  if (inR(t, [0, 12], [14, 32.5], [37.5, 48.01]) && !near(t, HITS, 0.15)) kick(t, t < 5 ? 0.5 : 0.55);
// clap on 2 and 4
for (let t = BEAT; t < 46; t += 2 * BEAT)
  if (inR(t, [5, 12], [14, 32.5], [37.5, 45.5]) && !near(t, HITS, 0.15)) clap(t, 0.32);
// hats: off-beat 8ths everywhere until the last bar, 16ths in the grooves, soft 16ths in the breakdown
for (let k = 0; k * 0.125 < 48; k++) {
  const t = k * 0.125, off8 = k % 4 === 2;
  if (off8 && !inR(t, [32.5, 37.5])) hat(t, 0.11, true, 0.2);
  else if (!off8 && inR(t, [5, 12], [14, 32.5], [37.5, 45.5])) hat(t, k % 2 ? 0.035 : 0.055, false, -0.2);
  else if (inR(t, [32.5, 37.5])) hat(t, k % 2 ? 0.025 : 0.045, false, -0.15);
}
// bass: rolling 8ths on the chord root (accented off-beats, octave pickup at the end of each bar), then the final root
for (let k = 0; k * 0.25 < 48; k++) {
  const t = k * 0.25;
  if (!inR(t, [5, 12], [14, 32.5], [37.5, 48])) continue;
  const r = ROOT[chordAt(t + 0.01)], up = Math.abs((t % 2) - 1.75) < 1e-6;
  bassNote(t, r + (up ? 12 : 0), 0.21, k % 2 ? 0.4 : 0.26);
}
bassNote(EV.final, ROOT.D, 2.6, 0.34);
// chord stabs on the up-beats of 2 and 4 (only the 4 in the first groove)
for (let b = 0; b < 26; b++) for (const off of [0.75, 1.75]) {
  const t = b * 2 + off;
  if (inR(t, [14, 21.5], [37.5, 45.5]) || (off === 1.75 && inR(t, [5, 12]))) stab(t, CH[chordAt(t)], 0.2);
}
// arp: 16th plucks over the chord an octave up; brightness opens in the intro, the build and the breakdown
const arpLv = auto([[0, 0.26], [5, 0.2], [12, 0.22], [14, 0.3], [14.01, 0.18], [21.5, 0.14], [32.5, 0.28], [37.5, 0.18], [45.5, 0.16], [48, 0.1]]);
const arpCut = auto([[0, 1300], [5, 2600], [12, 900], [14, 5200], [14.01, 2400], [21.5, 2000], [32.5, 1000], [37.5, 4200], [37.51, 2400], [48, 1500]]);
const PAT = [0, 1, 2, 3, 2, 1, 2, 3];
for (let k = 0; k * 0.125 < 48; k++) {
  const t = k * 0.125, ch = CH[chordAt(t + 0.01)], m = ch[PAT[k % 8] % ch.length] + 12;
  pluck(t, m, arpLv(t) * (k % 4 === 0 ? 1.15 : 1), k % 2 ? 0.3 : -0.3, arpCut(t));
}
// pad: detuned saws, levels follow the scenes (up in the build, the breakdown and the outro)
const padLv = auto([[0, 0.07], [5, 0.065], [12, 0.08], [13.9, 0.13], [14, 0.065], [32.5, 0.065], [33.5, 0.13], [37.4, 0.13], [37.6, 0.065], [45.5, 0.075], [48, 0.12], [51, 0.12]]);
PROG.forEach(([s, name], j) => {
  const e = j + 1 < PROG.length ? PROG[j + 1][0] : DUR, len = e - s;
  CH[name].forEach((m, n) => [-6, 6].forEach((det, side) => {
    const o = new Saw((n * 0.23 + side * 0.41) % 1), f = new SVF(), hz = mtof(m) * Math.pow(2, det / 1200);
    voice(s, len + 0.6, { bus: SC, pan: side ? 0.55 : -0.55, rev: 0.35 }, (x) => {
      f.set(1100 + 250 * Math.sin(TAU * 0.25 * (s + x)), 0.7);
      const env = Math.min(1, x / 0.12) * Math.min(1, Math.max(0, (len + 0.6 - x) / 0.6));
      return padLv(s + x) * f.run(o.next(hz)).lp * env;
    });
  }));
});

// ---------- scene events ----------
// cold open: headline pop
pop(EV.coldHeadline, 0.16, 820);
// into the memory scene
riser(4.0, CUTS[0], 0.22); crash(CUTS[0], 0.08, 0.8);
pop(EV.memHeadline, 0.15, 880);
bell(EV.barFull, 81, 0.12, 0.2); pop(EV.barFull, 0.12, 1050, 0.2);   // memory bar full: "it fits"
pop(EV.spillCard, 0.1, 760, -0.1);
// into the speed scene; the build rolls while the counter runs 0 → 155
whoosh(CUTS[1], 0.32, 0.8, 0.3);
riser(EV.countStart, EV.land155, 0.26, 300, 8000);
for (let t = 12, k = 0; t < EV.land155 - 1e-6; k++) {
  const step = t < 13 ? 0.25 : t < 13.5 ? 0.125 : 0.0625;
  snare(t, 0.06 + 0.16 * ((t - 12) / 2) ** 2, { bus: FX, pan: k % 2 ? 0.15 : -0.15, rev: 0.12 });
  t += step;
}
// 155 lands
kick(EV.land155, 0.7); sub(EV.land155, 0.5); crash(EV.land155, 0.2, 1.3);
stab(EV.land155, CH.D, 0.3, 0.9, FX); bell(EV.land155, 86, 0.12, 0, 1.2);
pop(EV.card19, 0.13, 900, -0.2); pop(EV.caveat, 0.08, 700, -0.2);
// into the quality scene: ring fills (ascending chime, panning round), ring completes, four cards pop
whoosh(CUTS[2], 0.3); crash(CUTS[2], 0.07, 0.7);
pop(EV.qualHeadline, 0.13, 880);
{
  const PENTA = [62, 64, 66, 69, 71], n = 15; // D major pentatonic, D4 → B6
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), t = EV.ringStart + u * (EV.ringEnd - EV.ringStart);
    bell(t, PENTA[i % 5] + 12 * Math.floor(i / 5), 0.035 + 0.035 * u, Math.sin(u * TAU) * 0.6, 0.35);
  }
}
for (const m of [81, 86, 90]) bell(EV.ringDone, m, 0.075, 0, 1.0);
pop(EV.ringDone, 0.15, 1000);
EV.cards.forEach((t, i) => { pop(t, 0.16, 860 + i * 90, 0.3); bell(t, [81, 83, 86, 88][i], 0.09, 0.3, 0.6); });
// into the terminal breakdown, then the build back into the dashboard
whoosh(CUTS[3], 0.28); crash(CUTS[3], 0.06, 0.9);
riser(36.0, EV.dashboard, 0.2, 300, 6500);
for (let t = 36.5, k = 0; t < EV.dashboard - 1e-6; k++) {
  snare(t, 0.04 + 0.09 * ((t - 36.5) / 1) ** 2, { bus: FX, pan: k % 2 ? 0.15 : -0.15, rev: 0.12 });
  t += t < 37 ? 0.125 : 0.0625;
}
kick(EV.dashboard, 0.65); sub(EV.dashboard, 0.35); crash(EV.dashboard, 0.14, 1.0);
pop(EV.dashHeadline, 0.12, 880);
EV.stats.forEach((t, i) => pop(t, 0.14, 820 + i * 120, -0.3));
// 20/20 badge
kick(EV.badge, 0.7); sub(EV.badge, 0.45); crash(EV.badge, 0.18, 1.3); pop(EV.badge, 0.16, 1100, 0.3);
stab(EV.badge, CH.D, 0.26, 0.9, FX);
for (const m of [74, 78, 81, 86]) bell(EV.badge, m, 0.07, 0.3, 1.1);
// outro: cadence G – A – D, last downbeat rings out
whoosh(CUTS[4], 0.26); crash(CUTS[4], 0.06, 0.9);
pop(EV.outroHeadline, 0.1, 820);
kick(EV.final, 0.55); crash(EV.final, 0.07, 1.5);
for (const m of [62, 69, 74, 78, 81]) bell(EV.final, m, 0.05, 0, 1.6);

// ---------- mix ----------
// side-chain: music ducks under every kick
const duck = new Float32Array(N).fill(1);
for (const t of kicks) {
  const i0 = Math.round(t * SR);
  for (let n = 0; n < 0.35 * SR; n++) { const i = i0 + n; if (i >= N) break; const x = n / SR; duck[i] = Math.min(duck[i], 1 - 0.55 * Math.exp(-x / 0.09) * att(x, 0.004)); }
}
// ping-pong delay, dotted 8th
const DL = { L: new Float32Array(N), R: new Float32Array(N) };
{
  const d = Math.round(0.375 * SR), lp = [0, 0];
  for (let i = 0; i < N; i++) {
    const fl = i >= d ? DL.R[i - d] : 0, fr = i >= d ? DL.L[i - d] : 0;
    lp[0] += 0.35 * (fl - lp[0]); lp[1] += 0.35 * (fr - lp[1]);
    DL.L[i] = DLY[i] + 0.38 * lp[0]; DL.R[i] = 0.38 * lp[1];
  }
}
// Freeverb (Jezar's public-domain design), stereo
const RV = { L: new Float32Array(N), R: new Float32Array(N) };
{
  const sc = SR / 44100, COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AP = [556, 441, 341, 225];
  const room = 0.84, damp = 0.35;
  ([[RV.L, 0], [RV.R, 23]] as const).forEach(([out, spread]) => {
    const combs = COMB.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * sc)), i: 0, s: 0 }));
    const aps = AP.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * sc)), i: 0 }));
    for (let i = 0; i < N; i++) {
      const x = REV[i] * 0.03;
      let y = 0;
      for (const c of combs) { const o = c.buf[c.i]; c.s = o * (1 - damp) + c.s * damp; c.buf[c.i] = x + c.s * room; if (++c.i >= c.buf.length) c.i = 0; y += o; }
      for (const p of aps) { const b = p.buf[p.i], o = -y + b; p.buf[p.i] = y + b * 0.5; if (++p.i >= p.buf.length) p.i = 0; y = o; }
      out[i] = y;
    }
  });
}
const L = new Float32Array(N), R = new Float32Array(N);
{
  let hpL = 0, hpR = 0, xl = 0, xr = 0;
  const hc = Math.exp(-TAU * 28 / SR); // 28 Hz DC/rumble high-pass
  for (let i = 0; i < N; i++) {
    let l = DRY.L[i] + SC.L[i] * duck[i] + FX.L[i] + 0.3 * DL.L[i] + 0.9 * RV.L[i];
    let r = DRY.R[i] + SC.R[i] * duck[i] + FX.R[i] + 0.3 * DL.R[i] + 0.9 * RV.R[i];
    hpL = hc * (hpL + l - xl); xl = l; hpR = hc * (hpR + r - xr); xr = r;
    L[i] = hpL; R[i] = hpR;
  }
}
// gentle soft-clip after peak-normalizing to -1 dBFS, then fade-in 0.15 s / fade-out over the last 1.5 s
{
  let pk = 0;
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.89 / pk, drive = 1.4;
  for (let i = 0; i < N; i++) {
    const t = i / SR, fi = Math.min(1, t / 0.15), fo = t > DUR - 1.5 ? Math.cos(((t - (DUR - 1.5)) / 1.5) * (Math.PI / 2)) : 1;
    const f = fi * fo * fo;
    L[i] = (Math.tanh(drive * L[i] * g) / Math.tanh(drive)) * f;
    R[i] = (Math.tanh(drive * R[i] * g) / Math.tanh(drive)) * f;
  }
}

// ---------- write + loudness ----------
function wav(path: string, l: Float32Array, r: Float32Array) {
  const buf = Buffer.alloc(44 + N * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 8, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write("data", 36); buf.writeUInt32LE(N * 8, 40);
  for (let i = 0; i < N; i++) { buf.writeFloatLE(l[i], 44 + i * 8); buf.writeFloatLE(r[i], 48 + i * 8); }
  writeFileSync(path, buf);
}
mkdirSync("out", { recursive: true });
wav("out/music-premaster.wav", L, R);
if (a.stem) { wav("out/stem-fx.wav", FX.L, FX.R); console.log("wrote out/stem-fx.wav"); }

const FF = ffmpeg as unknown as string, I = -16, TP = -1.5, LRA = 11;
const loudnorm = (pre: string, extra = "") => {
  const r = spawnSync(FF, ["-hide_banner", "-nostats", "-i", "out/music-premaster.wav", "-af",
    `${pre}loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json${extra}`, ...(extra ? ["-ar", String(SR), "-c:a", "pcm_s24le", "-y", "out/music.wav"] : ["-f", "null", "-"])], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1));
};
// pass 1: measure. If a linear gain would push the true peak over the target, pre-limit the peaks first.
let pre = "", m = loudnorm(pre);
if (I - Number(m.input_i) + Number(m.input_tp) > TP) {
  const lim = Math.pow(10, (TP - 0.3 - (I - Number(m.input_i))) / 20);
  pre = `alimiter=limit=${lim.toFixed(4)}:attack=3:release=60:level=false,`;
  m = loudnorm(pre);
}
// pass 2: linear normalization with the measured values
const fin = loudnorm(pre, `:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`);
console.log(`premaster ${m.input_i} LUFS, TP ${m.input_tp} dBTP, LRA ${m.input_lra}${pre ? " (peak-limited)" : ""} → out/music.wav ${fin.output_i} LUFS, TP ${fin.output_tp} dBTP (${fin.normalization_type})`);
