import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder as MD, MeshoptEncoder as ME } from 'meshoptimizer';
import { CONFIG } from '../src/config.js';
import { createCarLights } from '../src/car/carLights.js';
import { rigCar } from '../src/car/carRig.js';

globalThis.document = {
  createElement: () => ({
    width: 128,
    height: 128,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}
    })
  })
};

const modelLights = [
  ['dodge', 'models/dodge.glb'],
  ['subaru', 'models/2006_subaru/subaru-wrx-sti.glb'],
  ['nissan-skyline-r34-gt-r', 'models/nissan_skyline_r34_gt-r.glb']
];

await MD.ready;
await ME.ready;
const io = new NodeIO()
  .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.decoder': MD, 'meshopt.encoder': ME });

for (const [carId, modelPath] of modelLights) {
  const car = CONFIG.cars[carId];
  const document = await io.read(modelPath);
  document.getRoot().listTextures().forEach((texture) => texture.dispose());
  const buffer = await io.writeBinary(document);
  const gltf = await new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      '',
      resolve,
      reject
    );
  });
  const riggedCar = rigCar(gltf.scene, {
    targetLength: car.targetLength,
    headingOffset: car.headingOffset,
    wheelLayout: car.wheelLayout
  });
  const lights = createCarLights(riggedCar.root, car);
  const sprites = riggedCar.root.children.filter((child) => child.isSprite);
  const spot = riggedCar.root.children.find((child) => child.isSpotLight);
  const headMaterials = new Set();
  const tailMaterials = new Set();
  const headPattern = new RegExp(car.lights.headMaterial, 'i');
  const tailPattern = new RegExp(car.lights.tailMaterial, 'i');

  riggedCar.root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of [].concat(object.material)) {
      if (!material?.emissive) continue;
      if (headPattern.test(material.name)) headMaterials.add(material);
      if (tailPattern.test(material.name)) tailMaterials.add(material);
    }
  });

  assert.ok(headMaterials.size > 0, `${carId}: headlight lens material matched`);
  assert.ok(tailMaterials.size > 0, `${carId}: taillight lens material matched`);
  assert.deepEqual(sprites.slice(0, 2).map((sprite) => sprite.position.toArray()), car.lights.head);
  assert.deepEqual(sprites.slice(2, 4).map((sprite) => sprite.position.toArray()), car.lights.tail);
  assert.ok(Math.abs(spot.position.y - car.lights.head[0][1]) < 1e-6);
  assert.ok(Math.abs(spot.position.z - car.lights.head[0][2] + 0.05) < 1e-6);

  lights.update(0.1, { head: true, brake: true, reverse: true });
  assert.ok([...headMaterials].every((material) => material.emissiveIntensity > 0));
  assert.ok([...tailMaterials].every((material) => material.emissiveIntensity > 0));
  assert.ok(spot.intensity > 0);
}

for (const [carId, baseId] of [
  ['dodge-track', 'dodge'],
  ['subaru-street', 'subaru'],
  ['nissan-skyline-r34-gt-r-street', 'nissan-skyline-r34-gt-r']
]) {
  assert.equal(CONFIG.cars[carId].lights, CONFIG.cars[baseId].lights);
}

console.log('PASS  model-specific headlight, taillight, and beam placement');
