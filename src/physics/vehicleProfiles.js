import { CAR } from './vehicle.js';

import { DODGE_PHYSICS } from './vehicles/dodge.js';
import { SUBARU_PHYSICS } from './vehicles/subaru.js';
import { GTR35_PHYSICS } from './vehicles/gtr35.js';
import { SKYLINE_R34_PHYSICS } from './vehicles/skylineR34.js';

export const VEHICLE_PHYSICS = {
  dodge: DODGE_PHYSICS,
  subaru: SUBARU_PHYSICS,

  // Preserve the existing career ID.
  nissan_x_trail: GTR35_PHYSICS,
  'gtr-35': GTR35_PHYSICS,

  'nissan-skyline-r34-gt-r': SKYLINE_R34_PHYSICS,
  'nissan-skyline-r34-gt-r-street': SKYLINE_R34_PHYSICS
};

export function resolveVehiclePhysics(carId, overrides = {}) {
  const profile = VEHICLE_PHYSICS[carId] || {};

  return Object.freeze({
    ...CAR,
    ...profile,
    ...overrides
  });
}
