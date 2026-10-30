// src/car/vehicle.js — pure physics (no THREE, no DOM) so it can be unit-tested in Node.
// World frame: x = east, z = south. Heading psi: forward = (sin psi, -cos psi); psi=0 faces north; +psi turns right.
export const G = 9.81;
export const CAR = {
  mass: 1900, wheelR: 0.34, wheelbase: 2.95, final: 3.09, eff: 0.9,
  idle: 850, redline: 6400,
  ratios: [4.71, 3.14, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], reverseRatio: 3.5,
  drag: 0.70,            // 0.5 * rho * CdA  (N per (m/s)^2) -> tunes top speed
  maxReverse: 12,        // m/s
  // --- ARCADE FEEL (NFS-style). Change these first when tuning. ---
  grip: 1.15,            // multiplier on tyre grip: >1 = more forgiving than real life
  steerLock: 0.62,       // rad of front-wheel lock at standstill (falls off with speed)
};
const torque = (rpm) => Math.max(180, 560 * (1 - ((rpm - 4300) / 5200) ** 2));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export function createVehicle(x = 0, z = 0, psi = 0) {
  return { x, z, psi, vx: 0, vz: 0, yawRate: 0, rpm: CAR.idle, gear: 0, shiftTimer: 0,
           throttle: 0, nitro: 1, reverse: false,
           // read-only outputs (for HUD / audio / camera / animation)
           speed: 0, u: 0, v: 0, aLong: 0, aLat: 0, slip: 0, boosting: false, drifting: false,
           wheelAngle: 0, wheelSpin: 0,
          // Damped chassis suspension state.
          suspensionY: 0, suspensionVelocity: 0,
          suspensionPitch: 0, suspensionPitchVelocity: 0,
          suspensionRoll: 0, suspensionRollVelocity: 0 };
}

/** controls: {throttle 0..1, brake 0..1, steer -1..1, handbrake bool, nitro bool}
 *  surface:  {mu, roll}  (asphalt {1, .015}, grass {.55, .08}) */
