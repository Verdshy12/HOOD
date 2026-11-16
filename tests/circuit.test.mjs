import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoute } from '../src/world/routes.js';

import {
  createCircuitSession,
  updateCircuitSession,
  formatLapTime
} from '../src/core/circuit.js';

const route = {
  id: 'test-circuit',
  w: 8,
  // Start/finish is on a straight section.
  pts: [
    0, 0,
    10, 0,
    10, 10,
    0, 10,
    -10, 0,
    -10, -10,
    0, 0
  ]
};

function crossGate(session, startTime) {
  updateCircuitSession(session, { x: -2, z: 0 }, startTime);
  return updateCircuitSession(
    session,
    { x: 2, z: 0 },
    startTime + 100
  );
}

test('creates a three-lap circuit session', () => {
  const session = createCircuitSession({ route, laps: 3 });

  assert.equal(session.status, 'ready');
  assert.equal(session.targetLaps, 3);
  assert.equal(session.completedLaps, 0);
});

test('rejects unsupported lap counts', () => {
  assert.throws(
    () => createCircuitSession({ route, laps: 6 }),
    /between 1 and 5/
  );
});

test('supports every circuit lap count from one through five', () => {
  for (let laps = 1; laps <= 5; laps++) {
    assert.equal(createCircuitSession({ route, laps }).targetLaps, laps);
  }
  assert.throws(() => createCircuitSession({ route, laps: 0 }), /between 1 and 5/);
});

test('first start-finish crossing starts the event', () => {
  const session = createCircuitSession({ route, laps: 3 });

  const result = crossGate(session, 1000);

  assert.equal(result.status, 'racing');
  assert.equal(result.currentLap, 1);
  assert.equal(result.completedLaps, 0);
});

test('counts laps and finishes at the configured lap count', () => {
  const session = createCircuitSession({
    route,
    laps: 3,
    minLapMs: 5000
  });

  crossGate(session, 1000);
  crossGate(session, 21000);
  crossGate(session, 41000);

  const result = crossGate(session, 61000);

  assert.equal(result.status, 'finished');
  assert.equal(result.completedLaps, 3);
  assert.equal(result.currentLap, null);
  assert.equal(result.lapTimes.length, 3);
  assert.equal(result.bestLapMs, 20000);
  assert.equal(result.totalTimeMs, 60000);
  assert.equal(result.lapTimes.reduce((sum, lapTime) => sum + lapTime, 0), result.totalTimeMs);
});

test('interpolates lap one and final lap at their actual start-line crossings', () => {
  const session = createCircuitSession({ route, laps: 3, minLapMs: 5000 });
  const crossAt = (crossingAt) => {
    updateCircuitSession(session, { x: -2, z: 0 }, crossingAt - 50);
    return updateCircuitSession(session, { x: 2, z: 0 }, crossingAt + 50);
  };

  crossAt(1050);
  crossAt(21000);
  crossAt(42000);
  const result = crossAt(62125);

  assert.deepEqual(result.lapTimes, [19950, 21000, 20125]);
  assert.equal(result.totalTimeMs, 61075);
  assert.equal(result.lapTimes.reduce((sum, lapTime) => sum + lapTime, 0), result.totalTimeMs);
});

test('supports the five-lap event option', () => {
  const session = createCircuitSession({ route, laps: 5, minLapMs: 5000 });

  crossGate(session, 1000);
  let result;
  for (let lap = 1; lap <= 5; lap++) {
    updateCircuitSession(session, { x: -2, z: 0 }, 1000 + lap * 20000);
    result = updateCircuitSession(
      session,
      { x: 2, z: 0 },
      1100 + lap * 20000
    );
  }

  assert.equal(result.status, 'finished');
  assert.equal(result.completedLaps, 5);
  assert.equal(result.lapTimes.length, 5);
});

test('live circuit catalogue contains closed, buildable routes', () => {
  const catalogue = JSON.parse(
    readFileSync(new URL('../data/routes/all-routes.json', import.meta.url), 'utf8')
  );
  const routes = catalogue.routes.filter((item) => item.circuit === true && item.mode === 'circuit');

  assert.equal(routes.length, 10);
  for (const circuit of routes) {
    assert.ok(circuit.pts.length >= 8);
    assert.ok(Math.hypot(
      circuit.pts[0] - circuit.pts.at(-2),
      circuit.pts[1] - circuit.pts.at(-1)
    ) < 0.1);
    assert.ok(buildRoute(circuit).path.length >= 500);
  }
});

test('does not count reverse crossings', () => {
  const session = createCircuitSession({ route, laps: 3 });

  updateCircuitSession(session, { x: 2, z: 0 }, 1000);
  const result = updateCircuitSession(session, { x: -2, z: 0 }, 1100);

  assert.equal(result.status, 'ready');
  assert.equal(result.completedLaps, 0);
});

test('does not count crossings outside the gate width', () => {
  const session = createCircuitSession({ route, laps: 3 });

  updateCircuitSession(session, { x: -2, z: 20 }, 1000);
  const result = updateCircuitSession(
    session,
    { x: 2, z: 20 },
    1100
  );

  assert.equal(result.status, 'ready');
});

test('formats lap times', () => {
  assert.equal(formatLapTime(125430), '02:05.430');
  assert.equal(formatLapTime(9345), '00:09.345');
  assert.equal(formatLapTime(null), '--:--.---');
});
