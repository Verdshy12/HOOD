// src/car/steeringWheel.js — finds the steering wheel inside a car model and turns it with the steering input.
//
// Most downloaded models name everything "Object_123", so by default the wheel is found by POSITION:
// a ring-shaped mesh near where the driver's hands would be (derived from CONFIG.cars.<id>.cockpit).
// If the guess is wrong, name the meshes yourself in config.js:
//
//   steeringWheel: { meshes: ['Object_412', 'Object_413'], lock: 4.0, tilt: 25 }
//
//   meshes  mesh names that make up the wheel (rim, spokes, hub)
//   lock    wheel rotation at full steering lock, in radians (4.0 is about 230 degrees)
//   tilt    how far the column is tilted up from horizontal, in degrees
//   axis    [x, y, z] to override the column direction (car space, +z = towards the driver)
//   anchor  [x, y, z] to override where auto-detect looks
//   split   for models that merge the whole interior into ONE mesh (no separate wheel to find):
//           split: { center: [x, y, z], radius: 0.19, thickness: 0.14 }
//           cuts the triangles inside that disc out into their own mesh and rotates them.
//           Line the disc up with __hoodPreview([x, y, z], radius, thickness), then try it live
//           with __hoodSplit([x, y, z], radius, thickness) and undo with __hoodSplitUndo().
//   steeringWheel: false  disables it for that car

import * as THREE from 'three';

function isRoadWheelPart(o) {
  for (let p = o; p; p = p.parent) {
    if (/^(spin_|steer_|Wheel_|3DWheel)/i.test(p.name)) return true;
  }
  return false;
}

// Bounding box of `obj` in car (root) space.
function carBox(root, obj) {
  const wb = new THREE.Box3().setFromObject(obj);
  const a = root.worldToLocal(wb.min.clone());
  const b = root.worldToLocal(wb.max.clone());
  return new THREE.Box3().setFromPoints([a, b]);
}

function fmt(v) {
  return '[' + v.x.toFixed(2) + ', ' + v.y.toFixed(2) + ', ' + v.z.toFixed(2) + ']';
}

const STRICT = { radius: 0.6, big: [0.22, 0.55], mid: 0.16, thin: 0.3 };
const LOOSE  = { radius: 1.0, big: [0.18, 0.70], mid: 0.10, thin: 0.45 };

function findCandidates(root, anchor, lim) {
  const cands = [];
  root.traverse((o) => {
    if (!o.isMesh || isRoadWheelPart(o)) return;
    const box = carBox(root, o);
    const c = box.getCenter(new THREE.Vector3());
    const d = c.distanceTo(anchor);
    if (d > lim.radius) return;

    const size = box.getSize(new THREE.Vector3());
    const dims = [size.x, size.y, size.z].sort((p, q) => q - p);
    // Ring-like: two large, similar dimensions, one thin.
    if (dims[0] < lim.big[0] || dims[0] > lim.big[1] || dims[1] < lim.mid || dims[2] > lim.thin) return;

    cands.push({ o, c, d, dims });
  });
  return cands.sort((p, q) => p.d - q.d);
}

function describe(cands) {
  return cands.slice(0, 6).map((k, i) =>
    (i === 0 ? ' *' : '  ') + ' "' + k.o.name + '" at ' + fmt(k.c) +
    ' size ' + k.dims.map((n) => n.toFixed(2)).join('x') + ' (' + k.d.toFixed(2) + ' m away)').join('\n');
}

function cockpitAnchor(carCfg, opts) {
  const cp = carCfg.cockpit || [-0.4, 1.15, 0.15];
  // The wheel sits roughly 0.5 m ahead of and 0.2 m below the driver's eye point.
  return new THREE.Vector3(...(opts.anchor || [cp[0], cp[1] - 0.22, cp[2] - 0.55]));
}

function autoDetect(root, carCfg, opts) {
  const anchor = cockpitAnchor(carCfg, opts);
  const mirrored = new THREE.Vector3(-anchor.x, anchor.y, anchor.z);   // in case the model is left/right-hand drive the other way

  const passes = [
    ['strict', anchor, STRICT],
    ['loose', anchor, LOOSE],
    ['loose, other side of the car', mirrored, LOOSE]
  ];

  let cands = [];
  for (const [label, at, lim] of passes) {
    cands = findCandidates(root, at, lim);
    console.log('[HOOD] steering wheel (' + label + ') near ' + fmt(at) + ': ' + cands.length + ' candidate(s)' +
      (cands.length ? ':\n' + describe(cands) : ''));
    if (cands.length) break;
  }
  if (!cands.length) return [];

  // Take the best match plus tiny siblings (hub, spokes) that sit inside the wheel.
  const best = cands[0];
  const parts = [best.o];
  if (best.o.parent) {
    for (const sib of best.o.parent.children) {
      if (sib === best.o || !sib.isMesh || isRoadWheelPart(sib)) continue;
      const box = carBox(root, sib);
      const size = box.getSize(new THREE.Vector3());
      if (box.getCenter(new THREE.Vector3()).distanceTo(best.c) < 0.2 && Math.max(size.x, size.y, size.z) < 0.5) {
        parts.push(sib);
      }
    }
  }
  return parts;
}

