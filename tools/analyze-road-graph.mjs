import fs from 'node:fs';

const tile = JSON.parse(
  fs.readFileSync('data/tiles/ngara-sprint.json', 'utf8')
);

const roads = (tile.roads || []).filter(r => (r.pts || []).length >= 4);
const tolerance = 4;
const endpoints = [];

roads.forEach((r, i) => {
  const p = r.pts;
  endpoints.push(
    { road: i, side: 'start', x: p[0], z: p[1] },
    { road: i, side: 'end', x: p[p.length - 2], z: p[p.length - 1] }
  );
});

const parent = endpoints.map((_, i) => i);

function root(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function join(a, b) {
  a = root(a);
  b = root(b);
  if (a !== b) parent[b] = a;
}

// Merge nearby endpoints.
for (let i = 0; i < endpoints.length; i++) {
  for (let j = i + 1; j < endpoints.length; j++) {
    const a = endpoints[i], b = endpoints[j];
    if (a.road === b.road) continue;

    if (Math.hypot(a.x - b.x, a.z - b.z) <= tolerance) {
      join(i, j);
    }
  }
}

const nodes = new Map();

endpoints.forEach((p, i) => {
  const id = root(i);
  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      x: 0,
      z: 0,
      count: 0,
      edges: []
    });
  }
  const n = nodes.get(id);
  n.x += p.x;
  n.z += p.z;
  n.count++;
  n.edges.push({ road: p.road, side: p.side });
});

for (const n of nodes.values()) {
  n.x /= n.count;
  n.z /= n.count;
}

const edges = roads.map((r, i) => ({
  road: i,
  a: root(i * 2),
  b: root(i * 2 + 1),
  id: r.id,
  name: r.name || 'Unnamed',
  surface: r.surface || 'unspecified',
  width: r.w || 0
}));

const adjacency = new Map([...nodes.keys()].map(id => [id, []]));

for (const e of edges) {
  adjacency.get(e.a)?.push(e);
  adjacency.get(e.b)?.push(e);
}

const visited = new Set();
const components = [];

for (const start of nodes.keys()) {
  if (visited.has(start)) continue;

  const stack = [start];
  const componentNodes = new Set();
  const componentEdges = new Set();

  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;

    visited.add(id);
    componentNodes.add(id);

    for (const e of adjacency.get(id) || []) {
      componentEdges.add(e.road);
      const next = e.a === id ? e.b : e.a;
      if (!visited.has(next)) stack.push(next);
    }
  }

  const V = componentNodes.size;
  const E = componentEdges.size;

  components.push({
    nodes: componentNodes,
    edges: componentEdges,
    V, E,
    cycles: Math.max(0, E - V + 1)
  });
}

components.sort((a, b) => b.E - a.E);

console.log('\n========== NETWORK SUMMARY ==========');
console.log('Road features:', roads.length);
console.log('Snapping tolerance:', tolerance, 'metres');
console.log('Connected components:', components.length);

components.slice(0, 12).forEach((c, i) => {
  console.log(
    `Component ${i + 1}: ${c.E} roads, ${c.V} junction nodes, cycle rank ${c.cycles}`
  );
});

console.log('\n========== MAJOR JUNCTIONS ==========');

[...nodes.values()]
  .filter(n => adjacency.get(n.id).length >= 3)
  .sort((a, b) => adjacency.get(b.id).length - adjacency.get(a.id).length)
  .slice(0, 45)
  .forEach(n => {
    const connected = [...new Set(
      adjacency.get(n.id).map(e => `${e.name} [${e.id}]`)
    )];

    console.log(
      `Node (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) | Degree ${adjacency.get(n.id).length}`
    );
    connected.forEach(name => console.log('  - ' + name));
  });

console.log('\n========== DEAD ENDS ==========');

[...nodes.values()]
  .filter(n => adjacency.get(n.id).length === 1)
  .slice(0, 35)
  .forEach(n => {
    const e = adjacency.get(n.id)[0];
    console.log(
      `(${n.x.toFixed(1)}, ${n.z.toFixed(1)}) | ${e.name} [${e.id}]`
    );
  });

console.log('\n========== ROADS IN LARGEST COMPONENT ==========');

const largest = components[0];

if (largest) {
  [...largest.edges]
    .map(i => roads[i])
    .forEach(r => {
      console.log(`${r.name || 'Unnamed'} | ${r.id} | ${r.w || '?'}m`);
    });
}
