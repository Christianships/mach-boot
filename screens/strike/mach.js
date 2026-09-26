// MACH intro — targeting-pod HUD: F-15E drops a TNT block on a camo voxel "MACH".
// Everything is a pure function of time t, so any frame can be rendered with ?seek=<t>.
// Layers: `low` = pixel art (camo voxels, explosion) upscaled crisp; `O` = HUD, jet, bomb.
(() => {
'use strict';

const q = new URLSearchParams(location.search);
const PREVIEW = q.has('preview');
const SEEK = q.has('seek') ? parseFloat(q.get('seek')) : null;
const PX = 3; // CSS px per art pixel

// Timeline (seconds) — gen_sounds.py mirrors these.
const T = { ACQ: 0.6, LOCK: 1.3, REL: 2.2, IMP: 3.7, BDA: 4.0, OUT: 5.8, END: 6.4 };

// ---------- helpers ----------
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
const h2 = (a, b) => hash(Math.imul(a | 0, 73856093) ^ Math.imul((b | 0) + 1, 19349663));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - (1 - t) ** 3;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const abgr = h => { const [r, g, b] = hex(h); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };
const blink = (t, hz) => Math.floor(t * hz) % 2 === 0;

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const n = (i, j) => h2(i * 131 + s * 7919, j);
  return lerp(lerp(n(xi, yi), n(xi + 1, yi), u), lerp(n(xi, yi + 1), n(xi + 1, yi + 1), u), v);
}

// ---------- palette (gray / black / white only) ----------
const CAMO = ['#141414', '#4b4d50', '#8e9196', '#e6e7e9'].map(abgr);
const HUD = '#f4f5f6', HUD_SH = 'rgba(0,0,0,0.55)';
const FIRE = ['#ffffff', '#fff1c9', '#ffc86b', '#ff9a33', '#f06a1c', '#b8461a', '#6b4636', '#3e3e3e'].map(abgr);
const SMOKE = ['#333333', '#1a1a1a'].map(abgr);
const MUSH = ['#fff6e6', '#ffc27a', '#f0883a', '#b77d59', '#8a8581', '#626060', '#434242', '#2a2a2a'].map(abgr);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------- 7x7 voxel font ----------
const GLYPHS = {
  M: ['XX...XX', 'XXX.XXX', 'XXXXXXX', 'XX.X.XX', 'XX...XX', 'XX...XX', 'XX...XX'],
  A: ['.XXXXX.', 'XXXXXXX', 'XX...XX', 'XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX'],
  C: ['.XXXXXX', 'XXXXXXX', 'XX.....', 'XX.....', 'XX.....', 'XXXXXXX', '.XXXXXX'],
  H: ['XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX'],
};
const WORD = 'MACH', GW = 7, GH = 7, GAP = 2;
const COLS = WORD.length * GW + (WORD.length - 1) * GAP;

// ---------- F-15E side profile (nose +x); the payload is a TNT block ----------
const F15 = {
  body: [[100, 16], [92, 14.4], [82, 12.6], [76, 9.2], [70, 8.2], [64, 8.6], [58, 11.2], [40, 11.6], [30, 11.2],
         [24, 10.8], [17, 0.5], [11.5, 0.5], [9, 11], [3, 11.6], [0, 13.2], [0, 17.6], [5, 18.6], [18, 19.2],
         [54, 19.6], [57, 21.8], [71, 21.8], [73, 18.4], [86, 17.6]],
  fin2: [[28, 11.2], [21.5, 2.6], [16.5, 2.6], [14, 11.2]],
  stab: [[17, 18.2], [3, 22], [1, 20.8], [6, 17.8]],
  wing: [[58, 17.4], [30, 18.6], [26, 20.2], [50, 19.6]],
  canopy: [[81, 12.7], [75.5, 9.6], [70, 8.8], [64.5, 9.2], [60, 11.3]],
};
const TNT_TEXT = [ // label band rows 5..10 of the 16x16 block
  '................',
  '..###.#..#.###..',
  '...#..##.#..#...',
  '...#..#.##..#...',
  '...#..#..#..#...',
  '................',
];
// ---------- canvases ----------
const cv = document.getElementById('c'), O = cv.getContext('2d');
const low = document.createElement('canvas'), L = low.getContext('2d');
const glow = document.createElement('canvas'), G = glow.getContext('2d');
const fx = document.createElement('canvas'), F = fx.getContext('2d');
const camo = document.createElement('canvas'), CM = camo.getContext('2d');

let CW, CH, W, H, dpr, C, D, x0, y0, K, FS;
let voxels = [], cells = new Set(), fxImg, fxBuf, fxDirty = false, blobs = [], sparks = [];

function setup() {
  dpr = devicePixelRatio || 1;
  CW = innerWidth; CH = innerHeight;
  cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
  W = Math.ceil(CW / PX); H = Math.ceil(CH / PX);
  low.width = fx.width = W; low.height = fx.height = H;
  glow.width = Math.ceil(W / 4); glow.height = Math.ceil(H / 4);
  fxImg = F.createImageData(W, H);
  fxBuf = new Uint32Array(fxImg.data.buffer);
  L.imageSmoothingEnabled = false;
  K = W / 490;
  FS = Math.max(11, Math.round(CW / 118));

  C = Math.max(4, Math.floor(W * 0.5 / COLS));
  D = Math.max(2, Math.round(C * 0.5));
  x0 = Math.round((W - COLS * C) / 2);
  y0 = Math.round((H - GH * C) / 2);

  voxels = []; cells = new Set();
  [...WORD].forEach((ch, li) => GLYPHS[ch].forEach((row, r) => [...row].forEach((cell, k) => {
    if (cell !== 'X') return;
    const id = voxels.length, col = li * (GW + GAP) + k;
    const v = { id, col, row: r, x: x0 + col * C, y: y0 + r * C };
    for (let j = 1; j <= 6; j++) v['r' + j] = h2(id, j * 17);
    voxels.push(v); cells.add(col + ',' + r);
  })));

  // digital camo texture in 2px blocks, word-space
  camo.width = COLS * C; camo.height = GH * C;
  const img = CM.createImageData(camo.width, camo.height), buf = new Uint32Array(img.data.buffer);
  for (let y = 0; y < camo.height; y++) {
    for (let x = 0; x < camo.width; x++) {
      const bx = x >> 1, by = y >> 1;
      const n = vnoise(bx / 7, by / 7, 1) * 0.62 + vnoise(bx / 3, by / 3, 2) * 0.38;
      buf[y * camo.width + x] = CAMO[n < 0.38 ? 0 : n < 0.52 ? 1 : n < 0.66 ? 2 : 3];
    }
  }
  CM.putImageData(img, 0, 0);

  blobs = [];
  for (let i = 0; i < 130; i++) {
    const late = i >= 90;
    blobs.push({
      ang: h2(i, 1) * Math.PI * 2,
      spd: (late ? 0.1 + h2(i, 2) * 0.5 : 0.25 + h2(i, 2) ** 0.7) * 150 * K,
      delay: late ? 0.07 + h2(i, 3) * 0.32 : h2(i, 3) * 0.06,
      life: 0.4 + h2(i, 4) * 0.55,
      rmax: (6 + h2(i, 5) * 17) * K,
      rise: (20 + h2(i, 6) * 50) * K,
      smoke: 0.8 + h2(i, 7) * 1.0,
    });
  }
  sparks = [];
  for (let i = 0; i < 110; i++) {
    sparks.push({
      ang: -Math.PI * (0.05 + h2(i, 21) * 0.9) + (h2(i, 26) < 0.2 ? Math.PI * h2(i, 27) : 0),
      spd: (140 + h2(i, 22) * 340) * K,
      life: 0.5 + h2(i, 23) * 1.1,
      big: h2(i, 24) > 0.8,
    });
  }
}

// word geometry in CSS px
const wordBox = () => ({ x: x0 * PX, y: y0 * PX, w: (COLS * C + D) * PX, h: (GH * C + D) * PX });
const target = () => ({ x: (x0 + COLS * C / 2) * PX, y: (y0 + GH * C / 2) * PX });

// ---------- pixel layer ----------
function disc(cx, cy, r, col, dens, seed, rough = 0.55) {
  if (r < 1) return;
  const rr = r * r, rim = (r - 2) * (r - 2), th = dens * 16;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dy * dy;
      if (d > rr) continue;
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      if (d > rr * rough && d > rr * (rough + (1 - rough) * h2(seed, ((x >> 1) * 7919) ^ ((y >> 1) * 104729)))) continue;
      if (BAYER[(y & 3) * 4 + (x & 3)] >= (d > rim ? th * 0.5 : th)) continue;
      fxBuf[y * W + x] = col;
    }
  }
  fxDirty = true;
}