// Debug helper: list every mesh near the driver's seat, whatever its shape.
// In the console:  __hoodScan()   or   __hoodScan(1.2)
export function scanNearby(root, carCfg, radius = 0.9) {
  root.updateMatrixWorld(true);
  const anchor = cockpitAnchor(carCfg, carCfg.steeringWheel || {});
  const rows = [];
  root.traverse((o) => {
    if (!o.isMesh || isRoadWheelPart(o)) return;
    const box = carBox(root, o);
    const c = box.getCenter(new THREE.Vector3());
    const d = c.distanceTo(anchor);
    if (d > radius) return;
    const sz = box.getSize(new THREE.Vector3());
    rows.push({ name: o.name, d, c, sz });
  });
  rows.sort((p, q) => p.d - q.d);
  console.log('[HOOD] meshes within ' + radius + ' m of ' + fmt(anchor) + ' (' + rows.length + '):\n' +
    rows.slice(0, 40).map((r) => '  "' + r.name + '" at ' + fmt(r.c) + ' size ' +
      r.sz.x.toFixed(2) + 'x' + r.sz.y.toFixed(2) + 'x' + r.sz.z.toFixed(2) + ' (' + r.d.toFixed(2) + ' m)').join('\n') +
    '\nBlink one with __hoodFlash("name") in the cockpit camera.');
}

function wheelAxis(o) {
  const tilt = THREE.MathUtils.degToRad(o.tilt ?? 25);
  return new THREE.Vector3(...(o.axis || [0, Math.sin(tilt), Math.cos(tilt)])).normalize();
}

// Some models merge the whole interior into one mesh. This cuts the triangles that fall inside a
// disc (centre, radius, thickness; aligned with the steering column) out into a mesh of their own.
function splitRegion(root, region, axis) {
  const center = new THREE.Vector3(...region.center);
  const radius = region.radius ?? 0.19;
  const half = (region.thickness ?? 0.14) / 2;

  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const reach = radius + half;
  const zone = new THREE.Box3(center.clone().subScalar(reach), center.clone().addScalar(reach));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let best = null;

  root.traverse((mesh) => {
    if (!mesh.isMesh || isRoadWheelPart(mesh) || mesh.name === 'steeringWheelPart') return;
    const g = mesh.geometry;
    const pos = g?.attributes?.position;
    if (!pos || Array.isArray(mesh.material) || (g.groups && g.groups.length > 1)) return;
    if (!carBox(root, mesh).intersectsBox(zone)) return;

    const toCar = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
    const triCount = (g.index ? g.index.count : pos.count) / 3;
    const hit = new Uint8Array(triCount);
    let n = 0;

    for (let t = 0; t < triCount; t++) {
      const i0 = g.index ? g.index.getX(3 * t) : 3 * t;
      const i1 = g.index ? g.index.getX(3 * t + 1) : 3 * t + 1;
      const i2 = g.index ? g.index.getX(3 * t + 2) : 3 * t + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(toCar).sub(center);

      const along = a.dot(axis);
      if (Math.abs(along) > half) continue;
      if (Math.sqrt(Math.max(0, a.lengthSq() - along * along)) > radius) continue;
      hit[t] = 1;
      n++;
    }
    if (n && (!best || n > best.n)) best = { mesh, hit, n, triCount };
  });

  if (!best) return null;

  const { mesh, hit, triCount } = best;
  const g = mesh.geometry;
  const vertexIndex = (t, k) => (g.index ? g.index.getX(3 * t + k) : 3 * t + k);

  const picked = [];
  const rest = [];
  for (let t = 0; t < triCount; t++) (hit[t] ? picked : rest).push(t);

  // New geometry holding only the picked triangles (non-indexed copy of every attribute).
  const wheelGeo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(picked.length * 3 * size);
    let w = 0;
    for (const t of picked) {
      for (let k = 0; k < 3; k++) {
        const vi = vertexIndex(t, k);
        arr[w++] = attr.getX(vi);
        if (size > 1) arr[w++] = attr.getY(vi);
        if (size > 2) arr[w++] = attr.getZ(vi);
        if (size > 3) arr[w++] = attr.getW(vi);
      }
    }
    wheelGeo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }

  // The source mesh keeps only the remaining triangles.
  const originalIndex = g.index;
  const idx = new Uint32Array(rest.length * 3);
  let w = 0;
  for (const t of rest) for (let k = 0; k < 3; k++) idx[w++] = vertexIndex(t, k);
  g.setIndex(new THREE.BufferAttribute(idx, 1));

  const wheelMesh = new THREE.Mesh(wheelGeo, mesh.material);
  wheelMesh.name = 'steeringWheelPart';
  wheelMesh.position.copy(mesh.position);
  wheelMesh.quaternion.copy(mesh.quaternion);
  wheelMesh.scale.copy(mesh.scale);
  mesh.parent.add(wheelMesh);

  console.log('[HOOD] steering wheel: cut ' + picked.length + ' of ' + triCount +
    ' triangles out of "' + mesh.name + '"');

  return {
    mesh: wheelMesh,
    undo() {
      wheelMesh.parent?.remove(wheelMesh);
      wheelGeo.dispose();
      g.setIndex(originalIndex);
    }
  };
}

