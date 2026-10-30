import fs from 'node:fs';
import { StaticWorld, collideCar } from '../src/world/staticWorld.js';
import { createVehicle, stepVehicle, applyImpact } from '../src/car/vehicle.js';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };
const tile = JSON.parse(fs.readFileSync(new URL('../data/tiles/state-house.json', import.meta.url)));
let t0 = performance.now(); const world = new StaticWorld(tile); ok('index build < 150 ms', performance.now() - t0 < 150, (performance.now() - t0).toFixed(0) + ' ms');

// spawn is on asphalt
ok('spawn point is on a road', world.surfaceAt(tile.spawn.x, tile.spawn.z).onRoad);
// random far points: some on grass, query is fast
t0 = performance.now(); let road = 0, N = 100000; for (let i = 0; i < N; i++) if (world.surfaceAt((Math.random() - .5) * 1200, (Math.random() - .5) * 1200).onRoad) road++;
const per = (performance.now() - t0) / N * 1000; ok('surface query < 20 us each', per < 20, per.toFixed(1) + ' us; ' + (100 * road / N).toFixed(0) + '% of area is road');

// shoot the car at every building centroid from 30 m away at 15 m/s: it must never end up inside a footprint
let tunnelled = 0, tested = 0; const times = [];
for (const b of tile.buildings.slice(0, 200)) {
  let cx = 0, cz = 0; for (let i = 0; i < b.pts.length; i += 2) { cx += b.pts[i]; cz += b.pts[i + 1]; } cx /= b.pts.length / 2; cz /= b.pts.length / 2;
  const s = createVehicle(cx + 30, cz, -Math.PI / 2); s.vx = -15; s.vz = 0; s.u = 15;
  for (let i = 0; i < 120 * 4; i++) { stepVehicle(s, { throttle: 0, brake: 0, steer: 0 }, null, 1 / 120); const a = performance.now(); collideCar(world, s, applyImpact); times.push(performance.now() - a); }
  tested++; if (world.collideCircle(s.x, s.z, 0.1)) tunnelled++;
}
ok('car never ends up inside a building (200 head-on tests)', tunnelled === 0, tunnelled + '/' + tested);
const sorted = times.slice(50).sort((a, b) => a - b), p99 = sorted[Math.floor(sorted.length * 0.99)];
ok('collision step p99 < 0.2 ms', p99 < 0.2, 'p99 ' + p99.toFixed(3) + ' ms, max ' + sorted[sorted.length - 1].toFixed(2) + ' ms (max = GC/JIT outliers)');

// a bounce actually reports an impact and loses speed
const b = tile.buildings[0]; let cx = 0, cz = 0; for (let i = 0; i < b.pts.length; i += 2) { cx += b.pts[i]; cz += b.pts[i + 1]; } cx /= b.pts.length / 2; cz /= b.pts.length / 2;
const s = createVehicle(cx + 25, cz, -Math.PI / 2); s.vx = -25; s.u = 25; let peak = 0; for (let i = 0; i < 120 * 3; i++) { stepVehicle(s, { throttle: 0, brake: 0, steer: 0 }, null, 1 / 120); peak = Math.max(peak, collideCar(world, s, applyImpact)); }
ok('impact is reported and speed is shed', peak > 3 && s.speed < 12, 'impact ' + peak.toFixed(1) + ' m/s, exit speed ' + s.speed.toFixed(1));
