import assert from 'node:assert/strict';
import { createInput } from '../src/core/input.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const classes = new Set();
const listeners = new Map();
globalThis.window = {
  DeviceOrientationEvent: function DeviceOrientationEvent() {},
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

try {
  const input = createInput();
  assert.equal(await input.enableTiltSteering(), true);
  assert.equal(classes.has('tilt-ready'), true);
  assert.equal(listeners.get('deviceorientation').length, 1);
  input.disableTiltSteering();
  assert.equal(classes.has('tilt-ready'), false);
  console.log('PASS  mobile tilt steering enables and cleanly switches back to pads');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
