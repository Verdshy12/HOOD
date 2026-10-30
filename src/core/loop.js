// src/core/loop.js — fixed-timestep simulation, variable-rate rendering.
// Physics always advances in 1/120 s slices => identical behaviour at 20 fps or 144 fps, and no "slow-mo" from a dt clamp.
export function createLoop({ step, render, fixedDt = 1 / 120, maxSubSteps = 6, raf = (f) => requestAnimationFrame(f), now = () => performance.now() }) {
  let acc = 0, last = now(), running = false, simTime = 0;
  const frame = (t) => {
    if (!running) return;
    raf(frame);
    const dt = Math.min((t - last) / 1000, 0.25); last = t; acc += dt;          // tab was hidden? never simulate more than 0.25 s at once
    let n = 0;
    while (acc >= fixedDt && n < maxSubSteps) { step(fixedDt); acc -= fixedDt; simTime += fixedDt; n++; }
    if (n === maxSubSteps) acc = 0;                                              // can't keep up: drop backlog instead of spiralling
    render(acc / fixedDt, dt);
  };
  return {
    start() { if (running) return; running = true; last = now(); raf(frame); },
    stop() { running = false; },                                                 // e.g. on webglcontextlost
    get simTime() { return simTime; }, get running() { return running; },
  };
}
