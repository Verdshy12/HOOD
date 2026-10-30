// Loads the REAL optimized car with Three's GLTFLoader in Node (textures stripped because Node has no image decoder).
import fs from 'node:fs'; import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { rigCar } from '../src/car/carRig.js';
import { NodeIO } from '@gltf-transform/core'; import { KHRONOS_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder as MD, MeshoptEncoder as ME } from 'meshoptimizer';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };

await MD.ready; await ME.ready; const io = new NodeIO().registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MD, 'meshopt.encoder': ME });
const modelPath = process.argv[2] ?? 'models/dodge.glb';
const targetLength = Number(process.argv[3] ?? 5.02);
const wheelLayout = process.argv[4];
const doc = await io.read(modelPath); doc.getRoot().listTextures().forEach((t) => t.dispose());
const buf = await io.writeBinary(doc);                                         // textureless copy, still meshopt-compressed
const gltf = await new Promise((res, rej) => { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej); });

let drawCalls = 0; gltf.scene.traverse((o) => { if (o.isMesh) drawCalls++; });
const car = rigCar(gltf.scene, { targetLength, wheelLayout });
ok('all 4 wheels found', car.ok);
ok('only 4 wheel pivots (v1 animated 1,240+ meshes)', Object.keys(car.wheels).length === 4, drawCalls + ' meshes total in model');
if (wheelLayout === 'skyline-r34') {
  ok('each wheel pivot carries separated tire and rim geometry',
    Object.values(car.wheels).every((wheel) => wheel.parts.length >= 2),
    Object.values(car.wheels).map((wheel) => wheel.parts.length).join('/'));
} else if (modelPath === 'models/nissan_x_trail.glb') {
  ok('each X-Trail pivot carries its separate rim and hub meshes',
    Object.values(car.wheels).every((wheel) => wheel.parts.length >= 5),
    Object.values(car.wheels).map((wheel) => wheel.parts.length).join('/'));
  const rimMaterials = Object.values(car.wheels).flatMap((wheel) => wheel.parts)
    .filter((part) => part.material.name === 'metal')
    .map((part) => part.material);
  ok('X-Trail rims use a visible metallic finish',
    rimMaterials.length === 12 && rimMaterials.every((material) => material.metalness >= 0.65 && material.roughness <= 0.32),
    rimMaterials.length + ' rim pieces');
}

const size = new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3());
ok(`car is ${targetLength.toFixed(2)} m long, faces -Z (z is longest axis)`, Math.abs(size.z - targetLength) < 0.02 && size.z > size.x && size.z > size.y, size.toArray().map((v) => v.toFixed(2)).join(' x '));
const w = car.wheels; const fl = w.FL.centre, fr = w.FR.centre, rl = w.RL.centre;
ok('front wheels are at -Z (forward), rear at +Z', fl.z < rl.z, 'front z ' + fl.z.toFixed(2) + ', rear z ' + rl.z.toFixed(2));
ok('left wheels are at -X (driver side when facing -Z)', fl.x < 0 && fr.x > 0, 'FL.x ' + fl.x.toFixed(2) + ' FR.x ' + fr.x.toFixed(2));
const wheelbase = rl.z - fl.z, track = fr.x - fl.x; ok('wheelbase ~2.7-3.0 m, track ~1.4-1.7 m', wheelbase > 2.6 && wheelbase < 3.1 && track > 1.4 && track < 1.8, wheelbase.toFixed(2) + ' / ' + track.toFixed(2));

// KEY CHECK (exact, vertex-based): farthest vertex from the wheel's axle must be identical before and after spin/steer.
const maxRadius = (wheel) => { const piv = new THREE.Vector3(); wheel.spin.getWorldPosition(piv); const q = new THREE.Vector3(); let m = 0; wheel.spin.updateWorldMatrix(true, true);
  wheel.spin.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { q.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(wheel.steer.getWorldQuaternion(new THREE.Quaternion())); const d = q.clone().sub(piv); d.sub(ax.multiplyScalar(d.dot(ax))); m = Math.max(m, d.length()); } }); return m; };
const r0 = maxRadius(w.RL), rf0 = maxRadius(w.FL); const wheelCentre0 = new THREE.Box3().setFromObject(w.RL.spin).getCenter(new THREE.Vector3());
ok('wheel diameter 0.65-0.80 m (matches WHEEL_R 0.34)', 2 * r0 > 0.65 && 2 * r0 < 0.8, (2 * r0).toFixed(3) + ' m');
const pivotPosition = w.RL.steer.getWorldPosition(new THREE.Vector3());
const pivotError = Math.hypot(wheelCentre0.y - pivotPosition.y, wheelCentre0.z - pivotPosition.z);
ok('pivot is ON the axle: wheel centre matches in the radial plane (<2 cm)', pivotError < 0.02, pivotError.toFixed(3) + ' m');
car.update(0.4, 2.3); car.root.updateMatrixWorld(true);
const r1 = maxRadius(w.RL), rf = maxRadius(w.FL);
ok('spinning 2.3 rad leaves axle-radius unchanged (<1 mm) => no wobble', Math.abs(r1 - r0) < 0.001, 'before ' + r0.toFixed(4) + ' after ' + r1.toFixed(4));
ok('steered+spun front wheel keeps its own radius (<1 mm; fronts are smaller: staggered fitment)', Math.abs(rf - rf0) < 0.001, rf0.toFixed(3) + ' -> ' + rf.toFixed(3));
// steering direction: +steer (right turn) must rotate front wheels so their front points toward +X (right)
car.update(0.5, 0); car.root.updateMatrixWorld(true);
const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(w.FL.steer.getWorldQuaternion(new THREE.Quaternion())); ok('right steer turns wheels toward +X', fwd.x > 0.2, 'wheel forward = ' + fwd.toArray().map((v) => v.toFixed(2)).join(','));
ok('both front wheel assemblies follow steering input',
  w.FL.steer.rotation.y === -0.5 && w.FR.steer.rotation.y === -0.5 &&
  w.RL.steer.rotation.y === 0 && w.RR.steer.rotation.y === 0);
ok('each wheel assembly carries its attached tire and rim parts',
  Object.values(w).every((wheel) => wheel.parts.length > 0 && wheel.parts.every((part) => part.parent === wheel.spin)));
