import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { resolveVehiclePhysics } from '../src/physics/vehicleProfiles.js';

for (const [variantId, baseId] of [
  ['dodge-track', 'dodge'],
  ['subaru-street', 'subaru']
]) {
  const variant = CONFIG.cars[variantId];
  const base = CONFIG.cars[baseId];
  assert.equal(variant.model, base.model);
  assert.ok(variant.bodyColor);
  assert.ok(variant.paintMaterials.length);
  assert.notEqual(
    resolveVehiclePhysics(variantId, variant.physics).maxSpeed,
    resolveVehiclePhysics(baseId).maxSpeed
  );
}

assert.equal(CONFIG.cars['dodge-track'].physics.acceleration, 1.15);
assert.equal(CONFIG.cars['subaru-street'].physics.acceleration, 1.08);
console.log('PASS  same-model car profiles apply distinct paint and performance');
