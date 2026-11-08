import fs from 'node:fs';

const sourcePath = 'data/routes/mombasa.json';
const tilePath = 'data/tiles/mombasa.json';
const catalogPath = 'data/routes/all-routes.json';
const outputCatalogPath = process.argv[2] || catalogPath;
const tile = JSON.parse(fs.readFileSync(tilePath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const origin = tile.origin;
const METRES_PER_DEGREE = 111320;
const METRES_PER_LON = METRES_PER_DEGREE * Math.cos(origin.lat * Math.PI / 180);
const MAX_DISTANCE = tile.radius + 25;

const project = (node) => [
  (node.lon - origin.lon) * METRES_PER_LON,
  -(node.lat - origin.lat) * METRES_PER_DEGREE
];
const insideTile = (point) => Math.hypot(point[0], point[1]) <= MAX_DISTANCE;
const nodes = new Map(
  source.elements
    .filter((element) => element.type === 'node' && Number.isFinite(element.lat))
    .map((node) => [node.id, { id: node.id, point: project(node) }])
);
const allowedHighways = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'service'
]);
const widths = {
  motorway: 12, motorway_link: 7, trunk: 10, trunk_link: 6, primary: 9,
  primary_link: 6, secondary: 8, secondary_link: 6, tertiary: 7,
  tertiary_link: 5.5, unclassified: 6, residential: 5.5, living_street: 4.5,
  service: 4
};
const adjacency = new Map();
const edges = [];

for (const way of source.elements) {
  if (way.type !== 'way' || !allowedHighways.has(way.tags?.highway) ||
      way.tags?.area === 'yes' || !Array.isArray(way.nodes)) continue;
  for (let index = 1; index < way.nodes.length; index++) {
    const from = nodes.get(way.nodes[index - 1]);
    const to = nodes.get(way.nodes[index]);
    if (!from || !to || !insideTile(from.point) || !insideTile(to.point)) continue;
    const length = Math.hypot(to.point[0] - from.point[0], to.point[1] - from.point[1]);
    if (length < 0.1) continue;
    const edge = {
      id: edges.length,
      from: from.id,
      to: to.id,
      length,
      name: way.tags.name || 'Unnamed road',
      wayId: way.id,
      width: widths[way.tags.highway]
    };
    edges.push(edge);
    for (const id of [edge.from, edge.to]) {
      if (!adjacency.has(id)) adjacency.set(id, []);
      adjacency.get(id).push(edge);
    }
  }
}

function other(edge, node) {
  return edge.from === node ? edge.to : edge.from;
}

function pathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]
    );
  }
  return length;
}

function nearestNode([x, z]) {
  let nearest = null;
  let distance = Infinity;
  for (const id of adjacency.keys()) {
    const point = nodes.get(id).point;
    const candidate = Math.hypot(point[0] - x, point[1] - z);
    if (candidate < distance) {
      nearest = id;
      distance = candidate;
    }
  }
  if (distance > 350) throw new Error(`No road close to Mombasa route anchor (${x}, ${z}).`);
  return nearest;
}

class MinHeap {
  values = [];

  push(item) {
    this.values.push(item);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent][0] <= item[0]) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = item;
  }

  pop() {
    if (!this.values.length) return null;
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        const child = right < this.values.length &&
          this.values[right][0] < this.values[left][0] ? right : left;
        if (this.values[child][0] >= last[0]) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

function shortestPath(start, goal) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const queue = new MinHeap();
  queue.push([0, start]);
  while (queue.values.length) {
    const [distance, current] = queue.pop();
    if (distance !== distances.get(current)) continue;
    if (current === goal) break;
    for (const edge of adjacency.get(current)) {
      const next = other(edge, current);
      const candidate = distance + edge.length;
      if (candidate < (distances.get(next) ?? Infinity)) {
        distances.set(next, candidate);
        previous.set(next, [current, edge]);
        queue.push([candidate, next]);
      }
    }
  }
  if (!distances.has(goal)) throw new Error('Mombasa route anchors are not connected.');
  const routeNodes = [goal];
  const routeEdges = [];
  let current = goal;
  while (current !== start) {
    const [parent, edge] = previous.get(current);
    routeEdges.push(edge);
    routeNodes.push(parent);
    current = parent;
  }
  routeNodes.reverse();
  routeEdges.reverse();
  return {
    points: routeNodes.map((id) => nodes.get(id).point),
    length: distances.get(goal),
    names: [...new Set(routeEdges.map((edge) => edge.name))],
    width: Math.min(...routeEdges.map((edge) => edge.width))
  };
}

