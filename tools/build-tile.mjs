// tools/build-tile.mjs — OSM JSON -> compact game tile (metres, pre-projected, pre-filtered).
// usage: node tools/build-tile.mjs data/nairobi-osm.json data/tiles/state-house.json --lat -1.2877107 --lon 36.8088354 --radius 600
import fs from 'node:fs';
const [,, inFile, outFile, ...rest] = process.argv;
const arg = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? Number(rest[i + 1]) : d; };
const listArg = (k) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1].split(',') : []; };
const LAT = arg('lat', -1.2877107), LON = arg('lon', 36.8088354), R = arg('radius', 600);
const surfaceOnly = rest.includes('--surface-only');
const includeWays = new Set(listArg('include-way').map(Number));
const surfaceOverrides = new Map(listArg('surface-override').map((value) => {
  const [id, surface] = value.split('='); return [Number(id), surface];
}));
const MX = 111320 * Math.cos((LAT * Math.PI) / 180), MY = 111320;
const proj = (n) => [(n.lon - LON) * MX, -(n.lat - LAT) * MY];                 // x east, z south (same as v1 geoToLocal)
const r1 = (v) => Math.round(v * 10) / 10;

const WIDTH = { motorway: 12, motorway_link: 7, trunk: 10, trunk_link: 6, primary: 9, primary_link: 6, secondary: 8, secondary_link: 6,
                tertiary: 7, tertiary_link: 5.5, unclassified: 6, residential: 5.5, living_street: 4.5, service: 4 };
const RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1, living_street: 0, service: 0 };
const DEFAULT_H = { house: 5, residential: 6, detached: 5, apartments: 18, commercial: 14, office: 20, retail: 8, industrial: 9, church: 12, school: 8, hospital: 16, hotel: 22 };

const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const nodes = new Map();
for (const e of data.elements) if (e.type === 'node' && Number.isFinite(e.lat)) nodes.set(e.id, e);

const roads = [], buildings = [];
const margin = 30;
const near = (pts) => pts.some(([x, z]) => Math.abs(x) <= R + margin && Math.abs(z) <= R + margin);
let skipped = { tooBig: 0, tiny: 0, noGeom: 0 };

for (const w of data.elements) {
  if (w.type !== 'way' || !w.tags) continue;
  const pts = (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean).map(proj);
  if (pts.length < 2) { if (w.tags.highway || w.tags.building) skipped.noGeom++; continue; }
  if (!near(pts)) continue;
  const t = w.tags;
  if (t.highway && WIDTH[t.highway] && t.area !== 'yes') {
    const surface = surfaceOverrides.get(w.id) || t.surface || null;
    if (surfaceOnly && !surface && !includeWays.has(w.id)) continue;
    roads.push({ id: w.id, type: t.highway, name: t.name || '', w: WIDTH[t.highway], rank: RANK[t.highway] ?? 0, surface,
                 bridge: t.bridge === 'yes', layer: Number(t.layer) || 0, oneway: t.oneway === 'yes',
                 pts: pts.flatMap(([x, z]) => [r1(x), r1(z)]) });
  } else if (t.building && t.building !== 'no' && w.nodes[0] === w.nodes[w.nodes.length - 1] && pts.length >= 4) {
    const ring = pts.slice(0, -1);
    let area = 0; for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; area += x1 * z2 - x2 * z1; }
    area /= 2; if (Math.abs(area) < 6) { skipped.tiny++; continue; }
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    if (Math.abs(cx) > R || Math.abs(cz) > R) continue;
    if (Math.abs(area) > 20000) { skipped.tooBig++; continue; }                 // campus-sized outlines: handle as landuse later
    if (area < 0) ring.reverse();                                                 // force counter-clockwise (x,z)
    const lv = Number(t['building:levels']), hh = parseFloat(t.height);
    const h = hh > 0 ? hh : lv > 0 ? lv * 3.1 : (DEFAULT_H[t.building] ?? 7 + (w.id % 5));
    buildings.push({ id: w.id, h: r1(Math.min(Math.max(h, 3), 60)), pts: ring.flatMap(([x, z]) => [r1(x), r1(z)]) });
  }
}

// spawn: nearest vertex pair of a named road to the origin (override with --spawn "State House Avenue")
const si = rest.indexOf('--spawn'); const spawnName = si >= 0 ? rest[si + 1] : 'State House Avenue';
let best = null;
for (const r of roads) { if (r.name !== spawnName) continue;
  for (let i = 0; i + 3 < r.pts.length; i += 2) { const mx = (r.pts[i] + r.pts[i + 2]) / 2, mz = (r.pts[i + 1] + r.pts[i + 3]) / 2, d = mx * mx + mz * mz;
    if (!best || d < best.d) best = { d, x: mx, z: mz, psi: Math.atan2(r.pts[i + 2] - r.pts[i], -(r.pts[i + 3] - r.pts[i + 1])) }; } }
const spawn = best ? { x: r1(best.x), z: r1(best.z), psi: Math.round(best.psi * 1000) / 1000 } : { x: 0, z: 0, psi: 0 };

const tile = { version: 1, origin: { lat: LAT, lon: LON }, radius: R, spawn, roads, buildings };
fs.mkdirSync(outFile.replace(/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(tile));
console.log({ roads: roads.length, buildings: buildings.length, spawn, skipped, kb: Math.round(fs.statSync(outFile).size / 1024) });
