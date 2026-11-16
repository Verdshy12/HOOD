import assert from 'node:assert/strict';
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { resolveVehiclePhysics } from '../src/physics/vehicleProfiles.js';

for (const [variantId, baseId] of [
  ['dodge-track', 'dodge'],
  ['subaru-street', 'subaru'],
  ['nissan-skyline-r34-gt-r-street', 'nissan-skyline-r34-gt-r']
]) {
  const variant = CONFIG.cars[variantId];
  const base = CONFIG.cars[baseId];
  assert.equal(variant.model, base.model);
  assert.notEqual(variant.previewImage, base.previewImage);
  assert.ok(variant.bodyColor);
  assert.ok(variant.paintMaterials.length);
  assert.notEqual(
    resolveVehiclePhysics(variantId, variant.physics).maxSpeed,
    resolveVehiclePhysics(baseId).maxSpeed
  );
}

assert.equal(CONFIG.cars.nissan_x_trail, undefined);
for (const car of Object.values(CONFIG.cars)) {
  assert.ok(car.previewImage);
  accessSync(fileURLToPath(new URL(`../${car.previewImage}`, import.meta.url)));
}
assert.equal(
  CONFIG.cars['nissan-skyline-r34-gt-r-street'].model,
  CONFIG.cars['nissan-skyline-r34-gt-r'].model
);
assert.ok(CONFIG.car.chase[1] <= 2.5 && CONFIG.car.chase[2] <= 7);
assert.ok(CONFIG.car.chase[1] <= 2.1 && CONFIG.car.chase[2] <= 5.8);
assert.equal(CONFIG.cars['dodge-track'].physics.acceleration, 1.15);
assert.equal(CONFIG.cars['subaru-street'].physics.acceleration, 1.08);
console.log('PASS  garage variants, removal, and close chase-camera configuration');
