import fs from 'node:fs'; import * as THREE from 'three';
import { buildRoadMesh, buildBuildingMesh } from '../src/world/meshes.js';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };
const tile = JSON.parse(fs.readFileSync(new URL('../data/tiles/state-house.json', import.meta.url)));
let t = performance.now(); const roads = buildRoadMesh(tile.roads); const rt = performance.now() - t;
t = performance.now(); const blds = buildBuildingMesh(tile.buildings); const bt = performance.now() - t;
const tris = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
const finite = (g) => g.attributes.position.array.every(Number.isFinite);
ok('roads: finite geometry', finite(roads.geometry), Math.round(tris(roads)) + ' tris, ' + rt.toFixed(0) + ' ms');
ok('buildings: finite geometry', finite(blds.geometry), Math.round(tris(blds)) + ' tris, ' + bt.toFixed(0) + ' ms');
// every road triangle must face UP (+Y) or the road is invisible from above with backface culling
const g = roads.geometry, P = g.attributes.position, I = g.index; let down = 0;
for (let i = 0; i < I.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(P, I.getX(i)), b = new THREE.Vector3().fromBufferAttribute(P, I.getX(i + 1)), c = new THREE.Vector3().fromBufferAttribute(P, I.getX(i + 2));
  const n = b.sub(a).cross(c.sub(a)); if (n.y < -1e-9) down++; }
ok('all road triangles face up', down === 0, down + ' facing down');
// buildings: roof must be at height h (max y == tallest building) and footprint on the ground (min y == 0)
const bb = new THREE.Box3().setFromBufferAttribute(blds.geometry.attributes.position); const maxH = Math.max(...tile.buildings.map((b) => b.h));
ok('buildings sit on y=0 and top out at max height', Math.abs(bb.min.y) < 1e-4 && Math.abs(bb.max.y - maxH) < 1e-3, 'y ' + bb.min.y.toFixed(2) + '..' + bb.max.y.toFixed(2) + ' expected top ' + maxH);
// a sample building: world-space x/z extent of its mesh must match its footprint (checks the -z flip)
const b0 = tile.buildings[0]; const xs = b0.pts.filter((_, i) => i % 2 === 0), zs = b0.pts.filter((_, i) => i % 2 === 1);
const g0 = buildBuildingMesh([b0]).geometry; g0.computeBoundingBox(); const e = g0.boundingBox;
ok('footprint x/z extent matches source (no mirroring)', Math.abs(e.min.x - Math.min(...xs)) < 1e-3 && Math.abs(e.max.z - Math.max(...zs)) < 1e-3 && Math.abs(e.min.z - Math.min(...zs)) < 1e-3);
console.log('INFO  whole map = 2 draw calls (roads + buildings)');
