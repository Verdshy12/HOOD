import fs from 'node:fs';
import { StaticWorld } from '../src/world/staticWorld.js';
import { buildRoute, trackProgress } from '../src/world/routes.js';

const ok = (name, condition, info = '') => {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + name + (info ? `  [${info}]` : ''));
  if (!condition) process.exitCode = 1;
};
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const catalog = read('../data/routes/all-routes.json');
const tile = read('../data/tiles/mombasa.json');
const mombasaRoutes = catalog.routes.filter((route) => route.city === 'Mombasa');
const sprints = mombasaRoutes.filter((route) => route.mode === 'sprint');
const circuits = mombasaRoutes.filter((route) => route.mode === 'circuit');
const freeDrive = mombasaRoutes.find((route) => route.mode === 'free-drive');
const world = new StaticWorld(tile);

ok('Mombasa tile contains a city-scale drivable network', tile.roads.length >= 1000 &&
  tile.buildings.length >= 3000, `${tile.roads.length} roads, ${tile.buildings.length} buildings`);
ok('Mombasa provides exactly two sprints and two circuits', sprints.length === 2 && circuits.length === 2);
ok('Mombasa provides a free-drive area', !!freeDrive && freeDrive.id === 'mombasa-free-drive');

for (const definition of [...sprints, ...circuits, freeDrive].filter(Boolean)) {
  const route = buildRoute(definition);
  const centerline = route.path.pts;
  const roadCoverage = centerline.filter((point) => world.surfaceAt(point.x, point.z).onRoad).length /
    centerline.length;
  ok(`${definition.id}: uses the Mombasa tile`, definition.tile === './data/tiles/mombasa.json');
  ok(`${definition.id}: route geometry follows loaded roads`, roadCoverage >= 0.95,
    `${Math.round(roadCoverage * 100)}%`);
  ok(`${definition.id}: spawn is on the road`, world.surfaceAt(route.spawn.x, route.spawn.z).onRoad);

  if (definition.mode === 'sprint') {
    const progress = definition.checkpoints.map((checkpoint) =>
      trackProgress(route.path, checkpoint.x, checkpoint.z).s
    );
    ok(`${definition.id}: has four ordered route checkpoints`,
      progress.length === 4 && progress.every((distance, index) =>
        index === 0 || distance > progress[index - 1]
      ));
    ok(`${definition.id}: is a 3-7 km cross-city race`,
      route.path.length >= 3000 && route.path.length <= 7000,
      `${Math.round(route.path.length)} m`);
  }

  if (definition.mode === 'circuit') {
    const start = centerline[0], end = centerline.at(-1);
    ok(`${definition.id}: forms a closed circuit`,
      Math.hypot(start.x - end.x, start.z - end.z) < 0.1);
    ok(`${definition.id}: is a 1.3-6.5 km lap`,
      route.path.length >= 1300 && route.path.length <= 6500,
      `${Math.round(route.path.length)} m`);
  }
}
