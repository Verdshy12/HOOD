// src/car/carRig.js — scale/orient the model and give each wheel a steer+spin pivot at its true centre.
import * as THREE from 'three';

// Supports optimized wheel names, X-Trail wheel parts, and the Skyline's merged wheel geometry.
const WHEEL_NAMES = {
  // Nissan X-Trail wheel meshes, named by the source GLB export.
  FL: /^(Wheel_FL|3DWheel Front L|Object_280|Object_250)$/i,
  FR: /^(Wheel_FR|3DWheel Front R|Object_298|Object_244)$/i,
  RL: /^(Wheel_RL|3DWheel Rear L|Object_271|Object_247)$/i,
  RR: /^(Wheel_RR|3DWheel Rear R|Object_289|Object_241)$/i,
};

const WHEEL_PARTS = {
  FL: new Set(['Object_235', 'Object_301', 'Object_298', 'Object_232', 'Object_238']),
  FR: new Set(['Object_217', 'Object_283', 'Object_280', 'Object_214', 'Object_220']),
  RL: new Set(['Object_226', 'Object_292', 'Object_289', 'Object_223', 'Object_229']),
  RR: new Set(['Object_208', 'Object_274', 'Object_271', 'Object_205', 'Object_211']),
};
const XTRAIL_RIM_PARTS = new Set([
  'Object_235', 'Object_232', 'Object_238',
  'Object_217', 'Object_214', 'Object_220',
  'Object_226', 'Object_223', 'Object_229',
  'Object_208', 'Object_205', 'Object_211',
]);
const XTRAIL_WHEEL_ANCHORS = {
  FL: 'Object_250',
  FR: 'Object_244',
  RL: 'Object_247',
  RR: 'Object_241',
};

const SKYLINE_WHEEL_MESHES = new Set(['Object_13', 'Object_14']);

function finishXtrailRims(modelScene) {
  modelScene.traverse((object) => {
    if (!object.isMesh || !XTRAIL_RIM_PARTS.has(object.name)) return;
    const finish = (material) => {
      const rim = material.clone();
      rim.color.set(0xc7cdd2);
      if (rim.isMeshStandardMaterial) {
        rim.metalness = 0.68;
        rim.roughness = 0.3;
      }
      if (rim.isMeshPhysicalMaterial) {
        rim.clearcoat = 0.25;
        rim.clearcoatRoughness = 0.22;
      }
      rim.needsUpdate = true;
      return rim;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(finish)
      : finish(object.material);
  });
}

function connectedComponents(mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (!index) return [];

  const parents = new Int32Array(position.count);
  for (let i = 0; i < parents.length; i++) parents[i] = i;
  const find = (value) => {
    while (parents[value] !== value) {
      parents[value] = parents[parents[value]];
      value = parents[value];
    }
    return value;
  };
  const join = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parents[b] = a;
  };

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    join(a, b); join(a, c);
  }

  const components = new Map();
  for (let i = 0; i < index.count; i += 3) {
    const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const id = find(indices[0]);
    let component = components.get(id);
    if (!component) {
      component = { indices: [], materials: [], worldBounds: new THREE.Box3() };
      components.set(id, component);
    }
    const materialIndex = geometry.groups.find((group) => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
    component.indices.push(...indices);
    component.materials.push(materialIndex);
    for (const vertex of indices) {
      const local = new THREE.Vector3().fromBufferAttribute(position, vertex);
      component.worldBounds.expandByPoint(local.applyMatrix4(mesh.matrixWorld));
    }
  }
  return [...components.values()];
}

function setTriangleGroups(geometry, materials) {
  geometry.clearGroups();
  if (!materials.length) return;
  let start = 0;
  for (let i = 1; i <= materials.length; i++) {
    if (i < materials.length && materials[i] === materials[start]) continue;
    geometry.addGroup(start * 3, (i - start) * 3, materials[start]);
    start = i;
  }
}

