// src/world/routes.js — route geometry. Pure JS (no THREE, no DOM) => unit-testable, like vehicle.js / staticWorld.js.
// Frame matches vehicle.js: x = east, z = south, heading psi = atan2(dx, -dz), forward = (sin psi, -cos psi).
export const headingOf = (dx, dz) => Math.atan2(dx, -dz);
const toPairs = (f) => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };

/** Chaikin corner cutting (keeps both end points). Softens the hairpin in the westbound junction loop. */
export function chaikin(pts, iters = 1) {
  for (let k = 0; k < iters; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]], [.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]]);
    }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}

/** Evenly spaced samples {x, z, s, psi}. */
export function resample(pts, step = 2) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.max(2, Math.ceil(L / step) + 1), out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (L * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push({ x: pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, z: pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t, s, psi: 0 });
  }
  for (let i = 0; i < n; i++) { const a = out[Math.max(0, i - 1)], b = out[Math.min(n - 1, i + 1)]; out[i].psi = headingOf(b.x - a.x, b.z - a.z); }
  return { pts: out, length: L, step: L / (n - 1) };
}

/** Point at distance s along the path, shifted `offset` metres sideways (+ right of travel, - left). */
export function sampleAt(path, s, offset = 0) {
  const f = Math.min(Math.max(s / path.step, 0), path.pts.length - 1.0001), i = Math.floor(f), t = f - i;
  const a = path.pts[i], b = path.pts[i + 1];
  let d = b.psi - a.psi; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
  const psi = a.psi + d * t, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
  return { x: x - -Math.cos(psi) * offset, z: z + Math.sin(psi) * offset, psi, s };   // right vector = (-fz, fx)
}

/** Distance along the route nearest to (x, z). Pass the previous result as `hint` to search a small window (cheap per frame). */
export function trackProgress(path, x, z, hint = -1) {
  const n = path.pts.length, W = 60;
  let lo = 0, hi = n - 1;
  if (hint >= 0) { const c = Math.round(hint / path.step); lo = Math.max(0, c - W); hi = Math.min(n - 1, c + W); }
  let best = lo, bd = Infinity;
  for (let i = lo; i <= hi; i++) { const p = path.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return { s: path.pts[best].s, dist: Math.sqrt(bd) };
}

/** Kenya drives on the LEFT: spawn a quarter-width left of the centre line, 6 m in so the chase camera has road behind it. */
export const laneOffset = (w) => -w / 4;
export function buildRoute(def) {
  const path = resample(chaikin(toPairs(def.pts), 1), 2), off = laneOffset(def.w);
  const spawn = sampleAt(path, 6, off);
  return { ...def, path, laneOffset: off, spawn: { x: +spawn.x.toFixed(2), z: +spawn.z.toFixed(2), psi: +spawn.psi.toFixed(3) } };
}