function flushFx() {
  if (!fxDirty) return;
  F.putImageData(fxImg, 0, 0);
  L.drawImage(fx, 0, 0);
  fxBuf.fill(0);
  fxDirty = false;
}

function ring(x, y, r, th, color, dither) {
  L.fillStyle = color;
  const n = Math.max(16, Math.ceil(Math.PI * 2 * r / 1.2));
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const px = Math.round(x + Math.cos(a) * r), py = Math.round(y + Math.sin(a) * r * 0.55);
    if (dither && ((px + py) & 1)) continue;
    L.fillRect(px, py, th, th);
  }
}

const has = (c, r) => cells.has(c + ',' + r);

function drawWord() {
  for (const v of voxels) {
    for (let i = D; i >= 1; i--) {
      L.fillStyle = i > D * 0.66 ? '#0c0c0d' : i > D * 0.33 ? '#18191a' : '#26272a';
      L.fillRect(v.x + i, v.y + i, C, C);
    }
  }
  for (const v of voxels) L.drawImage(camo, v.col * C, v.row * C, C, C, v.x, v.y, C, C);
  L.fillStyle = '#000';
  for (const v of voxels) {
    if (!has(v.col, v.row - 1)) L.fillRect(v.x, v.y, C, 1);
    if (!has(v.col, v.row + 1)) L.fillRect(v.x, v.y + C - 1, C, 1);
    if (!has(v.col - 1, v.row)) L.fillRect(v.x, v.y, 1, C);
    if (!has(v.col + 1, v.row)) L.fillRect(v.x + C - 1, v.y, 1, C);
  }
}