function useTriangleSubset(source, indices, materials) {
  const original = source.geometry;
  const usedVertices = [...new Set(indices)];
  const vertexIndices = new Map(usedVertices.map((vertex, i) => [vertex, i]));
  const subsetAttribute = (attribute) => {
    const values = new attribute.array.constructor(usedVertices.length * attribute.itemSize);
    for (let i = 0; i < usedVertices.length; i++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values[i * attribute.itemSize + component] = attribute.getComponent(usedVertices[i], component);
      }
    }
    return new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
  };
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(original.attributes)) {
    geometry.setAttribute(name, subsetAttribute(attribute));
  }
  for (const [name, attributes] of Object.entries(original.morphAttributes)) {
    geometry.morphAttributes[name] = attributes.map(subsetAttribute);
  }
  geometry.morphTargetsRelative = original.morphTargetsRelative;
  geometry.setIndex(indices.map((vertex) => vertexIndices.get(vertex)));
  setTriangleGroups(geometry, materials);
  geometry.computeBoundingBox();
  geometry.boundingSphere = geometry.boundingBox
    ? geometry.boundingBox.getBoundingSphere(new THREE.Sphere())
    : null;
  return geometry;
}

function splitSkylineWheels(modelScene, root) {
  const sourceMeshes = [];
  modelScene.traverse((object) => {
    if (object.isMesh && SKYLINE_WHEEL_MESHES.has(object.name)) sourceMeshes.push(object);
  });
  if (sourceMeshes.length !== SKYLINE_WHEEL_MESHES.size) return null;

  const componentsByMesh = new Map(sourceMeshes.map((mesh) => [mesh, connectedComponents(mesh)]));
  const tireMesh = sourceMeshes.find((mesh) => mesh.name === 'Object_14');
  const centers = Object.fromEntries(Object.keys(WHEEL_NAMES).map((key) => [key, new THREE.Box3()]));

  for (const component of componentsByMesh.get(tireMesh)) {
    const size = component.worldBounds.getSize(new THREE.Vector3());
    const center = component.worldBounds.getCenter(new THREE.Vector3());
    if (size.y < 0.45 || size.y > 0.58 || size.z < 0.42 || size.z > 0.56) continue;
    const key = center.z < 0
      ? (center.x < 0 ? 'FL' : 'FR')
      : (center.x < 0 ? 'RL' : 'RR');
    centers[key].union(component.worldBounds);
  }
  if (Object.values(centers).some((bounds) => bounds.isEmpty())) return null;

  const parts = Object.fromEntries(Object.keys(WHEEL_NAMES).map((key) => [key, []]));
  for (const [mesh, components] of componentsByMesh) {
    const remainingIndices = [];
    const remainingMaterials = [];
    for (const component of components) {
      const componentCenter = component.worldBounds.getCenter(new THREE.Vector3());
      const key = Object.keys(centers).reduce((nearest, candidate) =>
        componentCenter.distanceTo(centers[candidate].getCenter(new THREE.Vector3())) <
          componentCenter.distanceTo(centers[nearest].getCenter(new THREE.Vector3())) ? candidate : nearest);
      const wheelCenter = centers[key].getCenter(new THREE.Vector3());
      if (componentCenter.distanceTo(wheelCenter) > 0.45) {
        remainingIndices.push(...component.indices);
        remainingMaterials.push(...component.materials);
        continue;
      }

      const part = mesh.clone(false);
      part.geometry = useTriangleSubset(mesh, component.indices, component.materials);
      mesh.matrixWorld.decompose(part.position, part.quaternion, part.scale);
      part.updateMatrix();
      root.updateMatrixWorld(true);
      parts[key].push(part);
    }
    mesh.geometry = useTriangleSubset(mesh, remainingIndices, remainingMaterials);
    mesh.visible = remainingIndices.length > 0;
  }

  return { centers, parts };
}

