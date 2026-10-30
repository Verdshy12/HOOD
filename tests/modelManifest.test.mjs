import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModelManifest } from '../tools/model-manifest.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hood-model-manifest-'));
try {
  fs.mkdirSync(path.join(directory, 'nested cars'));
  fs.writeFileSync(path.join(directory, 'My Car.glb'), '');
  fs.writeFileSync(path.join(directory, 'not-a-model.gltf'), '');
  fs.writeFileSync(path.join(directory, 'nested cars', 'SUV.glb'), '');

  const { models, manifestPath } = buildModelManifest(directory);
  assert.deepEqual(models, [
    { id: 'my-car', name: 'My Car', model: './models/My%20Car.glb' },
    { id: 'nested-cars-suv', name: 'SUV', model: './models/nested%20cars/SUV.glb' }
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), { models });
  console.log('PASS  model manifest discovers nested GLB files and encodes URLs');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
