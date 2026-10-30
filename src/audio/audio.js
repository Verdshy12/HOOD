// src/audio/audio.js — engine sound only (music lives in /music/radio.js)`
import { CAR } from '../car/vehicle.js';
const $ = (id) => document.getElementById(id);

// ---------- Engine Audio ----------
let audio = null;

export function startAudio() {
  if (audio || !(window.AudioContext || window.webkitAudioContext)) {
    return;
  }

  const AudioContextClass =
  window.AudioContext || window.webkitAudioContext;

  const ctx = new AudioContextClass();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;

  const master = ctx.createGain();
  master.gain.value = 0;
  lp.connect(master);
  master.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();

  o1.type = "sawtooth";
  o2.type = "square";
  o3.type = "triangle";

  const g2 = ctx.createGain();
  const g3 = ctx.createGain();

  g2.gain.value = 0.5;
  g3.gain.value = 0.7;

  o1.connect(lp);
  o2.connect(g2).connect(lp);
  o3.connect(g3).connect(lp);

  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();

  lfo.frequency.value = 14;
  lg.gain.value = 0.25;
  lfo.connect(lg).connect(master.gain);

  [o1, o2, o3, lfo].forEach((oscillator) => oscillator.start());

  audio = { ctx, o1, o2, o3, lp, master, lfo };

  if (ctx.state === "suspended") {
    ctx.resume().catch(console.warn);
  }
}

export function updateAudio(rpm, throttle) {
  if (!audio) return;

  const f = (rpm / 60) * 4;
  const t = audio.ctx.currentTime;

  audio.o1.frequency.setTargetAtTime(f, t, 0.04);
  audio.o2.frequency.setTargetAtTime(f / 2, t, 0.04);
  audio.o3.frequency.setTargetAtTime(f * 2, t, 0.04);
  audio.lp.frequency.setTargetAtTime(
    300 + rpm * 0.25 + throttle * 700,
    t,
    0.05
  );
  audio.lfo.frequency.setTargetAtTime(f / 3, t, 0.05);
  audio.master.gain.setTargetAtTime(
    0.1 + 0.14 * throttle + 0.04 * (rpm / CAR.redline),
                                    t,
                                    0.05
  );
}