function circuitCandidates() {
  const visited = new Set();
  const parent = new Map();
  const parentEdge = new Map();
  const depth = new Map();
  const found = [];
  const signatures = new Set();
  let loopCount = 0;
  const loopSamples = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    parent.set(start, null);
    depth.set(start, 0);
    const stack = [start];
    while (stack.length) {
      const current = stack.pop();
      for (const edge of adjacency.get(current)) {
        const next = other(edge, current);
        if (!visited.has(next)) {
          visited.add(next);
          parent.set(next, current);
          parentEdge.set(next, edge);
          depth.set(next, depth.get(current) + 1);
          stack.push(next);
          continue;
        }
        if (parent.get(current) === next) continue;
        const left = [];
        const right = [];
        let u = current;
        let v = next;
        while (depth.get(u) > depth.get(v)) {
          left.push({ edge: parentEdge.get(u), from: u, to: parent.get(u) });
          u = parent.get(u);
        }
        while (depth.get(v) > depth.get(u)) {
          right.push({ edge: parentEdge.get(v), from: parent.get(v), to: v });
          v = parent.get(v);
        }
        while (u !== v) {
          left.push({ edge: parentEdge.get(u), from: u, to: parent.get(u) });
          u = parent.get(u);
          right.push({ edge: parentEdge.get(v), from: parent.get(v), to: v });
          v = parent.get(v);
        }
        if (!left.length && !right.length) continue;
        const cycleEdges = [
          ...left,
          ...right.reverse(),
          { edge, from: next, to: current }
        ];
        const signature = cycleEdges.map(({ edge: item }) => item.id).sort((a, b) => a - b).join(',');
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        const routeNodeIds = [cycleEdges[0].from];
        for (const part of cycleEdges) routeNodeIds.push(part.to);
        const points = routeNodeIds.map((id) => nodes.get(id).point);
        const length = pathLength(points);
        const names = [...new Set(cycleEdges.map(({ edge: item }) => item.name))];
        loopCount++;
        if (loopSamples.length < 8) loopSamples.push({ length: Math.round(length), names });
        if (length < 1300 || length > 6500 || names.length < 4) continue;
        found.push({
          points,
          length,
          names,
          width: Math.min(...cycleEdges.map(({ edge: item }) => item.width)),
          signature: new Set(cycleEdges.map(({ edge: item }) => item.wayId))
        });
      }
    }
  }
  if (!found.length) console.log({ loopCount, loopSamples });
  return found.sort((a, b) => b.names.length - a.names.length || a.length - b.length);
}

function flat(points) {
  return points.flatMap(([x, z]) => [
    Math.round(x * 10) / 10,
    Math.round(z * 10) / 10
  ]);
}

function routeGeometry(id, name, blurb, points, extra = {}) {
  const lengthM = Math.round(pathLength(points));
  const route = {
    id,
    short: name,
    name,
    city: 'Mombasa',
    blurb,
    w: 7,
    tile: './data/tiles/mombasa.json',
    pts: flat(points),
    lengthM,
    ...extra
  };
  if (extra.checkpoints) {
    for (const checkpoint of route.checkpoints) {
      const nearest = points.reduce((best, point, index) => {
        const distance = Math.hypot(point[0] - checkpoint.x, point[1] - checkpoint.z);
        return distance < best.distance ? { distance, index } : best;
      }, { distance: Infinity, index: 0 });
      checkpoint.s = Math.round(pathLength(points.slice(0, nearest.index + 1)));
    }
  }
  return route;
}

