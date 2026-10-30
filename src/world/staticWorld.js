// src/world/staticWorld.js — spatial index over roads + buildings. Pure JS (no THREE) => unit-testable.
const CELL = 32;
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

class SegmentGrid {
  constructor() { this.cells = new Map(); this.stamps = null; this.tick = 0; }
  finish(count) { this.stamps = new Uint32Array(count); }                  // call once after all inserts: enables allocation-free dedupe
  insert(id, x1, z1, x2, z2, pad = 0) {
    const c0 = Math.floor((Math.min(x1, x2) - pad) / CELL), c1 = Math.floor((Math.max(x1, x2) + pad) / CELL);
    const r0 = Math.floor((Math.min(z1, z2) - pad) / CELL), r1 = Math.floor((Math.max(z1, z2) + pad) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) { const k = key(cx, cz); (this.cells.get(k) ?? this.cells.set(k, []).get(k)).push(id); }
  }
  query(x, z, r, fn) {                                              // calls fn(id) once per id near the circle
    const stamps = this.stamps, tick = ++this.tick;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
        { const list = this.cells.get(key(cx, cz)); if (list) for (let i = 0; i < list.length; i++) { const id = list[i]; if (stamps[id] !== tick) { stamps[id] = tick; fn(id); } } }
  }
}

function closestOnSegment(px, pz, x1, z1, x2, z2, out) {
  const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = x1 + t * dx; out.z = z1 + t * dz; return Math.hypot(px - out.x, pz - out.z);
}

function insidePolygon(px, pz, pts) {                               // ray casting; pts = flat [x,z,x,z...]
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const SURFACE = { asphalt: { mu: 1.0, roll: 0.015, onRoad: true }, grass: { mu: 0.55, roll: 0.08, onRoad: false } };

export class StaticWorld {
  constructor(tile) {
    this.tile = tile; this.roadSegs = []; this.bSegs = []; this.roadGrid = new SegmentGrid(); this.bGrid = new SegmentGrid();
    for (const r of tile.roads) for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const id = this.roadSegs.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.w / 2 + 0.6]) - 1;     // +0.6 m shoulder
      this.roadGrid.insert(id, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.w / 2 + 0.6);
    }
    tile.buildings.forEach((b, bi) => { for (let i = 0; i < b.pts.length; i += 2) {
      const j = (i + 2) % b.pts.length, id = this.bSegs.push([b.pts[i], b.pts[i + 1], b.pts[j], b.pts[j + 1], bi]) - 1;
      this.bGrid.insert(id, b.pts[i], b.pts[i + 1], b.pts[j], b.pts[j + 1]); } });
    this.roadGrid.finish(this.roadSegs.length); this.bGrid.finish(this.bSegs.length);
    this.bStamp = new Uint32Array(tile.buildings.length); this.bTick = 0; this._p = { x: 0, z: 0 };
  }
  surfaceAt(x, z) {
    let onRoad = false;
    this.roadGrid.query(x, z, 0, (id) => { if (onRoad) return; const s = this.roadSegs[id]; if (closestOnSegment(x, z, s[0], s[1], s[2], s[3], this._p) <= s[4]) onRoad = true; });
    return onRoad ? SURFACE.asphalt : SURFACE.grass;
  }
  /** Deepest overlap of a circle with any building, or null. normal points from building toward the circle. */
  collideCircle(x, z, r) {
    let best = null; const p = this._p, bTick = ++this.bTick, bStamp = this.bStamp;
    this.bGrid.query(x, z, r, (id) => {
      const [x1, z1, x2, z2, bi] = this.bSegs[id];
      const d = closestOnSegment(x, z, x1, z1, x2, z2, p);
      if (d < r && (!best || r - d > best.depth)) { const nx = d > 1e-6 ? (x - p.x) / d : 0, nz = d > 1e-6 ? (z - p.z) / d : 1; best = { nx, nz, depth: r - d }; }
      if (bStamp[bi] !== bTick) { bStamp[bi] = bTick;                    // centre inside footprint (e.g. spawned/teleported into it)
        if (insidePolygon(x, z, this.tile.buildings[bi].pts)) { const dd = d; const nx = dd > 1e-6 ? (p.x - x) / dd : 0, nz = dd > 1e-6 ? (p.z - z) / dd : 1; best = { nx, nz, depth: r + dd }; } }
    });
    return best;
  }
}

const OFFSETS = [-1.6, 0, 1.6], RADIUS = 1.05;                        // 3 circles cover a 5 m x 2.1 m car
/** Resolve car-vs-building overlaps. `applyImpact` comes from vehicle.js. Returns max impact speed (m/s) for sfx/shake/damage. */
export function collideCar(world, s, applyImpact) {
  let hit = 0;
  for (const off of OFFSETS) {
    const cx = s.x + Math.sin(s.psi) * off, cz = s.z - Math.cos(s.psi) * off, c = world.collideCircle(cx, cz, RADIUS);
    if (c) hit = Math.max(hit, applyImpact(s, c.nx, c.nz, c.depth));
  }
  return hit;
}
