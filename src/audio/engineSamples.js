// src/audio/engineSamples.js — recorded engine loops, crossfaded by RPM.
//
// Each layer is a steady-RPM loop. `rpm` is the engine speed it was recorded at.
// Playback pitch follows rpm / layer.rpm, and neighbouring layers crossfade.

let ctx = null;
let master = null;
let profile = null;
let layers = [];
let building = null;

const rawCache = new Map(); // url -> Promise<ArrayBuffer>

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function fetchRaw(url) {
  if (!rawCache.has(url)) {
    rawCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
        return r.arrayBuffer();
      })
    );
  }
  return rawCache.get(url);
}

function teardown() {
  for (const L of layers) {
    try { L.src.stop(); } catch { /* already stopped */ }
    L.src.disconnect();
    L.gain.disconnect();
  }
  layers = [];
}

async function build() {
  const cfg = profile;
  if (!ctx || !cfg) return;

  const defs = [...cfg.layers].sort((a, b) => a.rpm - b.rpm);
  const made = [];

  for (const def of defs) {
    const raw = await fetchRaw(def.src);
    const buffer = await ctx.decodeAudioData(raw.slice(0)); // slice: decode detaches the buffer

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (def.loopStart != null) src.loopStart = def.loopStart;
    if (def.loopEnd != null) src.loopEnd = def.loopEnd;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(master);
    src.start();

    made.push({ rpm: def.rpm, src, gain });
  }

  // The car may have changed while we were decoding.
  if (profile !== cfg) {
    layers = made;
    teardown();
    return;
  }

  layers = made;
  master.gain.setTargetAtTime(cfg.volume ?? 0.7, ctx.currentTime, 0.2);
  console.log('[HOOD Audio] Engine samples ready:', layers.length, 'layers');
}

// Call when a car is chosen. Prefetches the files; safe to call before user interaction.
export async function setEngineSamples(cfg) {
  teardown();
  profile = cfg && cfg.layers && cfg.layers.length ? cfg : null;
  if (!profile) return;

  const chosen = profile;
  await Promise.all(chosen.layers.map((l) => fetchRaw(l.src)));
  if (profile === chosen && ctx) await build();
}

// Call from a user gesture (key press / click) to unlock audio.
export function startSamples() {
  if (!profile) return;

  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();

  if (!layers.length && !building) {
    building = build()
      .catch((e) => console.warn('[HOOD Audio] Could not build engine samples:', e))
      .finally(() => { building = null; });
  }
}

// Call every frame.
export function updateSamples(rpm, throttle = 0) {
  if (!ctx || !layers.length) return;

  const t = ctx.currentTime;
  const load = 0.55 + 0.45 * clamp01(throttle); // quieter when coasting

  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const lo = layers[i - 1];
    const hi = layers[i + 1];

    let w = 1;
    if (rpm < L.rpm) w = lo ? clamp01((rpm - lo.rpm) / (L.rpm - lo.rpm)) : 1;
    else if (rpm > L.rpm) w = hi ? clamp01(1 - (rpm - L.rpm) / (hi.rpm - L.rpm)) : 1;

    // sqrt gives an equal-power crossfade between neighbours.
    L.gain.gain.setTargetAtTime(Math.sqrt(w) * load, t, 0.05);
    L.src.playbackRate.setTargetAtTime(Math.min(2, Math.max(0.5, rpm / L.rpm)), t, 0.05);
  }
}

export function stopSamples() {
  teardown();
  profile = null;
  if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
}
