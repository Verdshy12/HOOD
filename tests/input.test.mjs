import assert from 'node:assert/strict';
import { createInput } from '../src/core/input.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const classes = new Set();
const listeners = new Map();
globalThis.window = {
  DeviceOrientationEvent: function DeviceOrientationEvent() {},
  orientation: 0,
  addEventListener(name, callback) {
    const callbacks = listeners.get(name) || [];
    callbacks.push(callback);
    listeners.set(name, callbacks);
  }
};
globalThis.document = {
  body: {
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); }
    }
  },
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { getGamepads: () => [] }
});

try {
  const input = createInput();
  const enablingTilt = input.enableTiltSteering();
  listeners.get('deviceorientation')[0]({ gamma: 0, beta: 0 });
  assert.equal(await enablingTilt, true);
  assert.equal(classes.has('tilt-ready'), true);
  assert.equal(listeners.get('deviceorientation').length, 1);
  listeners.get('deviceorientation')[0]({ gamma: 12, beta: 0 });
  for (let frame = 0; frame < 5; frame++) input.poll(0.05);
  assert.ok(input.poll(0.05).steer > 0);
  input.disableTiltSteering();
  assert.equal(classes.has('tilt-ready'), false);
  assert.equal(input.poll(0.05).steer, 0);
  console.log('PASS  mobile tilt steering reads motion and cleanly switches back to pads');

  const unavailableInput = createInput();
  assert.equal(await unavailableInput.enableTiltSteering(), false);
  assert.equal(classes.has('tilt-unavailable'), true);
  console.log('PASS  mobile tilt falls back when no orientation sensor events arrive');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalNavigator === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
}