export function stepVehicle(s, c, surface, dt) {
  const mu = surface?.mu ?? 1, roll = surface?.roll ?? 0.015;
  const hand = !!c.handbrake;

  // --- 1. Steering -> yaw (uses last step's speed), then rotate heading
  const uPrev = s.u, au = Math.abs(uPrev);
  const lock = CAR.steerLock / (1 + (au / 12) ** 1.3);
  const A = mu * G * CAR.grip * (hand ? 0.35 : 1);                       // lateral grip limit (m/s^2)
  s.drifting = hand && au > 8;
  let rT = (uPrev / CAR.wheelbase) * Math.tan(clamp(c.steer, -1, 1) * lock);
  if (s.drifting) { rT *= 1.3; if (s.throttle > 0.3) rT += c.steer * s.throttle * 0.5; }
  else { const rMax = (1.25 * A) / Math.max(au, 2); rT = clamp(rT, -rMax, rMax); }   // understeer at the limit
  s.yawRate = damp(s.yawRate, rT, 10, dt);
  s.psi += s.yawRate * dt;
  if (s.psi > Math.PI) s.psi -= 2 * Math.PI; else if (s.psi < -Math.PI) s.psi += 2 * Math.PI;   // wrap, never clamp

  // --- 2. Decompose world velocity in the NEW heading basis
  const fx = Math.sin(s.psi), fz = -Math.cos(s.psi), rx = Math.cos(s.psi), rz = Math.sin(s.psi);
  let u = s.vx * fx + s.vz * fz, v = s.vx * rx + s.vz * rz;

  // --- 3. Pedals / reverse
  if (c.brake > 0.1 && u < 0.5 && c.throttle < 0.05) s.reverse = true;
  else if (c.throttle > 0.1 && u > -0.5) s.reverse = false;
  const gas = s.reverse ? c.brake : c.throttle, brk = s.reverse ? c.throttle : c.brake;
  s.throttle = damp(s.throttle, gas, gas > s.throttle ? 6 : 10, dt);
  s.boosting = !!c.nitro && s.nitro > 0.02 && gas > 0.1 && !s.reverse;
  s.nitro = clamp(s.nitro + (s.boosting ? -0.22 : 0.05) * dt, 0, 1);

  // --- 4. Engine + automatic gearbox
  const ratio = (s.reverse ? CAR.reverseRatio : CAR.ratios[s.gear]) * CAR.final;
  const driven = ((Math.abs(u) / CAR.wheelR) * 60 / (2 * Math.PI)) * ratio;
  s.shiftTimer = Math.max(0, s.shiftTimer - dt);
  s.rpm = damp(s.rpm, Math.abs(u) < 4 ? CAR.idle + s.throttle * 3200 : Math.max(CAR.idle, driven), s.shiftTimer > 0 ? 7 : 14, dt);
  if (!s.reverse && s.shiftTimer === 0) {
    if (s.rpm > CAR.redline - 350 && s.gear < CAR.ratios.length - 1 && s.throttle > 0.3) { s.gear++; s.shiftTimer = 0.22; }
    else if (s.gear > 0 && driven < (s.throttle > 0.85 ? 3400 : 1800) && au > 3) { s.gear--; s.shiftTimer = 0.18; }
    else if (au < 2.5) s.gear = 0;
  }
  s.rpm = clamp(s.rpm, CAR.idle, CAR.redline);

  let Fd = s.shiftTimer > 0 ? 0 : (torque(s.rpm) * s.throttle * (s.boosting ? 1.35 : 1) * ratio * CAR.eff) / CAR.wheelR;
  Fd = Math.min(Fd, CAR.mass * G * mu * (hand ? 0.45 : 0.9));          // traction limit
  if (s.reverse && -u > CAR.maxReverse) Fd = 0;
  const driveSign = s.reverse ? -1 : 1;

  // --- 5. Longitudinal integration (resistances can stop the car but never reverse it)
  const Fdrag = CAR.drag * u * Math.abs(u);
  let un = u + ((driveSign * Fd - Fdrag) / CAR.mass) * dt;
  const Fres = brk * CAR.mass * G * mu * 1.05 + (hand ? 0.3 * CAR.mass * G * mu : 0)
             + roll * CAR.mass * G + 0.04 * CAR.mass * G * (1 - s.throttle) * Math.min(1, au / 5);
  const dec = (Fres / CAR.mass) * dt;
  un = Math.abs(un) <= dec ? 0 : un - Math.sign(un) * dec;

  // --- 6. Lateral grip pulls sideways velocity to zero, limited by mu*g  (this IS the drift model)
  const slipNow = Math.abs(Math.atan2(v, Math.max(Math.abs(u), 0.5)));
  const recover = 1 + 1.5 * clamp((slipNow - 0.6) / 0.5, 0, 1);       // tyres bite again past ~35 deg slip -> slides stay catchable
  let vn = v - clamp(v, -A * recover * dt, A * recover * dt);
  if (au < 3) vn *= Math.exp(-8 * dt);                                  // no sideways creep at walking speed

  // --- 7. Recompose, integrate position, publish outputs
  s.vx = un * fx + vn * rx; s.vz = un * fz + vn * rz;
  s.x += s.vx * dt; s.z += s.vz * dt;
  s.aLong = (un - u) / dt;
  s.aLat = un * s.yawRate;

  // Chassis suspension: spring + damper, independent of tyre forces.
  // Acceleration shifts the body; damping prevents endless oscillation.
  const suspensionDt = Math.min(dt, 0.05);
  const pitchTarget = clamp(s.aLong * 0.0028, -0.055, 0.045);
  const rollTarget = clamp(-s.aLat * 0.0038, -0.075, 0.075);
  const pitchSpring = 42;
  const pitchDamper = 12;
  const rollSpring = 38;
  const rollDamper = 11;
  const verticalSpring = 48;
  const verticalDamper = 12;

  s.suspensionPitchVelocity += (
    (pitchTarget - s.suspensionPitch) * pitchSpring
    - s.suspensionPitchVelocity * pitchDamper
  ) * suspensionDt;
  s.suspensionPitch += s.suspensionPitchVelocity * suspensionDt;

  s.suspensionRollVelocity += (
    (rollTarget - s.suspensionRoll) * rollSpring
    - s.suspensionRollVelocity * rollDamper
  ) * suspensionDt;
  s.suspensionRoll += s.suspensionRollVelocity * suspensionDt;

  // Optional surface roughness can excite the vertical suspension.
  const roughness = Math.max(0, surface?.roughness ?? 0);
  const roadInput = roughness * (
    Math.sin(s.x * 7.1) * Math.sin(s.z * 5.7)
  );
  s.suspensionVelocity += (
    -s.suspensionY * verticalSpring
    -s.suspensionVelocity * verticalDamper
    + roadInput
  ) * suspensionDt;
  s.suspensionY += s.suspensionVelocity * suspensionDt;
  s.suspensionY = clamp(s.suspensionY, -0.16, 0.12);

  s.u = un; s.v = vn; s.speed = Math.hypot(s.vx, s.vz);
  s.slip = Math.atan2(vn, Math.max(Math.abs(un), 0.1));
  s.wheelAngle = clamp(c.steer, -1, 1) * lock;
  s.wheelSpin -= (un / CAR.wheelR) * dt;
  return s;
}

/** Call after a collision test. (nx,nz) = unit normal pointing from obstacle toward the car. Returns impact speed (m/s). */
export function applyImpact(s, nx, nz, depth) {
  s.x += nx * depth; s.z += nz * depth;
  const vn = s.vx * nx + s.vz * nz;
  if (vn >= 0) return 0;
  const e = 0.2;                                                       // bounciness
  s.vx -= (1 + e) * vn * nx; s.vz -= (1 + e) * vn * nz;
  const tx = -nz, tz = nx, vt = s.vx * tx + s.vz * tz;
  s.vx -= vt * 0.1 * tx; s.vz -= vt * 0.1 * tz;                        // scrape friction
  s.yawRate *= 0.6;
  const impactSpeed = -vn;
  s.suspensionVelocity += Math.min(1.8, impactSpeed * 0.045);
  return impactSpeed;
}
