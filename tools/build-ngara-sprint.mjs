// Build the Ngara-to-Kinyanjui sprint from an OSM JSON extract.
// Usage: node tools/build-ngara-sprint.mjs <osm.json> [tile.json] [base-routes.json] [routes-out.json]
import fs from 'node:fs';

const [,, sourceFile, tileFile = 'data/tiles/ngara-sprint.json', baseRoutesFile = 'data/routes/state-house.json', outFile = 'data/routes/all-routes.json'] = process.argv;
if (!sourceFile) throw new Error('usage: node tools/build-ngara-sprint.mjs <osm.json> [tile.json] [base-routes.json] [routes-out.json]');

const osm = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const tile = JSON.parse(fs.readFileSync(tileFile, 'utf8'));
const base = JSON.parse(fs.readFileSync(baseRoutesFile, 'utf8'));
const nodes = new Map(osm.elements.filter((e) => e.type === 'node' && Number.isFinite(e.lat)).map((n) => [n.id, n]));
const graph = new Map();
const ways = osm.elements.filter((e) => e.type === 'way' && e.tags?.highway);

for (const way of ways) {
  for (let i = 0; i + 1 < way.nodes.length; i++) {
    const a = way.nodes[i], b = way.nodes[i + 1];
    if (!nodes.has(a) || !nodes.has(b)) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push({ to, way: way.id });
    }
  }
}

function findPath(start, end) {
  const queue = [start], previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length && !previous.has(end); i++) {
    for (const edge of graph.get(queue[i]) || []) {
      if (previous.has(edge.to)) continue;
      previous.set(edge.to, { from: queue[i], way: edge.way });
      queue.push(edge.to);
    }
  }
  if (!previous.has(end)) throw new Error(`No OSM road path between nodes ${start} and ${end}`);
  const path = [end];
  for (let at = end; at !== start;) { at = previous.get(at).from; path.push(at); }
  path.reverse();
  return path;
}

const startNode = 2670931582;
const stops = [
  { node: 4298505145, name: 'Ngara / Quarry' },
  { node: 268642232, name: 'Ring Road Ngara' },
  { node: 30986855, name: 'Racecourse roundabout' },
  { node: 281958468, name: 'Kinyanjui St' },
  { node: 30986713, name: 'Digo Road finish' }
];
const routeNodes = [startNode];
let current = startNode;
for (const stop of stops) {
  const leg = findPath(current, stop.node);
  routeNodes.push(...leg.slice(1));
  current = stop.node;
}

const { lat: originLat, lon: originLon } = tile.origin;
const mx = 111320 * Math.cos((originLat * Math.PI) / 180), my = 111320;
const local = (id) => {
  const n = nodes.get(id);
  return { x: (n.lon - originLon) * mx, z: -(n.lat - originLat) * my };
};
const points = routeNodes.map(local);
const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
const checkpoints = stops.slice(0, -1).map((stop) => ({ name: stop.name, ...local(stop.node) }));
const route = {
  id: 'nairobi-ngara-sprint',
  short: 'Ngara Sprint',
  name: 'Ngara to Kinyanjui Street',
  blurb: 'Sprint from Ngara Road through Ring Road Ngara and Racecourse Road to the Digo Road junction.',
  w: 6,
  tile: './data/tiles/ngara-sprint.json',
  pts: points.flatMap(({ x, z }) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
  checkpoints,
  landmarks: [
    { name: 'Ngara Road', at: 'start' },
    { name: 'Digo Road junction', at: 'end' }
  ],
  lengthM: Math.round(length)
};

if (!tile.roads.some((road) => road.id === 4821502 && road.surface === 'murram')) {
  throw new Error('Sprint tile must include Kinyanjui Street (OSM way 4821502) with the murram override');
}

const routes = [...base.routes.filter((item) => item.id !== route.id), route];
fs.mkdirSync(outFile.replace(/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ ...base, routes }));
console.log(`${route.id}: ${route.lengthM} m, ${points.length} points, ${checkpoints.length} checkpoints`);