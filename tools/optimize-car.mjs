// tools/optimize-car.mjs  —  node tools/optimize-car.mjs <in.gltf> <out.glb>
// Collapses a deep Sketchfab hierarchy into: CarBody + 4 wheel nodes,
// merges meshes per material, strips transmission, meshopt-compresses.
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, join, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { mat4 } from 'gl-matrix';

const [,, input, output] = process.argv;
if (!input || !output) { console.error('usage: node tools/optimize-car.mjs in.gltf out.glb'); process.exit(1); }

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const scene = doc.getRoot().listScenes()[0];

// 1) Identify wheel roots by their exported names, e.g. "3DWheel Front L_39_61"
const WHEELS = { FL: /3DWheel Front L/i, FR: /3DWheel Front R/i, RL: /3DWheel Rear L/i, RR: /3DWheel Rear R/i };
const wheelRoots = {};
doc.getRoot().listNodes().forEach((n) => {
  for (const [k, re] of Object.entries(WHEELS)) if (re.test(n.getName()) && !wheelRoots[k]) wheelRoots[k] = n;
});
if (Object.keys(wheelRoots).length !== 4) throw new Error('Expected 4 wheel roots, found ' + Object.keys(wheelRoots));

// 2) Snapshot world matrices BEFORE touching the hierarchy
const worlds = new Map();
doc.getRoot().listNodes().forEach((n) => worlds.set(n, Array.from(n.getWorldMatrix())));
const isUnder = (n, ancestor) => { for (let p = n; p; p = p.getParentNode()) if (p === ancestor) return true; return false; };
const owner = (n) => Object.entries(wheelRoots).find(([, w]) => isUnder(n, w))?.[0] ?? 'BODY';

// 3) Build flat containers: CarBody + each wheel root re-parented to scene with its world matrix
const body = doc.createNode('CarBody').setMatrix(mat4.create());
scene.addChild(body);
for (const [k, w] of Object.entries(wheelRoots)) {
  w.getParentNode()?.removeChild(w);
  w.setMatrix(worlds.get(w));
  w.setName('Wheel_' + k);
  scene.addChild(w);
}

// 4) Move every mesh node under its container with a relative matrix
const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
for (const n of meshNodes) {
  const k = owner(n);
  const target = k === 'BODY' ? body : wheelRoots[k];
  const rel = mat4.create();
  mat4.invert(rel, k === 'BODY' ? mat4.create() : worlds.get(target));
  mat4.multiply(rel, rel, worlds.get(n));
  const flat = doc.createNode(n.getName()).setMesh(n.getMesh()).setMatrix(rel);
  n.setMesh(null);
  target.addChild(flat);
}

// 5) Remove the old Sketchfab chain, strip heavy material features
scene.listChildren().filter((n) => n !== body && !Object.values(wheelRoots).includes(n)).forEach((n) => scene.removeChild(n));
for (const m of doc.getRoot().listMaterials()) {
  m.getExtension('KHR_materials_transmission')?.dispose();           // avoids Three's transmission render pass
  if (/glass|window/i.test(m.getName())) {                           // fake glass with alpha instead
    const c = m.getBaseColorFactor(); m.setBaseColorFactor([c[0], c[1], c[2], /red|orange/i.test(m.getName()) ? 0.75 : 0.3]);
    m.setAlphaMode('BLEND').setDoubleSided(true);
  }
}

// 6) Merge per material, weld, compress
await doc.transform(prune(), dedup(), join({ keepMeshes: false }), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

await io.write(output, doc);

const prims = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
console.log({ drawCalls: prims, nodes: doc.getRoot().listNodes().length, materials: doc.getRoot().listMaterials().length });
for (const [k, w] of Object.entries(wheelRoots)) console.log(k, 'children:', w.listChildren().length);
