// src/car/carLights.js — headlights, tail lights, brake lights and reverse lights.
//
//  * tail / brake: the model's red glass material glows (found by material name) plus a red glow sprite
//  * headlights:   a white glow sprite per lamp plus one SpotLight that lights the road
//  * reverse:      a white glow sprite per lamp
//
// Lamp positions are guessed from the car's bounding box. Override them per car in config.js
// (car space: +x right, +y up, -z forward, origin at the middle of the car on the ground):
//
//   lights: {
//     head:    [[-0.68, 0.74, -2.45], [0.68, 0.74, -2.45]],
//     tail:    [[-0.70, 0.95,  2.45], [0.70, 0.95,  2.45]],
//     reverse: [[-0.40, 0.80,  2.48], [0.40, 0.80,  2.48]],
//     tailMaterial: 'red_glass',   // regex matched against material names
//     beam: true,                  // false = no SpotLight (cheaper)
//     beamIntensity: 250, beamAngle: 0.42, beamDistance: 70
//   }
//   lights: false   // no lights on this car

import * as THREE from 'three';

let glowTexture = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

export function createCarLights(root, carCfg) {
  const cfg = carCfg.lights;
  if (cfg === false) return { update() {} };
  const o = cfg || {};

  // ---- lamp positions, from the car's bounding box unless configured ----
  root.updateMatrixWorld(true);
  const wb = new THREE.Box3().setFromObject(root);
  const a = root.worldToLocal(wb.min.clone());
  const b = root.worldToLocal(wb.max.clone());
  const min = new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  const max = new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  const W = max.x - min.x;
  const H = max.y - min.y;
  const pair = (x, y, z) => [[-x, y, z], [x, y, z]];

  const headPos = o.head || pair(0.34 * W, min.y + 0.50 * H, min.z + 0.03);
  const tailPos = o.tail || pair(0.34 * W, min.y + 0.60 * H, max.z - 0.03);
  const revPos = o.reverse || pair(0.20 * W, min.y + 0.52 * H, max.z - 0.02);

  // ---- glow sprites ----
  function sprites(points, color, size) {
    return points.map((p) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow(),
        color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0
      }));
      sp.position.set(...p);
      sp.scale.setScalar(size);
      sp.renderOrder = 10;
      sp.visible = false;
      root.add(sp);
      return { sp, size };
    });
  }

  const headSprites = sprites(headPos, 0xfff4dd, 0.6);
  const tailSprites = sprites(tailPos, 0xff2418, 0.45);
  const revSprites = sprites(revPos, 0xffffff, 0.32);

  // ---- tail / brake: make the model's red glass glow ----
  const tailRe = new RegExp(o.tailMaterial || 'red_glass|taillight|tail_light|tail-light', 'i');
  const tailMats = new Set();
  root.traverse((m) => {
    if (!m.isMesh) return;
    for (const mat of [].concat(m.material)) {
      if (mat && 'emissive' in mat && tailRe.test(mat.name || '')) tailMats.add(mat);
    }
  });
  for (const mat of tailMats) {
    mat.emissive.set(0xff1a0a);
    mat.emissiveIntensity = 0;
    mat.needsUpdate = true;
  }

  // ---- headlight beam: a SpotLight that stays in the scene (intensity 0 when off), so toggling never recompiles shaders ----
  let spot = null;
  if (o.beam !== false) {
    spot = new THREE.SpotLight(0xfff1d6, 0, o.beamDistance ?? 70, o.beamAngle ?? 0.42, 0.7, 2);
    spot.position.set(0, headPos[0][1], min.z + 0.1);
    spot.target.position.set(0, 0, min.z - 20);
    root.add(spot, spot.target);
  }
  const beamIntensity = o.beamIntensity ?? 250;

  console.log('[HOOD] lights: ' + tailMats.size + ' tail material(s) glow' +
    (tailMats.size ? '' : ' (none matched "' + tailRe.source + '", using sprites only)') +
    ', beam ' + (spot ? 'on' : 'off'));

  const v = { head: 0, tail: 0, rev: 0 };

  function apply(list, level, maxOpacity, grow = 0) {
    const on = level > 0.02;
    for (const { sp, size } of list) {
      sp.visible = on;
      sp.material.opacity = level * maxOpacity;
      sp.scale.setScalar(size * (1 + grow * level));
    }
  }

  return {
    // state: { head: bool, brake: bool, reverse: bool }
    update(dt, state) {
      const k = 1 - Math.exp(-16 * Math.max(dt, 0.001));
      const tailTarget = state.brake ? 1 : state.head ? 0.4 : 0;

      v.head += ((state.head ? 1 : 0) - v.head) * k;
      v.tail += (tailTarget - v.tail) * k;
      v.rev += ((state.reverse ? 1 : 0) - v.rev) * k;

      apply(headSprites, v.head, 0.85);
      apply(tailSprites, v.tail, 0.9, 0.7);
      apply(revSprites, v.rev, 0.9);

      for (const mat of tailMats) mat.emissiveIntensity = v.tail * 2.5;
      if (spot) spot.intensity = v.head * beamIntensity;
    }
  };
}