// Mushroom cloud: rolling cap on a rising stem, plus a ground base surge. Draws into fx.
function mushroom(ai, ix, iy) {
  const ms = ai - 0.2;
  if (ms < 0) return;
  const p = easeOutCubic(clamp(ms / 2.2));
  const capY = iy - lerp(8, H * 0.25, p);
  const capR = lerp(8, 50, p) * K, capH = capR * 0.42;
  const cool = ms * 1.6;
  const shade = (base, extra) => MUSH[Math.min(MUSH.length - 1, Math.max(0, Math.floor(base + extra)))];

  // base surge rolling out along the ground
  const sp = easeOutCubic(clamp(ms / 1.6)) * 95 * K;
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, u = h2(i, 401);
    const x = ix + side * sp * (0.25 + 0.75 * u), y = iy + (3 + h2(i, 402) * 4) * K;
    disc(Math.round(x), Math.round(y), Math.round((5 + h2(i, 403) * 6) * K * (0.6 + p * 0.6)),
      shade(4 + cool * 0.4, h2(i, 404) * 2), clamp(1 - ms / 3.2) * 0.9, 500 + i);
  }

  // stem: blobs scrolling upward, wide at the base, pinched, flaring into the cap
  const top = capY + capH * 0.6, len = iy - top;
  if (len > 2) {
    const step = 4 * K, scroll = (ms * 30 * K) % step;
    for (let k = 0; k * step < len + step; k++) {
      const y = iy - k * step - scroll;
      if (y < top) break;
      const f = (iy - y) / len;
      const w = (f < 0.15 ? lerp(13, 8, f / 0.15) : f > 0.8 ? lerp(8, 12, (f - 0.8) / 0.2) : 8) * K;
      const x = ix + Math.sin(k * 0.7 + ms * 2) * 1.5 * K;
      disc(Math.round(x), Math.round(y), Math.round(w * (0.85 + h2(k, 411) * 0.3)),
        shade(2 + cool * 0.5, 1 + (1 - f) * 2), 1, 600 + k, 0.8);
    }
  }

  // cap: blobs orbiting the torus cross-section (outside rolls up, underside rolls in)
  for (let i = 0; i < 36; i++) {
    const th = h2(i, 421) * Math.PI * 2 + ms * (0.9 + h2(i, 422) * 0.5);
    const rr = 0.55 + 0.45 * h2(i, 423);
    const x = ix + Math.cos(th) * capR * rr;
    const y = capY + Math.sin(th) * capH * rr - capH * 0.35 * (1 - Math.abs(Math.cos(th)));
    const under = Math.sin(th) > 0 ? 2 : 0;
    disc(Math.round(x), Math.round(y), Math.round(capR * (0.28 + h2(i, 424) * 0.18)),
      shade(cool * 0.8, under + h2(i, 425)), 1, 700 + i, 0.8);
  }
  // crown on top
  for (let i = 0; i < 8; i++) {
    const x = ix + (h2(i, 431) - 0.5) * capR * 1.1, y = capY - capH * (0.55 + h2(i, 432) * 0.3);
    disc(Math.round(x), Math.round(y), Math.round(capR * (0.22 + h2(i, 433) * 0.12)), shade(cool * 0.8, 0), 1, 800 + i, 0.8);
  }
}

function drawChunk(v, x, y, s, ox, oy, heat) {
  const n = Math.max(Math.abs(ox), Math.abs(oy));
  L.fillStyle = '#18191a';
  for (let i = n; i >= 1; i--) L.fillRect(x + Math.round(ox * i / n), y + Math.round(oy * i / n), s, s);
  L.drawImage(camo, v.col * C, v.row * C, C, C, x, y, s, s);
  L.fillStyle = '#000';
  L.fillRect(x, y, s, 1); L.fillRect(x, y + s - 1, s, 1); L.fillRect(x, y, 1, s); L.fillRect(x + s - 1, y, 1, s);
  if (heat > 0) {
    L.globalAlpha = heat; L.fillStyle = heat > 0.55 ? '#ffe2b0' : '#ff8a2a'; L.fillRect(x, y, s, s); L.globalAlpha = 1;
  }
}

