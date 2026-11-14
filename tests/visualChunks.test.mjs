import * as THREE from 'three';
import { WorldVisualChunks, WorldVisualStream } from '../src/world/visualChunks.js';

const ok = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) process.exitCode = 1;
};

const tile = {
  roads: [
    { w: 8, pts: [0, 0, 32, 0, 160, 0] },
    { w: 8, pts: [500, 500, 520, 500] }
  ],
  buildings: [
    { id: 0, h: 10, pts: [2, 2, 8, 2, 8, 8, 2, 8] },
    { id: 1, h: 10, pts: [500, 500, 508, 500, 508, 508, 500, 508] }
  ]
};

const chunks = new WorldVisualChunks(tile);
const nearby = chunks.cellsNear(0, 0, 300).map((cell) => cell.join(','));
ok('loads only cells within the Rust stream radius', nearby.includes('0,0') && !nearby.includes('3,3'));

const scene = new THREE.Scene();
const stream = new WorldVisualStream(scene, chunks);
stream.update(0, 0);
ok('builds nearby road and building meshes', stream.loaded.get('0,0')?.meshes.length === 2);
stream.update(500, 500);
ok('unloads distant chunks after the car moves', !stream.loaded.has('0,0') && stream.loaded.has('3,3'));
stream.dispose();
ok('disposes streamed scene resources', scene.children.length === 0);

const ordinaryGeometry = new THREE.BoxGeometry();
const barricadeGeometry = new THREE.BoxGeometry();
const ordinaryMaterial = new THREE.MeshStandardMaterial();
const sharedMaterial = new THREE.MeshStandardMaterial();
let ordinaryGeometryDisposals = 0;
let barricadeGeometryDisposals = 0;
let ordinaryMaterialDisposals = 0;
let sharedMaterialDisposals = 0;
ordinaryGeometry.addEventListener('dispose', () => ordinaryGeometryDisposals++);
barricadeGeometry.addEventListener('dispose', () => barricadeGeometryDisposals++);
ordinaryMaterial.addEventListener('dispose', () => ordinaryMaterialDisposals++);
sharedMaterial.addEventListener('dispose', () => sharedMaterialDisposals++);

const ordinaryMesh = new THREE.Mesh(ordinaryGeometry, ordinaryMaterial);
const barricadeGroup = new THREE.Group();
barricadeGroup.add(new THREE.Mesh(barricadeGeometry, sharedMaterial));
const disposalScene = new THREE.Scene();
const disposalStream = new WorldVisualStream(disposalScene, {
  cellsNear: () => [[0, 0]],
  buildChunk: () => [ordinaryMesh, barricadeGroup]
});
disposalStream.update(0, 0);
disposalStream.dispose();
ok('disposes ordinary and nested streamed geometry',
  ordinaryGeometryDisposals === 1 && barricadeGeometryDisposals === 1);
ok('disposes ordinary streamed materials only',
  ordinaryMaterialDisposals === 1 && sharedMaterialDisposals === 0);
