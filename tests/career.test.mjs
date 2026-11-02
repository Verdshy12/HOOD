import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCareerStore } from '../src/core/career.js';
import { CAREER_ROUTE_ORDER } from '../src/core/career.js';
import { CONFIG } from '../src/config.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

const storage = createMemoryStorage();
const career = createCareerStore(storage);
assert.equal(career.addProfile(' ').profile, null);
const { profile, persisted } = career.addProfile('Amani');
assert.equal(persisted, true);
assert.equal(profile.name, 'Amani');
assert.equal(career.completeEvent(profile.id, 'unknown-route').saved, false);
assert.equal(career.isEventUnlocked(profile.id, 'state-house-eastbound'), true);
assert.equal(career.isEventUnlocked(profile.id, 'nairobi-ngara-sprint'), false);
assert.equal(career.isCarUnlocked(profile.id, 'subaru'), true);
assert.equal(career.isCarUnlocked(profile.id, 'dodge'), false);

const completed = career.completeEvent(profile.id, 'state-house-eastbound');
assert.equal(completed.saved, true);
assert.equal(completed.alreadyCompleted, false);
assert.equal(completed.eventsCompleted, 1);
assert.deepEqual(completed.completedRouteIds, ['state-house-eastbound']);
assert.equal(career.isEventUnlocked(profile.id, 'nairobi-ngara-sprint'), true);
assert.equal(career.isCarUnlocked(profile.id, 'dodge'), true);
for (const [carId, car] of Object.entries(CONFIG.cars)) {
  const fresh = createCareerStore(createMemoryStorage());
  const { profile: newDriver } = fresh.addProfile('Driver');
  for (let index = 0; index < car.careerUnlockAt; index++) {
    fresh.completeEvent(newDriver.id, CAREER_ROUTE_ORDER[index]);
  }
  assert.equal(fresh.isCarUnlocked(newDriver.id, carId), true);
  if (car.careerUnlockAt > 0) {
    const locked = createCareerStore(createMemoryStorage());
    const { profile: lockedDriver } = locked.addProfile('Driver');
    for (let index = 0; index < car.careerUnlockAt - 1; index++) {
      locked.completeEvent(lockedDriver.id, CAREER_ROUTE_ORDER[index]);
    }
    assert.equal(locked.isCarUnlocked(lockedDriver.id, carId), false);
  }
}
const replayed = career.completeEvent(profile.id, 'state-house-eastbound');
assert.equal(replayed.alreadyCompleted, true);
assert.equal(replayed.eventsCompleted, 1);

const reloaded = createCareerStore(storage).snapshot();
assert.equal(reloaded.profiles[0].name, 'Amani');
assert.equal(reloaded.profiles[0].eventsCompleted, 1);
assert.equal(reloaded.profiles[0].completedRouteIds[0], 'state-house-eastbound');

const routeCatalogue = JSON.parse(readFileSync(new URL('../data/routes/all-routes.json', import.meta.url), 'utf8'));
const circuitOrder = CAREER_ROUTE_ORDER.slice(3).map((id) =>
  routeCatalogue.routes.find((route) => route.id === id)
);
assert.equal(circuitOrder.length, 8);
assert.ok(circuitOrder.every((route) => route?.circuit));
assert.ok(circuitOrder.every((route, index) =>
  index === 0 || route.lengthM >= circuitOrder[index - 1].lengthM
));
const progression = createCareerStore(createMemoryStorage());
const { profile: driver } = progression.addProfile('Nia');
for (let index = 0; index < CAREER_ROUTE_ORDER.length; index++) {
  const routeId = CAREER_ROUTE_ORDER[index];
  assert.equal(progression.isEventUnlocked(driver.id, routeId), true);
  if (index + 1 < CAREER_ROUTE_ORDER.length) {
    assert.equal(progression.isEventUnlocked(driver.id, CAREER_ROUTE_ORDER[index + 1]), false);
  }
  progression.completeEvent(driver.id, routeId);
}
assert.equal(progression.snapshot().profiles[0].eventsCompleted, CAREER_ROUTE_ORDER.length);
console.log('PASS  career profiles persist event progress and reject invalid events');
