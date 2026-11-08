import fs from 'node:fs';
import { StaticWorld } from '../src/world/staticWorld.js';
import { buildRoute, trackProgress } from '../src/world/routes.js';
import { buildRouteBarricades } from '../src/world/meshes.js';

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
const sprintWorld = new StaticWorld(tile, def.barricades);

ok('sprint route preserves existing route entries', data.routes.some((r) => r.id === 'state-house-eastbound'));
ok('sprint is about 2.6 km', route.path.length > 2500 && route.path.length < 2800, route.path.length.toFixed(0) + ' m');
const checkpointProgress = route.checkpoints.map((checkpoint) => trackProgress(route.path, checkpoint.x, checkpoint.z).s);
ok('sprint has four ordered checkpoints', checkpointProgress.length === 4 && checkpointProgress.every((s, i, all) => !i || s > all[i - 1]));
const checkpointOffsets = route.checkpoints.map((checkpoint) => trackProgress(route.path, checkpoint.x, checkpoint.z).dist);
ok('sprint checkpoints remain close to the route guidance line', checkpointOffsets.every((distance) => distance < 8), `${Math.max(...checkpointOffsets).toFixed(1)} m max`);
ok('tile includes only known or explicitly overridden surfaces', tile.roads.every((road) => road.surface));
ok('Kinyanjui has the explicit murram override', tile.roads.some((road) => road.id === 4821502 && road.surface === 'murram'));
const centerline = route.path.pts;
const onRoad = centerline.filter((point) => world.surfaceAt(point.x, point.z).onRoad).length / centerline.length;
ok('sprint centerline stays on the loaded road network', onRoad >= 0.95, Math.round(onRoad * 100) + '%');
ok('sprint spawn is on road', world.surfaceAt(route.spawn.x, route.spawn.z).onRoad);
ok('sprint has police barricades for closed junction branches', def.barricades?.length >= 8, `${def.barricades?.length || 0} barriers`);
ok('sprint barricades stay clear of the race line', def.barricades.every((barrier) =>
  trackProgress(route.path, barrier.x, barrier.z).dist > 7));
const barricadeMesh = buildRouteBarricades(route);
ok('sprint barricade visuals match the route barriers', barricadeMesh?.children.length === def.barricades.length);
ok('sprint barricades physically block their road branches', def.barricades.every((barrier) =>
  sprintWorld.collideCircle(barrier.x, barrier.z, 1.05) !== null));
ok('free-drive world has no sprint barricade collisions', world.collideCircle(
  def.barricades[0].x,
  def.barricades[0].z,
  1.05
) === null);