function renderLow(t) {
  const out = { shake: 0, bloom: 0.15, glitch: 0, flash: 0, flashColor: '#ffffff' };
  const ai = t - T.IMP;
  const ix = x0 + COLS * C / 2, iy = y0 + GH * C / 2;

  if (ai < 0) {
    if (t < 0.45) return out;
    // FLIR scan-in
    const p = clamp((t - 0.45) / 0.4);
    const top = y0 - 2, bot = y0 + GH * C + D + 2;
    const sy = Math.round(lerp(top, bot, p));
    L.save(); L.beginPath(); L.rect(0, 0, W, sy); L.clip(); drawWord(); L.restore();
    if (p < 1) {
      L.fillStyle = '#ffffff';
      L.globalAlpha = 0.9; L.fillRect(x0 - 8, sy, COLS * C + D + 16, 1);
      L.globalAlpha = 0.3; L.fillRect(x0 - 8, sy - 2, COLS * C + D + 16, 1);
      const b = Math.floor(t * 40);
      for (let k = 0; k < 40; k++) {
        L.globalAlpha = 0.6 * h2(b, k);
        L.fillRect(Math.round(x0 + h2(b, k + 99) * COLS * C), sy + 1 + Math.floor(h2(b, k + 199) * 4), 2, 1);
      }
      L.globalAlpha = 1;
    }
    return out;
  }

  // camo voxels blasted outward, tumbling toward the camera
  const debris = [];
  for (const v of voxels) {
    const vx0 = v.x + C / 2, vy0 = v.y + C / 2;
    const dx = vx0 - ix, dy = vy0 - iy, dist = Math.hypot(dx, dy) || 1;
    const a = ai - dist / (1400 * K);
    if (a < 0) { debris.push({ v, x: v.x, y: v.y, s: C, sc: 1, ox: D, oy: D, heat: 0.6 }); continue; }
    const fall = clamp(1.7 - dist / (W * 0.22), 0.55, 1.7);
    const sp = (200 + v.r2 * 300) * fall * K;
    const vx = dx / dist * sp + (v.r3 - 0.5) * 80 * K;
    const vy = dy / dist * sp * 0.8 - (150 + v.r4 * 230) * K;
    const g = 540 * K;
    const x = vx0 + vx * a, y = vy0 + vy * a + 0.5 * g * a * a;
    const sc = Math.min(7, 1 + (0.15 + v.r5 ** 2 * 2.4) * a * 2);
    const s = Math.round(C * sc);
    if (x + s < -10 || x - s > W + 10 || y - s > H + 10) continue;
    const th = v.r6 * 6.28 + a * (v.r1 - 0.5) * 22;
    debris.push({
      v, x: Math.round(x - s / 2), y: Math.round(y - s / 2), s, sc,
      ox: Math.round(Math.cos(th) * D * sc), oy: Math.round(Math.sin(th) * D * sc),
      heat: clamp(1.25 - dist / (W * 0.2)) * clamp(1 - a / 0.7) * 0.9,
    });
  }
  debris.sort((p, q) => p.sc - q.sc);
  for (const d of debris) if (d.sc < 1.6) drawChunk(d.v, d.x, d.y, d.s, d.ox, d.oy, d.heat);

  // white-hot fireball → black smoke, dithered
  const live = [];
  blobs.forEach((b, i) => {
    const a = ai - b.delay;
    if (a >= 0 && a <= b.life + b.smoke) live.push([b, a, a / b.life, i + 1]);
  });
  live.sort((p, q) => q[2] - p[2]);
  for (const [b, a, p, seed] of live) {
    const e = easeOutCubic(Math.min(1, p));
    const x = ix + Math.cos(b.ang) * b.spd * e * 0.95;
    let y = iy + Math.sin(b.ang) * b.spd * e * 0.6 - b.rise * a;
    if (p <= 1) {
      const r = b.rmax * (p < 0.25 ? 0.35 + 0.65 * p / 0.25 : 1 - (p - 0.25) * 0.25);
      disc(Math.round(x), Math.round(y), Math.round(r), FIRE[Math.min(FIRE.length - 1, Math.floor(p * FIRE.length))], 1, seed);
    } else {
      const s = (a - b.life) / b.smoke;
      y -= b.rise * (a - b.life) * 1.2;
      disc(Math.round(x), Math.round(y), Math.round(b.rmax * (0.8 + s * 0.6)), SMOKE[s < 0.35 ? 0 : 1], (1 - s) * 0.85, seed);
    }
  }
  mushroom(ai, ix, iy);
  if (ai < 0.14) disc(Math.round(ix), Math.round(iy), Math.round((10 + ai * 260) * K), FIRE[0], 1, 999);
  flushFx();

  for (const d of debris) if (d.sc >= 1.6) drawChunk(d.v, d.x, d.y, d.s, d.ox, d.oy, d.heat);

  // sparks
  const fb = Math.floor(t * 30);
  sparks.forEach((e, i) => {
    if (ai > e.life) return;
    const x = ix + Math.cos(e.ang) * e.spd * ai;
    const y = iy + Math.sin(e.ang) * e.spd * ai * 0.8 + 0.5 * 420 * K * ai * ai;
    L.globalAlpha = clamp(1.3 - ai / e.life);
    L.fillStyle = h2(fb, i) > 0.7 ? '#ffffff' : h2(fb, i) > 0.3 ? '#ffb040' : '#ff6a1a';
    L.fillRect(Math.round(x), Math.round(y), e.big ? 2 : 1, e.big ? 2 : 1);
  });
  L.globalAlpha = 1;

  // ground shockwave
  if (ai < 0.55) {
    const f = 1 - ai / 0.55;
    L.globalAlpha = f; ring(ix, iy + GH * C * 0.3, 8 + ai * 520 * K, 2, '#ffd9a0', true);
    L.globalAlpha = f * 0.6; ring(ix, iy + GH * C * 0.3, 4 + ai * 360 * K, 1, '#bdbdbd', false);
    L.globalAlpha = 1;
  }

  out.shake = 8 * Math.exp(-ai * 4.5);
  out.bloom = 0.2 + 0.5 * Math.exp(-ai * 8);
  if (ai < 0.15) out.glitch = 1;
  if (ai < 0.12) { out.flash = 0.75 * (1 - ai / 0.12); out.flashColor = '#fff0d8'; }
  else if (ai < 0.5) { out.flash = 0.22 * (1 - (ai - 0.12) / 0.38); out.flashColor = '#000000'; }
  return out;
}