export function rigSteeringWheel(root, carCfg) {
  const opts = carCfg.steeringWheel;
  if (opts === false) return null;
  const o = opts || {};
  const axis = wheelAxis(o);
  const lock = o.lock ?? 4.0;

  root.updateMatrixWorld(true);

  let parts = [];
  let undoSplit = null;

  if (o.split && o.split.center) {
    const res = splitRegion(root, o.split, axis);
    if (res) {
      parts = [res.mesh];
      undoSplit = res.undo;
    } else {
      console.warn('[HOOD] steering wheel: no triangles inside the split region. Check it with __hoodPreview().');
    }
  } else if (Array.isArray(o.meshes) && o.meshes.length) {
    parts = o.meshes.map((n) => root.getObjectByName(n)).filter(Boolean);
    const missing = o.meshes.filter((n) => !root.getObjectByName(n));
    if (missing.length) console.warn('[HOOD] steering wheel: meshes not found:', missing.join(', '));
  } else {
    parts = autoDetect(root, carCfg, o);
  }

  if (!parts.length) {
    console.warn('[HOOD] steering wheel not found for ' + (carCfg.name || 'this car') +
      '. Name it in config (steeringWheel: { meshes: [...] }) or, if the interior is one merged mesh, ' +
      'use steeringWheel: { split: { center: [x, y, z] } }. Run __hoodScan() to look around.');
    return null;
  }

  const originals = parts.map((p) => ({ p, parent: p.parent }));

  // Pivot at the middle of the wheel, so it spins about its own centre.
  const union = new THREE.Box3();
  for (const p of parts) union.union(carBox(root, p));

  const pivot = new THREE.Group();
  pivot.name = 'steeringWheelPivot';
  union.getCenter(pivot.position);
  root.add(pivot);
  root.updateMatrixWorld(true);
  for (const p of parts) pivot.attach(p);          // attach() keeps the world transform

  console.log('[HOOD] steering wheel rigged:', parts.map((p) => p.name).join(', '));

  return {
    parts,
    pivot,
    // steer: -1 (full left) .. +1 (full right). A right turn is clockwise as the driver sees it.
    update(steer) {
      pivot.quaternion.setFromAxisAngle(axis, -steer * lock);
    },
    // Put everything back the way it was (used by the console helpers).
    dispose() {
      if (undoSplit) undoSplit();
      else for (const { p, parent } of originals) parent.attach(p);
      root.remove(pivot);
    }
  };
}

// Debug helper: show the split region as a red disc, to line it up with the wheel (cockpit camera).
// In the console:  __hoodPreview([-0.42, 0.9, -0.4], 0.19, 0.14)     clear it with  __hoodPreview()
let previewMesh = null;
export function previewSplit(root, carCfg, center, radius = 0.19, thickness = 0.14) {
  if (previewMesh) {
    previewMesh.parent?.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh = null;
  }
  if (!center) return;

  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, thickness, 40),
    new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35, depthTest: false })
  );
  m.position.set(...center);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wheelAxis(carCfg.steeringWheel || {}));
  m.renderOrder = 999;
  root.add(m);
  previewMesh = m;
}

// Debug helper: blink a mesh so you can see which one it is (use the cockpit camera).
// In the console:  __hoodFlash('Object_412')
export function flashMesh(root, name) {
  const mesh = root.getObjectByName(name);
  if (!mesh) { console.warn('[HOOD] no mesh named', name); return; }
  let n = 0;
  const timer = setInterval(() => {
    mesh.visible = !mesh.visible;
    if (++n >= 10) { mesh.visible = true; clearInterval(timer); }
  }, 250);
}
