import { createLoop } from '../src/core/loop.js'; import { QualityScaler } from '../src/core/quality.js'; import { smoothSteer } from '../src/core/input.js';
const ok = (n, c, i = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (i ? '  [' + i + ']' : '')); if (!c) process.exitCode = 1; };
// --- loop: with a fake clock, 1 simulated second must produce ~120 physics steps regardless of render fps
function runLoop(fps, seconds, workMs = 0) { let t = 0, q = null, steps = 0, renders = 0; const raf = (f) => { q = f; };
  const loop = createLoop({ step: () => steps++, render: () => renders++, raf, now: () => t }); loop.start();
  for (let i = 0; i < fps * seconds; i++) { t += 1000 / fps; q(t); } return { steps, renders, sim: loop.simTime }; }
for (const fps of [20, 60, 144]) { const r = runLoop(fps, 5); ok(`loop @${fps}fps: ~600 physics steps in 5 s`, fps === 20 ? r.steps > 450 : Math.abs(r.steps - 600) <= 3, r.steps + ' steps, ' + r.renders + ' renders'); }
{ let t = 0, q = null, steps = 0; const loop = createLoop({ step: () => steps++, render() {}, raf: (f) => { q = f; }, now: () => t }); loop.start(); t += 5000; q(t);   // 5 s hitch (tab hidden)
  ok('5 s stall does not trigger a 600-step spiral (max 6 steps/frame)', steps <= 6, steps + ' steps'); }
{ let t = 0, q = null, steps = 0; const loop = createLoop({ step: () => steps++, render() {}, raf: (f) => { q = f; }, now: () => t });
  loop.start(); t += 1000; q(t); const beforePause = loop.simTime; loop.stop(); t += 5000; q(t);
  ok('stopped loop does not advance while paused', loop.simTime === beforePause);
  loop.start(); t += 1000; q(t);
  ok('resumed loop continues from the same simulation time', loop.simTime > beforePause && loop.simTime < beforePause + 1.1, loop.simTime.toFixed(2) + ' s'); }
// --- quality scaler
{ const s = new QualityScaler({ targetFps: 45 }); let changes = []; for (let i = 0; i < 300; i++) { const r = s.sample(33); if (r) changes.push(r); }
  ok('sustained 30 fps lowers render scale step-by-step', changes.length >= 2 && changes[0] < 1 && s.scale >= 0.6, 'scales: ' + changes.join(' > '));
  const s2 = new QualityScaler({ targetFps: 45 }); s2.scale = 0.7; let up = 0; for (let i = 0; i < 1500; i++) if (s2.sample(8)) up++;
  ok('sustained 125 fps raises scale back up (slowly)', up >= 1 && s2.scale > 0.7, 'scale 0.7 -> ' + s2.scale);
  const s3 = new QualityScaler({ targetFps: 45 }); let flaps = 0; for (let i = 0; i < 3000; i++) if (s3.sample(i % 2 ? 14 : 30)) flaps++; ok('mixed 14/30 ms frames (avg 22 ms = 45 fps) do not flap', flaps <= 1, flaps + ' changes'); }
// --- steering smoothing
{ let s = 0; for (let i = 0; i < 60; i++) s = smoothSteer(s, 1, 1 / 60); const full = s; for (let i = 0; i < 20; i++) s = smoothSteer(s, 0, 1 / 60);
  ok('steer reaches full lock in ~0.3-0.4 s and recentres faster than it turns', full === 1 && Math.abs(s) < 0.4, 'after 20 frames release: ' + s.toFixed(2)); }
