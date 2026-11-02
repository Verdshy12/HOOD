// Nissan GT-R R35 — initial dedicated physics profile.
// Values are starting simulation parameters, not a claim of
// exact manufacturer test-bench measurements.

export const GTR35_PHYSICS = {
  // Chassis
  mass: 1740,
  wheelR: 0.36,
  wheelbase: 2.78,

  // Engine: 3.8L twin-turbo V6 baseline
  idle: 650,
  redline: 7000,
  peakTorque: 588,
  peakTorqueRPM: 4500,
  torqueFloor: 180,
  torqueCurveWidth: 5200,

  // GR6 six-speed dual-clutch gearbox
  ratios: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796],
  final: 3.70,
  reverseRatio: 3.5,
  eff: 0.90,

  // Handling and resistance — initial HOOD tuning
  drag: 0.75,
  maxReverse: 12,
  grip: 1.15,
  steerLock: 0.58,
  acceleration: 1.0,
  braking: 1.0,

  // HOOD gameplay limiter
  maxSpeed: 200 / 3.6
};