const toLocal = ([lat, lon]) => [
  (lon - origin.lon) * METRES_PER_LON,
  -(lat - origin.lat) * METRES_PER_DEGREE
];
const sprintAnchors = [
  {
    id: 'mombasa-sprint-1',
    name: 'Nyali Bridge Sprint',
    start: [-4.0505, 39.6505],
    finish: [-4.0368, 39.6823],
    blurb: 'A fast city-to-coast run from Makupa through Mombasa Island and across Nyali Bridge.'
  },
  {
    id: 'mombasa-sprint-2',
    name: 'Kizingo Coast Sprint',
    start: [-4.0360, 39.6545],
    finish: [-4.0640, 39.6790],
    blurb: 'A cross-island sprint from the old northern quarter to the Kizingo waterfront.'
  }
];
const sprintRoutes = sprintAnchors.map((definition) => {
  const path = shortestPath(
    nearestNode(toLocal(definition.start)),
    nearestNode(toLocal(definition.finish))
  );
  if (path.length < 1400 || path.length > 7000) {
    throw new Error(`${definition.id} length is outside the expected 1.4-7 km range.`);
  }
  const checkpoints = [0.25, 0.5, 0.75, 0.92].map((fraction, index) => {
    const targetDistance = path.length * fraction;
    let distance = 0;
    let point = path.points[0];
    for (let pointIndex = 1; pointIndex < path.points.length; pointIndex++) {
      const previous = path.points[pointIndex - 1];
      point = path.points[pointIndex];
      distance += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      if (distance >= targetDistance) break;
    }
    return {
      name: `Checkpoint ${index + 1}`,
      x: Math.round(point[0] * 10) / 10,
      z: Math.round(point[1] * 10) / 10
    };
  });
  return routeGeometry(
    definition.id,
    definition.name,
    `${definition.blurb} Roads: ${path.names.join(', ')}.`,
    path.points,
    { mode: 'sprint', w: path.width, checkpoints }
  );
});

const candidates = circuitCandidates();
const circuits = [];
for (const candidate of candidates) {
  if (circuits.every((route) => {
    const overlap = [...candidate.signature].filter((id) => route.signature.has(id)).length;
    return overlap / Math.min(candidate.signature.size, route.signature.size) < 0.7;
  })) {
    circuits.push(candidate);
  }
  if (circuits.length === 2) break;
}
if (circuits.length !== 2) throw new Error(`Expected two Mombasa circuit loops, found ${circuits.length}.`);
const circuitRoutes = circuits.map((candidate, index) => {
  const points = [...candidate.points];
  points[points.length - 1] = [...points[0]];
  return routeGeometry(
    `mombasa-circuit-${index + 1}`,
    `Mombasa Circuit ${index + 1}`,
    `Closed Mombasa circuit through ${candidate.names.join(', ')}.`,
    points,
    {
      mode: 'circuit',
      circuit: true,
      w: candidate.width,
      roads: candidate.names,
      _wayIds: candidate.signature
    }
  );
});
const freeDrivePath = shortestPath(
  nearestNode(toLocal([-4.044, 39.666])),
  nearestNode(toLocal([-4.0368, 39.6823]))
);
const freeDriveRoute = routeGeometry(
  'mombasa-free-drive',
  'Mombasa Island & Nyali',
  'Explore the Mombasa Island and Nyali road network, including the waterfront, city streets, and Nyali Bridge.',
  freeDrivePath.points,
  { mode: 'free-drive', w: freeDrivePath.width }
);
const generated = [...sprintRoutes, ...circuitRoutes, freeDriveRoute];
const cleanGenerated = generated.map(({ _wayIds, ...route }) => route);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog.routes)) throw new Error('Route catalog must contain a routes array.');
catalog.routes = catalog.routes.filter((route) => !route.id.startsWith('mombasa-'));
catalog.routes.push(...cleanGenerated);
fs.writeFileSync(outputCatalogPath, JSON.stringify(catalog));

console.log(`Built ${generated.length} Mombasa routes from ${edges.length} road segments.`);
for (const route of generated) {
  console.log(`${route.id} | ${route.lengthM} m | ${route.pts.length / 2} points | ${route.roads?.join(', ') || route.mode}`);
}