// ---------- vector layer: jet, bomb ----------
const jetLen = () => Math.max(170, CW * 0.15);
const jetPos = t => ({ x: CW * (0.3 + 1.1 * (t - T.REL)), y: CH * 0.19 + Math.sin(t * 1.3) * 3 });

function poly(pts, tx, ty, s, fill, stroke) {
  O.beginPath();
  pts.forEach(([x, y], i) => i ? O.lineTo(tx + x * s, ty + y * s) : O.moveTo(tx + x * s, ty + y * s));
  O.closePath();
  if (fill) { O.fillStyle = fill; O.fill(); }
  if (stroke) { O.strokeStyle = stroke; O.lineWidth = 1.2; O.stroke(); }
}

function drawJet(t) {
  const Lj = jetLen(), s = Lj / 100, { x, y } = jetPos(t);
  if (x < -Lj || x > CW + Lj) return;
  const tx = x - Lj / 2, ty = y - 14 * s;
  // afterburner (white-hot in FLIR)
  const fl = h2(Math.floor(t * 50), 3);
  O.globalAlpha = 0.35;
  poly([[0, 12.8], [-26 - fl * 8, 15.4], [0, 18]], tx, ty, s, '#ffffff');
  O.globalAlpha = 0.95;
  poly([[0, 13.8], [-13 - fl * 5, 15.4], [0, 17]], tx, ty, s, '#ffffff');
  O.globalAlpha = 1;
  poly(F15.fin2, tx, ty, s, '#2a2d32', '#0b0c0e');
  poly(F15.body, tx, ty, s, '#3f434a', '#0b0c0e');
  poly(F15.wing, tx, ty, s, '#33373d', '#0b0c0e');
  poly(F15.stab, tx, ty, s, '#2e3136', '#0b0c0e');
  poly(F15.canopy, tx, ty, s, '#0f1113', '#8a9099');
  // top-edge highlight
  O.beginPath(); O.moveTo(tx + 92 * s, ty + 14.4 * s); O.lineTo(tx + 82 * s, ty + 12.6 * s);
  O.moveTo(tx + 58 * s, ty + 11.2 * s); O.lineTo(tx + 26 * s, ty + 10.9 * s);
  O.strokeStyle = '#b7bdc6'; O.lineWidth = 1; O.stroke();
  O.fillStyle = '#e9ecef'; O.fillRect(tx + 72 * s, ty + 9.6 * s, 3 * s, 0.8 * s); // canopy glint
  if (t < T.REL) drawTNT(tx + 44 * s, ty + 21.4 * s + Lj * 0.1, 0, Lj * 0.2, false);
}

function tntColor(c, r) {
  if (r === 4 || r === 11) return '#9c9c9c';
  if (r > 4 && r < 11) return TNT_TEXT[r - 5][c] === '#' ? '#161616' : '#ececec';
  return ((c + (r < 4 ? 0 : 1)) >> 1) % 2 ? '#a3211b' : '#d8342a';
}

function drawTNT(x, y, ang, size, flash) {
  const px = size / 16;
  O.save();
  O.translate(x, y); O.rotate(ang);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      O.fillStyle = tntColor(c, r);
      O.fillRect(-size / 2 + c * px, -size / 2 + r * px, px + 0.6, px + 0.6);
    }
  }
  O.strokeStyle = '#0b0c0e'; O.lineWidth = 1.2;
  O.strokeRect(-size / 2, -size / 2, size, size);
  if (flash) { O.globalAlpha = 0.6; O.fillStyle = '#ffffff'; O.fillRect(-size / 2, -size / 2, size, size); }
  O.restore();
}