export function rigCar(modelScene, {
  targetLength = 5.02,
  headingOffset = Math.PI,
  wheelLayout
} = {}) {
  const root = new THREE.Group(); root.name = 'carRoot';       // add this to your player rig
  root.add(modelScene);

  // 1) scale to real-world length, face -Z, centre on the origin, sit on y=0
  const raw = new THREE.Box3().setFromObject(modelScene).getSize(new THREE.Vector3());
  modelScene.scale.setScalar(targetLength / Math.max(raw.x, raw.y, raw.z));
  modelScene.rotation.y = headingOffset; modelScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelScene), ctr = box.getCenter(new THREE.Vector3());
  modelScene.position.set(-ctr.x, -box.min.y, -ctr.z); root.updateMatrixWorld(true);

  // Some exports combine all four tires and rims into disconnected pieces of a few large meshes.
  const splitWheels = wheelLayout === 'skyline-r34' ? splitSkylineWheels(modelScene, root) : null;

  // 2) find wheel anchors by exact name; keep each model's separate rim and hub meshes with its tire.
  const xtrail = Object.values(XTRAIL_WHEEL_ANCHORS).every((name) => {
    let found = false;
    modelScene.traverse((object) => { if (object.isMesh && object.name === name) found = true; });
    return found;
  });
  const anchorNames = xtrail
    ? Object.fromEntries(Object.entries(XTRAIL_WHEEL_ANCHORS).map(([key, name]) => [key, new RegExp('^' + name + '$')]))
    : WHEEL_NAMES;
  const found = {};
  modelScene.traverse((o) => {
    for (const [k, re] of Object.entries(anchorNames)) {
      if (!found[k] && re.test(o.name)) {
        found[k] = { anchor: o, parts: [o] };
      }
    }
  });
  if (xtrail) {
    modelScene.traverse((object) => {
      for (const [key, names] of Object.entries(WHEEL_PARTS)) {
        if (names.has(object.name)) found[key].parts.push(object);
      }
    });
    finishXtrailRims(modelScene);
  }
  for (const [key, wheel] of Object.entries(found)) wheel.anchor.name = 'wheel_' + key;
  if (splitWheels) {
    for (const key of Object.keys(WHEEL_NAMES)) {
      found[key] = { center: splitWheels.centers[key].getCenter(new THREE.Vector3()), parts: splitWheels.parts[key] };
    }
  }
  const missing = Object.keys(WHEEL_NAMES).filter((k) => !found[k]);
  if (missing.length) console.warn('[carRig] wheels not found:', missing.join(','), '— car will drive without wheel animation');

  // 3) pivot chain per wheel: steer (Y) -> spin (X). Pivot sits at the wheel's world bounding-box centre, so it rotates about its axle.
  const wheels = {};
  for (const [k, wheel] of Object.entries(found)) {
    const centre = wheel.center || new THREE.Box3().setFromObject(wheel.anchor).getCenter(new THREE.Vector3());
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.name = 'steer_' + k; spin.name = 'spin_' + k;
    root.add(steer); steer.add(spin); steer.position.copy(root.worldToLocal(centre));
    root.updateMatrixWorld(true);
    for (const part of wheel.parts) spin.attach(part);            // attach() keeps the world transform
    wheels[k] = { steer, spin, centre: steer.position.clone(), parts: wheel.parts };
  }

  // 4) materials: kill any leftover transmission (costly render pass) on un-optimized models
  modelScene.traverse((o) => { if (!o.isMesh) return; o.castShadow = o.receiveShadow = false;
    for (const m of [].concat(o.material)) if (m?.isMeshPhysicalMaterial && m.transmission > 0) { m.transmission = 0; m.needsUpdate = true; } });

  return {
    root, wheels, ok: missing.length === 0,
    /** call every frame with vehicle outputs: steerAngle (rad, + = right turn), spinAngle (rad, accumulated) */
    update(steerAngle, spinAngle) {
      for (const k of ['FL', 'FR']) if (wheels[k]) wheels[k].steer.rotation.y = -steerAngle;   // +y rotation turns left, so negate
      for (const w of Object.values(wheels)) w.spin.rotation.x = spinAngle;                      // axle = X (car's lateral axis)
    },
  };
}
