import fs from 'node:fs';

const tilePath = 'data/tiles/ngara-sprint.json';
const outputPath = 'data/routes/ngara-circuit-candidates.json';

const tile = JSON.parse(fs.readFileSync(tilePath, 'utf8'));
const roads = tile.roads || [];

const SNAP = 4;
const MIN_LENGTH = 450;
const MAX_LENGTH = 6500;

const keyOf = ([x, z]) =>
  `${Math.round(x / SNAP)},${Math.round(z / SNAP)}`;

const graph = new Map();
const edges = [];

function addNode(key) {
  if (!graph.has(key)) graph.set(key, []);
}

for (const road of roads) {
  const flat = road.pts || [];
  if (flat.length < 4) continue;

  const points = [];
  for (let i = 0; i < flat.length; i += 2) {
    points.push([flat[i], flat[i + 1]]);
  }

  const a = keyOf(points[0]);
  const b = keyOf(points.at(-1));

  if (a === b) continue;

  addNode(a);
  addNode(b);

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1]
    );
  }

  const edge = {
    id: edges.length,
    a,
    b,
    points,
    length,
    name: road.name || 'Unnamed road',
    width: road.w || 7
  };

  edges.push(edge);
  graph.get(a).push(edge);
  graph.get(b).push(edge);
}

function other(edge, node) {
  return edge.a === node ? edge.b : edge.a;
}

const visited = new Set();
const parent = new Map();
const parentEdge = new Map();
const depth = new Map();
const candidates = [];

for (const start of graph.keys()) {
  if (visited.has(start)) continue;

  visited.add(start);
  parent.set(start, null);
  depth.set(start, 0);

  const stack = [start];

  while (stack.length) {
    const node = stack.pop();

    for (const edge of graph.get(node)) {
      const next = other(edge, node);

      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, node);
        parentEdge.set(next, edge);
        depth.set(next, depth.get(node) + 1);
        stack.push(next);
      } else if (
        parent.get(node) !== next &&
        depth.get(next) <= depth.get(node)
      ) {
        const left = [];
        const right = [];

        let u = node;
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

        const path = [
          ...left,
          ...right.reverse(),
          { edge, from: next, to: node }
        ];

        const routePoints = [];

        for (const part of path) {
          let pts = part.edge.points;

          if (keyOf(pts[0]) !== part.from) {
            pts = [...pts].reverse();
          }

          if (routePoints.length) pts = pts.slice(1);
          routePoints.push(...pts);
        }

        if (routePoints.length < 5) continue;

        routePoints[routePoints.length - 1] = [...routePoints[0]];

        let length = 0;
        for (let i = 1; i < routePoints.length; i++) {
          length += Math.hypot(
            routePoints[i][0] - routePoints[i - 1][0],
            routePoints[i][1] - routePoints[i - 1][1]
          );
        }

        const names = [...new Set(path.map(p => p.edge.name))];

        if (
          length < MIN_LENGTH ||
          length > MAX_LENGTH ||
          names.length < 3
        ) continue;

        const signature = [...path.map(p => p.edge.id)].sort().join(',');

        if (candidates.some(c => c.signature === signature)) continue;

        candidates.push({
          signature,
          length,
          names,
          points: routePoints,
          width: Math.min(...path.map(p => p.edge.width))
        });
      }
    }
  }
}

candidates.sort((a, b) => b.names.length - a.names.length || a.length - b.length);

const selected = [];
const usedSignatures = new Set();

for (const candidate of candidates) {
  if (usedSignatures.has(candidate.signature)) continue;

  selected.push(candidate);
  usedSignatures.add(candidate.signature);

  if (selected.length === 8) break;
}

const routes = selected.map((c, i) => ({
  id: `ngara-circuit-${i + 1}`,
  short: `Ngara Circuit ${i + 1}`,
  name: `Ngara Circuit ${i + 1}`,
  blurb: `Closed circuit through ${c.names.join(', ')}.`,
  w: c.width,
  tile: './data/tiles/ngara-sprint.json',
  pts: c.points.flat(),
  lengthM: Math.round(c.length),
  circuit: true,
  roads: c.names
}));

fs.writeFileSync(
  outputPath,
  JSON.stringify({
    version: '1.0.0',
    generatedFrom: tilePath,
    routes
  }, null, 2)
);

console.log(`Generated ${routes.length} candidate circuits.`);
for (const route of routes) {
  console.log(
    `${route.id} | ${route.lengthM}m | ${route.pts.length / 2} points`
  );
}
console.log(`Saved: ${outputPath}`);