function bombState(t) {
  const Lj = jetLen(), s = Lj / 100, j = jetPos(T.REL);
  const xr = j.x - Lj / 2 + 44 * s, yr = j.y - 14 * s + 21.4 * s + Lj * 0.1;
  const tg = target(), Tf = T.IMP - T.REL, p = clamp((t - T.REL) / Tf);
  const x = xr + (tg.x - xr) * (2 * p - p * p), y = yr + (tg.y - yr) * p * p;
  const ang = Math.atan2((tg.y - yr) * 2 * p, (tg.x - xr) * (2 - 2 * p) + 1e-6);
  // primed TNT: tumbles and flashes faster as it nears the ground
  return { x, y, ang: (t - T.REL) * 3.2, size: Lj * 0.2, flash: blink(t - T.REL, 4 + 10 * p) };
}

// ---------- HUD ----------
function hudPath(pts, dashed, width = 1.5) {
  O.beginPath();
  pts.forEach(([x, y], i) => i ? O.lineTo(x, y) : O.moveTo(x, y));
  O.setLineDash(dashed ? [6, 5] : []);
  O.lineCap = 'square';
  O.strokeStyle = HUD_SH; O.lineWidth = width + 2; O.stroke();
  O.strokeStyle = HUD; O.lineWidth = width; O.stroke();
  O.setLineDash([]);
}

function hudText(s, x, y, align = 'left', size = FS, inverse = false) {
  if (!s) return;
  O.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  O.textAlign = align; O.textBaseline = 'middle';
  if (inverse) {
    const w = O.measureText(s).width;
    const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    O.fillStyle = HUD; O.fillRect(bx - 6, y - size * 0.8, w + 12, size * 1.6);
    O.fillStyle = '#000'; O.fillText(s, x, y);
    return;
  }
  O.lineWidth = 3; O.strokeStyle = HUD_SH; O.strokeText(s, x, y);
  O.fillStyle = HUD; O.fillText(s, x, y);
}

function brackets(x, y, w, h, len) {
  if (len <= 0) return;
  hudPath([[x, y + len], [x, y], [x + len, y]]);
  hudPath([[x + w - len, y], [x + w, y], [x + w, y + len]]);
  hudPath([[x, y + h - len], [x, y + h], [x + len, y + h]]);
  hudPath([[x + w - len, y + h], [x + w, y + h], [x + w, y + h - len]]);
}

function typed(s, t0, t, cps = 70) {
  const n = Math.floor((t - t0) * cps);
  if (n <= 0) return '';
  return n >= s.length ? s : s.slice(0, n) + '_';
}

