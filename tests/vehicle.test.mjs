import { createVehicle, stepVehicle, CAR } from '../src/car/vehicle.js';
const DT = 1 / 120, kmh = (m) => m * 3.6;
const ok = (name, cond, info = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  [' + info + ']' : '')); if (!cond) process.exitCode = 1; };
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

// 1) 0-100 km/h and top speed, count gear shifts (hunting check)
{ const s = createVehicle(); let t = 0, t100 = null, shifts = 0, g = 0, hist = [];
  while (t < 90) { stepVehicle(s, { ...idle, throttle: 1 }, null, DT); t += DT;
    if (t100 === null && kmh(s.speed) >= 100) t100 = t; if (s.gear !== g) { shifts++; hist.push(s.gear + 1); g = s.gear; } }
  ok('0-100 km/h between 4.0 and 7.0 s', t100 > 4 && t100 < 7, t100?.toFixed(2) + ' s');
  ok('top speed 230-270 km/h', kmh(s.speed) > 230 && kmh(s.speed) < 270, kmh(s.speed).toFixed(0) + ' km/h');
  ok('gear sequence is monotonic (no hunting)', hist.every((x, i) => i === 0 || x === hist[i - 1] + 1), hist.join('>')); }

// 2) braking 100 -> 0
{ const s = createVehicle(); s.vz = -27.78; s.u = 27.78; s.speed = 27.78; s.gear = 3; let d = 0, t = 0;
  while (s.speed > 0.05 && t < 20) { const z0 = s.z; stepVehicle(s, { ...idle, brake: 1 }, null, DT); d += Math.abs(s.z - z0); t += DT; }
  ok('100->0 braking 35-50 m', d > 35 && d < 50, d.toFixed(1) + ' m'); }

// 3) steady circle: heading must wrap past +-pi (old code clamped at +-1.25 rad) and radius ~ wheelbase/tan(delta)
{ const s = createVehicle(); s.vz = -8; s.u = 8; let maxPsi = 0, turned = 0, last = s.psi;
  for (let i = 0; i < 120 * 30; i++) { stepVehicle(s, { ...idle, throttle: 0.25, steer: 0.5 }, null, DT);
    let d = s.psi - last; if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI; turned += d; last = s.psi; maxPsi = Math.max(maxPsi, Math.abs(s.psi)); }
  ok('can turn more than 2 full revolutions (no heading clamp)', Math.abs(turned) > 4 * Math.PI, (turned / (2 * Math.PI)).toFixed(1) + ' revs'); }

// 4) handbrake flick: slides 15-65 deg, then recovers by itself; plain cornering stays gripped
{ const a = createVehicle(); a.vz = -25; a.u = 25; a.gear = 3; const b = createVehicle(); b.vz = -25; b.u = 25; b.gear = 3; let sa = 0, sb = 0;
  for (let i = 0; i < 120 * 6; i++) { const flick = i < 60;   // 0.5 s handbrake
    stepVehicle(a, { ...idle, throttle: flick ? .6 : 0, steer: flick ? .5 : 0, handbrake: flick }, null, DT);
    stepVehicle(b, { ...idle, throttle: .6, steer: .3 }, null, DT);
    sa = Math.max(sa, Math.abs(a.slip)); sb = Math.max(sb, Math.abs(b.slip)); }
  ok('handbrake flick: peak slip 15-65 deg', sa > 0.26 && sa < 1.13, (sa * 57.3).toFixed(0) + ' deg');
  ok('...and recovers to <8 deg within 5.5 s of release', Math.abs(a.slip) < 0.14, (Math.abs(a.slip) * 57.3).toFixed(1) + ' deg');
  ok('pushing a corner at the grip limit: slip < 18 deg (arcade: a little slide is wanted)', sb < 0.31, (sb * 57.3).toFixed(1) + ' deg'); }

// 5) reverse: brake from standstill moves the car backwards, capped
{ const s = createVehicle(); for (let i = 0; i < 120 * 10; i++) stepVehicle(s, { ...idle, brake: 1 }, null, DT);
  ok('reverse works and is capped near 12 m/s', s.u < -5 && s.u > -13, s.u.toFixed(1) + ' m/s'); }

// 6) grass is slower and has less grip than asphalt
{ const r = createVehicle(), g = createVehicle(); for (let i = 0; i < 120 * 8; i++) { stepVehicle(r, { ...idle, throttle: 1 }, { mu: 1, roll: .015 }, DT); stepVehicle(g, { ...idle, throttle: 1 }, { mu: .55, roll: .08 }, DT); }
  ok('grass slower than asphalt after 8 s', g.speed < r.speed, kmh(g.speed).toFixed(0) + ' vs ' + kmh(r.speed).toFixed(0)); }

// 7) fuzz: random inputs never produce NaN / Infinity / absurd speed
{ const s = createVehicle(); let bad = false, seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let c = { ...idle }; for (let i = 0; i < 120 * 600; i++) { if (i % 60 === 0) c = { throttle: rnd() > .4 ? rnd() : 0, brake: rnd() > .7 ? 1 : 0, steer: rnd() * 2 - 1, handbrake: rnd() > .8, nitro: rnd() > .7 };
    stepVehicle(s, c, rnd() > .5 ? null : { mu: .55, roll: .08 }, DT); if (![s.x, s.z, s.psi, s.vx, s.vz, s.rpm].every(Number.isFinite) || s.speed > 120) { bad = true; break; } }
  ok('600 s random-input fuzz stays finite and bounded', !bad); }
