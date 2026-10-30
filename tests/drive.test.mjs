// tests/drive.test.mjs — an autopilot drives State House Avenue in BOTH directions on the real tile.
// Catches: physics changes that make real roads undriveable, collision snagging, road-surface bugs.
import fs from 'node:fs';
import { StaticWorld, collideCar } from '../src/world/staticWorld.js';
import { createVehicle, stepVehicle, applyImpact } from '../src/car/vehicle.js';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };
const tile = JSON.parse(fs.readFileSync(new URL('../data/tiles/state-house.json', import.meta.url))); const world = new StaticWorld(tile);
const way = tile.roads.filter((r) => r.name === 'State House Avenue').sort((a, b) => b.pts.length - a.pts.length)[0];
const verts = []; for (let i = 0; i < way.pts.length; i += 2) verts.push([way.pts[i], way.pts[i + 1]]);

for (const dir of ['forward', 'reverse-direction']) {
  const wp = dir === 'forward' ? verts.slice() : verts.slice().reverse();
  const start = wp.reduce((b, p) => (Math.hypot(p[0] - tile.spawn.x, p[1] - tile.spawn.z) < Math.hypot(b[0] - tile.spawn.x, b[1] - tile.spawn.z) ? p : b));
  const si = wp.indexOf(start), path = wp.slice(si + 1);
  const a = start, b = path[0], psi0 = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  const s = createVehicle(a[0], a[1], psi0);
  let idx = 0, t = 0, offRoad = 0, impacts = 0, dist = 0, last = [s.x, s.z]; const DT = 1 / 120;
  while (t < 120 && idx < path.length - 1) {
    while (idx < path.length - 1 && Math.hypot(path[idx][0] - s.x, path[idx][1] - s.z) < 12) idx++;
    const want = Math.atan2(path[idx][0] - s.x, -(path[idx][1] - s.z)); let err = want - s.psi;
    while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const target = Math.max(6, 16 - Math.abs(err) * 14);
    const surf = world.surfaceAt(s.x, s.z);
    stepVehicle(s, { throttle: s.speed < target ? 0.7 : 0, brake: s.speed > target + 3 ? 0.6 : 0, steer: Math.max(-1, Math.min(1, err * 2.2)), handbrake: false, nitro: false }, surf, DT);
    if (collideCar(world, s, applyImpact) > 2) impacts++;
    if (!surf.onRoad) offRoad += DT; t += DT; dist += Math.hypot(s.x - last[0], s.z - last[1]); last = [s.x, s.z];
  }
  ok(`${dir}: reaches the end of the road`, idx >= path.length - 2, `${dist.toFixed(0)} m in ${t.toFixed(0)} s`);
  ok(`${dir}: stays on asphalt (>=95%)`, offRoad / t < 0.05, (100 * offRoad / t).toFixed(1) + '% off-road');
  ok(`${dir}: no building impacts`, impacts === 0, impacts + ' hits');
}