function drawHUD(t) {
  const ha = clamp(t / 0.25) * (1 - clamp((t - T.OUT) / 0.45));
  if (ha <= 0) return;
  const ai = t - T.IMP;
  O.save();
  O.globalAlpha = ha;
  if (ai > 0 && ai < 0.45) {
    const k = 6 * (1 - ai / 0.45), b = Math.floor(t * 60);
    O.translate((h2(b, 5) - 0.5) * 2 * k, (h2(b, 6) - 0.5) * 2 * k);
  }
  const m = Math.round(Math.min(CW, CH) * 0.05), cx = CW / 2, cy = CH / 2;
  const grow = easeOutCubic(clamp(t / 0.5)) * (1 - easeOutCubic(clamp((t - T.OUT) / 0.45)));

  // frame
  brackets(m, m, CW - 2 * m, CH - 2 * m, 80 * grow);

  // heading tape
  if (t > 0.12) {
    const hdg = 271.4 + t * 2.2, y = m + 22, half = 220 * grow;
    for (let d = Math.floor(hdg - 25); d <= Math.ceil(hdg + 25); d++) {
      if (d % 5) continue;
      const x = cx + (d - hdg) * 9;
      if (Math.abs(x - cx) > half) continue;
      hudPath([[x, y], [x, y + (d % 10 ? 6 : 11)]], false, 1.2);
      if (d % 10 === 0) hudText(String(((d % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, y - 10, 'center', FS - 2);
    }
    hudPath([[cx - 6, y + 22], [cx, y + 15], [cx + 6, y + 22]]);
    hudText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + 36, 'center', FS, true);
  }

  // speed + altitude tapes
  if (t > 0.2) {
    const mach = 1.42 + Math.sin(t * 0.9) * 0.02, alt = 24500 - t * 38;
    [[m + 70, mach * 100, 'MACH', mach.toFixed(2)], [CW - m - 70, alt / 10, 'ALT', Math.round(alt).toLocaleString('en-US')]]
      .forEach(([x, val, label, readout], side) => {
        const dir = side ? 1 : -1, span = 150 * grow;
        for (let k = Math.floor(val / 2) - 30; k <= Math.floor(val / 2) + 30; k++) {
          const yy = cy + (val - k * 2) * 7;
          if (Math.abs(yy - cy) > span) continue;
          hudPath([[x, yy], [x + dir * (k % 5 ? 6 : 12), yy]], false, 1.2);
        }
        hudText(label, x, cy - span - 16, 'center', FS - 1);
        hudText(readout, x - dir * 12, cy, side ? 'right' : 'left', FS + 1, true);
      });
  }

  // pitch ladder (kept clear of the word)
  if (t > 0.3) {
    const roll = Math.sin(t * 0.7) * 0.012;
    O.save(); O.translate(cx, cy); O.rotate(roll);
    for (const [dy, lbl, neg] of [[-CH * 0.26, '10', 0], [-CH * 0.14, '5', 0], [CH * 0.14, '-5', 1], [CH * 0.26, '-10', 1]]) {
      for (const sgn of [-1, 1]) {
        const a = sgn * CW * 0.2, b = sgn * CW * 0.26;
        hudPath([[a, dy], [b, dy], [b, dy + (neg ? -8 : 8)]], !!neg, 1.2);
        hudText(lbl, b + sgn * 14, dy, sgn > 0 ? 'left' : 'right', FS - 2);
      }
    }
    O.restore();
  }

  // status block
  const lh = FS * 1.55, bx = m + 18, by = CH - m - 18 - lh * 3;
  hudText(typed('MACH // SNIPER-XR  TGT POD', 0.3, t), bx, by);
  hudText(typed('MASTER ARM ....... ON', 0.5, t), bx, by + lh);
  hudText(typed(t < T.REL + 0.1 ? 'STA 5 ............ TNT' : 'STA 5 ............ EMPTY', t < T.REL + 0.1 ? 0.7 : T.REL + 0.1, t), bx, by + lh * 2);
  hudText(typed('LASER ............ ' + (t < T.LOCK ? 'STBY' : t < T.IMP ? 'LASING' : 'SAFE'), 0.9, t), bx, by + lh * 3);

  const rx = CW - m - 18, clock = Math.max(0, t);
  hudText(typed(`37°14'06"N  115°48'40"W`, 0.4, t), rx, by + lh, 'right');
  hudText(typed('FLIR WHT-HOT   ZOOM 4.0X', 0.6, t), rx, by + lh * 2, 'right');
  hudText(`T+ 00:${String(Math.floor(clock)).padStart(2, '0')}.${String(Math.floor(clock * 100) % 100).padStart(2, '0')}`, rx, by + lh * 3, 'right');

  // target designation box
  const wb = wordBox(), tg = target(), pad = 22;
  if (t > T.ACQ) {
    const p = easeOutCubic(clamp((t - T.ACQ) / (T.LOCK - T.ACQ)));
    const j = (1 - p) * 10, b = Math.floor(t * 20);
    const bx0 = lerp(m * 2, wb.x - pad, p) + (h2(b, 1) - 0.5) * j;
    const by0 = lerp(m * 2.5, wb.y - pad, p) + (h2(b, 2) - 0.5) * j;
    const bx1 = lerp(CW - m * 2, wb.x + wb.w + pad, p) + (h2(b, 3) - 0.5) * j;
    const by1 = lerp(CH - m * 2.5, wb.y + wb.h + pad, p) + (h2(b, 4) - 0.5) * j;
    const bda = t > T.BDA;
    if (!bda || blink(t - T.BDA, 6) || t > T.BDA + 0.5) brackets(bx0, by0, bx1 - bx0, by1 - by0, 24);
    hudText('TGT 01', bx0, by0 - 16);
    if (t < T.LOCK) {
      hudText(blink(t, 6) ? 'ACQUIRING' : '', bx1, by0 - 16, 'right');
    } else if (!bda) {
      if (t > T.LOCK + 0.5 || blink(t, 8)) hudText('LOCKED', bx1, by0 - 16, 'right', FS, true);
      const rng = Math.max(0.1, 12.4 - (t - T.LOCK) * 0.9);
      hudText(`RNG ${rng.toFixed(1)} NM`, bx0, by1 + 16);
      if (t > T.REL && t < T.IMP) hudText(`TTI ${(T.IMP - t).toFixed(1)}`, bx1, by1 + 16, 'right', FS, true);
    } else {
      hudText('TGT DESTROYED', bx1, by0 - 16, 'right', FS, true);
      hudText(typed('BDA .. CONFIRMED', T.BDA + 0.2, t), bx0, by1 + 16);
    }
  }

  // big callouts
  if (t > T.REL && t < T.REL + 0.9 && blink(t - T.REL, 7)) hudText('WPN AWAY', cx, m + 92, 'center', FS + 3, true);
  if (ai > 0 && ai < 0.35) hudText('IMPACT', cx, m + 92, 'center', FS + 3, true);
  if (t > T.BDA + 0.25) hudText(typed('Agentic MACH OS', T.BDA + 0.25, t, 40), cx, m + 92, 'center', FS + 3);
  if (t > T.BDA + 0.4) hudText(typed('MACH  //  ALL SYSTEMS NOMINAL', T.BDA + 0.4, t, 60), cx, CH - m - 30, 'center', FS);

  O.restore();
}

function drawOverlay(t) {
  const a = clamp(t / 0.3) * (1 - clamp((t - T.OUT) / 0.5));
  if (a <= 0) return;
  O.save();
  O.globalAlpha = a;
  const g = O.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.35, CW / 2, CH / 2, Math.hypot(CW, CH) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  O.fillStyle = g; O.fillRect(0, 0, CW, CH);
  O.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < CH; y += 3) O.fillRect(0, y, CW, 1);
  O.restore();
}

// ---------- compositing ----------
function compose(t, fxo) {
  O.setTransform(1, 0, 0, 1, 0, 0);
  O.globalAlpha = 1;
  O.globalCompositeOperation = 'source-over';
  O.clearRect(0, 0, cv.width, cv.height);
  const sc = PX * dpr, dw = W * sc, dh = H * sc;
  const b = Math.floor(t * 60);
  const sx = Math.round((h2(b, 1) - 0.5) * 2 * fxo.shake), sy = Math.round((h2(b, 2) - 0.5) * 2 * fxo.shake);
  const ox = sx * sc, oy = sy * sc;
  O.imageSmoothingEnabled = false;

  if (fxo.glitch > 0) {
    const gb = Math.floor(t * 30), bands = 9, bh = Math.ceil(H / bands);
    for (let i = 0; i < bands; i++) {
      const shift = h2(gb, i) > 0.6 ? Math.round((h2(gb, i + 20) - 0.5) * 16 * fxo.glitch) : 0;
      O.drawImage(low, 0, i * bh, W, bh, ox + shift * sc, oy + i * bh * sc, dw, bh * sc);
    }
  } else {
    O.globalAlpha = 1 - clamp((t - T.OUT) / 0.5);
    O.drawImage(low, ox, oy, dw, dh);
    O.globalAlpha = 1;
  }

  if (fxo.bloom > 0) {
    G.clearRect(0, 0, glow.width, glow.height);
    G.imageSmoothingEnabled = true;
    G.drawImage(low, 0, 0, glow.width, glow.height);
    O.imageSmoothingEnabled = true;
    O.globalCompositeOperation = 'lighter';
    O.globalAlpha = Math.min(1, fxo.bloom * 0.6) * (1 - clamp((t - T.OUT) / 0.5));
    O.drawImage(glow, ox, oy, dw, dh);
    O.globalAlpha = 1;
    O.globalCompositeOperation = 'source-over';
  }

  // vector layer in CSS px, sharing the shake
  O.setTransform(dpr, 0, 0, dpr, ox, oy);
  if (t > 0) {
    drawJet(t);
    if (t >= T.REL && t < T.IMP) { const bs = bombState(t); drawTNT(bs.x, bs.y, bs.ang, bs.size, bs.flash); }
  }
  O.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (t > 0) { drawOverlay(t); drawHUD(t); }

  if (fxo.flash > 0) {
    O.globalAlpha = fxo.flash;
    O.fillStyle = fxo.flashColor;
    O.fillRect(0, 0, CW, CH);
    O.globalAlpha = 1;
  }
}

// ---------- driver ----------
let t0 = null, finished = false, audio = null;

function render(t) {
  L.clearRect(0, 0, W, H);
  const fxo = t >= 0 ? renderLow(t) : { shake: 0, bloom: 0, glitch: 0, flash: 0 };
  compose(Math.max(0, t), fxo);
}

function frame(now) {
  if (t0 === null) return;
  const t = (now - t0) / 1000;
  if (t > T.END) { render(-1); t0 = null; done(); return; }
  render(t);
  requestAnimationFrame(frame);
}

function done() {
  finished = true;
  if (window.webkit?.messageHandlers?.mach) window.webkit.messageHandlers.mach.postMessage('done');
  if (PREVIEW) setTimeout(() => { if (finished) start(); }, 1400);
}

function start(_variant, withSound) {
  finished = false;
  if (withSound) {
    audio = audio || new Audio('sound.wav');
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
  t0 = performance.now();
  requestAnimationFrame(frame);
}

window.MACH = { start };
window.__seek = t => render(t);
setup();
addEventListener('resize', () => { setup(); if (SEEK !== null) render(SEEK); });

if (SEEK !== null) {
  if (PREVIEW) document.body.classList.add('preview');
  render(SEEK);
} else if (PREVIEW) {
  document.body.classList.add('preview');
  addEventListener('click', () => start(null, true));
  start();
} else {
  render(-1);
}
})();
