import fs from 'node:fs';
import { StaticWorld } from '../src/world/staticWorld.js';
import { buildRoute, trackProgress } from '../src/world/routes.js';

const ok = (name, condition, info = '') => {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  [' + info + ']' : ''));
  if (!condition) process.exitCode = 1;
};
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const tile = read('../data/tiles/ngara-sprint.json');
const data = read('../data/routes/all-routes.json');
const def = data.routes.find((route) => route.id === 'nairobi-ngara-sprint');
const route = buildRoute(def);
const world = new StaticWorld(tile);

ok('sprint route preserves existing route entries', data.routes.some((r) => r.id === 'state-house-eastbound'));
ok('sprint is about 2.6 km', route.path.length > 2500 && route.path.length < 2800, route.path.length.toFixed(0) + ' m');
const checkpointProgress = route.checkpoints.map((checkpoint) => trackProgress(route.path, checkpoint.x, checkpoint.z).s);
ok('sprint has four ordered checkpoints', checkpointProgress.length === 4 && checkpointProgress.every((s, i, all) => !i || s > all[i - 1]));
ok('tile includes only known or explicitly overridden surfaces', tile.roads.every((road) => road.surface));
ok('Kinyanjui has the explicit murram override', tile.roads.some((road) => road.id === 4821502 && road.surface === 'murram'));
const centerline = route.path.pts;
const onRoad = centerline.filter((point) => world.surfaceAt(point.x, point.z).onRoad).length / centerline.length;
ok('sprint centerline stays on the loaded road network', onRoad >= 0.95, Math.round(onRoad * 100) + '%');
ok('sprint spawn is on road', world.surfaceAt(route.spawn.x, route.spawn.z).onRoad);