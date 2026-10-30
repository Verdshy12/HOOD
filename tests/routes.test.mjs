// tests/routes.test.mjs — the two real-road routes: geometry, lane/spawn, and an autopilot that drives each end to end.
import fs from 'node:fs';
import { StaticWorld, collideCar } from '../src/world/staticWorld.js';
import { createVehicle, stepVehicle, applyImpact } from '../src/car/vehicle.js';
import { buildRoute, trackProgress, sampleAt } from '../src/world/routes.js';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const tile = read('../data/tiles/state-house.json'), data = read('../data/routes/real-road-v1.2.2.json'), world = new StaticWorld(tile);
const routes = data.routes.map(buildRoute);

ok('v1.2.1 spawn heading is reproduced by the eastbound route (psi 1.83)', Math.abs(routes[0].spawn.psi - tile.spawn.psi) < 0.02, routes[0].spawn.psi);
for (const r of routes) {
  const P = r.path.pts, a = P[0], b = P[P.length - 1];
  ok(`${r.id}: length 0.95-1.2 km`, r.path.length > 950 && r.path.length < 1200, r.path.length.toFixed(0) + ' m');
  ok(`${r.id}: centre line is on asphalt (>=99%)`, P.filter((p) => world.surfaceAt(p.x, p.z).onRoad).length / P.length >= 0.99);
  const sp = world.surfaceAt(r.spawn.x, r.spawn.z);
  ok(`${r.id}: left-lane spawn is on the road, not in a building`, sp.onRoad && !world.collideCircle(r.spawn.x, r.spawn.z, 1.05));
  ok(`${r.id}: stitched ways join without jumps (<6 m between samples)`, P.every((p, i) => !i || Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) < 6));
  const tr = trackProgress(r.path, a.x, a.z); ok(`${r.id}: progress tracker finds the start`, tr.s < 1 && tr.dist < 0.5);
  const lane = sampleAt(r.path, 100, r.laneOffset), c = sampleAt(r.path, 100, 0);
  const fx = Math.sin(c.psi), fz = -Math.cos(c.psi), cross = fx * (lane.z - c.z) - fz * (lane.x - c.x);   // >0 = left in this frame? sign checked against travel below
  ok(`${r.id}: lane offset is ${Math.abs(r.laneOffset)} m to the LEFT of travel`, Math.abs(Math.hypot(lane.x - c.x, lane.z - c.z) - Math.abs(r.laneOffset)) < 1e-6 && cross < 0, cross.toFixed(2));
}
ok('eastbound starts at the origin node', Math.hypot(routes[0].path.pts[0].x, routes[0].path.pts[0].z) < 0.1);
ok('westbound ends at the origin node', Math.hypot(routes[1].path.pts.at(-1).x, routes[1].path.pts.at(-1).z) < 0.1);

// Autopilot: same driver as drive.test.mjs, steering at the route's own samples (so it also proves the route is drivable).
for (const r of routes) {
  const P = r.path.pts, DT = 1 / 120, s = createVehicle(r.spawn.x, r.spawn.z, r.spawn.psi);
  let idx = 3, t = 0, off = 0, hits = 0, maxS = 0;
  while (t < 240 && maxS < r.path.length - 15) {
    const tp = trackProgress(r.path, s.x, s.z, maxS); maxS = Math.max(maxS, tp.s);
    const look = Math.min(P.length - 1, Math.round(tp.s / r.path.step) + 5), tgt = sampleAt(r.path, look * r.path.step, r.laneOffset);
    const want = Math.atan2(tgt.x - s.x, -(tgt.z - s.z)); let err = want - s.psi;
    while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const target = Math.max(6, 16 - Math.abs(err) * 14), surf = world.surfaceAt(s.x, s.z);
    stepVehicle(s, { throttle: s.speed < target ? 0.7 : 0, brake: s.speed > target + 3 ? 0.6 : 0, steer: Math.max(-1, Math.min(1, err * 2.2)), handbrake: false, nitro: false }, surf, DT);
    if (collideCar(world, s, applyImpact) > 2) hits++;
    if (!surf.onRoad) off += DT; t += DT;
  }
  ok(`${r.id}: autopilot reaches the end`, maxS >= r.path.length - 15, `${maxS.toFixed(0)}/${r.path.length.toFixed(0)} m in ${t.toFixed(0)} s`);
  ok(`${r.id}: autopilot stays on asphalt (>=95%)`, off / t < 0.05, (100 * off / t).toFixed(1) + '% off-road');
  ok(`${r.id}: autopilot has no building impacts`, hits === 0, hits + ' hits');
}
