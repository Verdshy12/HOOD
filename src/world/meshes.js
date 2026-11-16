// src/world/meshes.js — turns a tile into 2 merged meshes (roads, buildings) = 2 draw calls total.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_COLOR = [0x292c30, 0x2c2f33, 0x303338, 0x33363a, 0x36393d, 0x393c40, 0x3c3f43];   // by rank: busier = slightly lighter
const BUILDING_COLORS = [0xb8b2a4, 0xc8c0ad, 0xaaa9a1, 0xd1c7b5, 0x8f999a];
const MURRAM_COLOR = 0x716447;
const PAVED_COLOR = 0x52575a;
const POLICE_WHITE = new THREE.MeshStandardMaterial({ color: 0xe7e9e9, roughness: 0.7 });
const POLICE_BLACK = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.8 });
const POLICE_BLUE = new THREE.MeshStandardMaterial({ color: 0x115e9a, roughness: 0.65 });
const POLICE_GLASS = new THREE.MeshStandardMaterial({ color: 0x172b38, roughness: 0.35, metalness: 0.1 });
const POLICE_RED = new THREE.MeshStandardMaterial({ color: 0xd52f39, roughness: 0.6 });
const BARRIER_RED = new THREE.MeshStandardMaterial({ color: 0xd92d25, roughness: 0.8 });
const BARRIER_WHITE = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.8 });
const BARRIER_POST = new THREE.MeshStandardMaterial({ color: 0xffb52e, roughness: 0.8 });

function box(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
  mesh.position.set(x, y, z);
  mesh.userData.material = material;
  return mesh;
}

function mergedMesh(parts, material) {
  for (const part of parts) {
    part.updateMatrix();
    part.geometry.applyMatrix4(part.matrix);
  }
  const geometry = mergeGeometries(parts.map((part) => part.geometry), false);
  for (const part of parts) part.geometry.dispose();
  return new THREE.Mesh(geometry, material);
}

function addPoliceCar(parent) {
  const car = new THREE.Group();
  car.position.z = 3.8;
  const partsByMaterial = new Map();
  const addPart = (part) => {
    const parts = partsByMaterial.get(part.userData.material) || [];
    parts.push(part);
    partsByMaterial.set(part.userData.material, parts);
  };
  addPart(box(2.05, 0.65, 4.4, POLICE_WHITE, 0, 0.65, 0));
  addPart(box(1.75, 0.14, 1.35, POLICE_BLUE, 0, 0.94, 0.35));
  addPart(box(1.68, 0.62, 2.1, POLICE_GLASS, 0, 1.13, -0.1));
  addPart(box(1.83, 0.16, 1.05, POLICE_WHITE, 0, 1.47, -0.08));
  addPart(box(0.35, 0.15, 0.4, POLICE_RED, -0.28, 1.57, -0.1));
  addPart(box(0.35, 0.15, 0.4, POLICE_BLUE, 0.28, 1.57, -0.1));

  for (const x of [-1.03, 1.03]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.24, 10)
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.38, z);
      wheel.userData.material = POLICE_BLACK;
      addPart(wheel);
    }
  }
  for (const x of [-1.045, 1.045]) {
    addPart(box(0.08, 0.22, 2.6, POLICE_BLUE, x, 0.72, 0));
  }
  for (const [material, parts] of partsByMaterial) car.add(mergedMesh(parts, material));
  parent.add(car);
}

/** Place marked police cars and full-width road gates at route-defined closed junctions. */
export function buildRouteBarricades(route, { cell } = {}) {
  if (!route.barricades?.length) return null;

  const barricades = new THREE.Group();

  for (const definition of route.barricades) {
    const { x, z, roadHeading, width } = definition;
    if (cell && (
      Math.floor(x / 128) !== cell[0] ||
      Math.floor(z / 128) !== cell[1]
    )) continue;
    const gate = new THREE.Group();
    gate.position.set(x, 0, z);
    gate.rotation.y = -roadHeading;

    const stripeCount = Math.ceil(width / 0.9);
    const stripeWidth = width / stripeCount;
    const stripes = new Map([[BARRIER_RED, []], [BARRIER_WHITE, []]]);
    for (let i = 0; i < stripeCount; i++) {
      const material = i % 2 ? BARRIER_RED : BARRIER_WHITE;
      stripes.get(material).push(box(
        stripeWidth * 0.82,
        0.42,
        0.3,
        material,
        -width / 2 + stripeWidth * (i + 0.5),
        0.8,
        0
      ));
    }
    for (const [material, parts] of stripes) gate.add(mergedMesh(parts, material));

    const posts = [];
    for (const xOffset of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 8));
      post.position.set(xOffset, 0.45, 0);
      post.userData.material = BARRIER_POST;
      posts.push(post);
    }
    gate.add(mergedMesh(posts, BARRIER_POST));

    addPoliceCar(gate);
    barricades.add(gate);
  }

  return barricades.children.length ? barricades : null;
}

/** Roads: one quad per segment + a small disc at each joint (fills bend gaps, can never fold over like a mitered ribbon).
 *  Tiny y-offset per rank so crossing roads never z-fight. Whole network = 1 mesh. */

/**
 * Builds the road network in three material groups:
 * - Selected route: asphalt texture
 * - Kinyanjui Street: murram texture
 * - Remaining network: original vertex-colour appearance
 *
 * Route membership is detected against the selected route centreline.
 */
export function buildRoadMesh(roads, options = {}) {
  const { route, asphaltTexture, murramTexture } = options;

  const RING = 8;
  const buckets = {
    base: { pos: [], col: [], uv: [], idx: [] },
    asphalt: { pos: [], col: [], uv: [], idx: [] },
    murram: { pos: [], col: [], uv: [], idx: [] }
  };

  const routePoints = route?.path?.pts || [];
  const routeSegments = [];

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    routeSegments.push([a.x, a.z, b.x, b.z]);
  }

  const distanceToRoute = (x, z) => {
    let best = Infinity;

    for (const [ax, az, bx, bz] of routeSegments) {
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;

      if (len2 < 0.0001) continue;

      const t = Math.max(0, Math.min(1,
        ((x - ax) * dx + (z - az) * dz) / len2
      ));

      const px = ax + t * dx;
      const pz = az + t * dz;
      best = Math.min(best, Math.hypot(x - px, z - pz));

      if (best < 0.5) break;
    }

    return best;
  };

  const belongsToSelectedRoute = (road) => {
    if (routeSegments.length === 0 || !road.pts?.length) return false;

    const count = road.pts.length / 2;
    let matches = 0;
    let samples = 0;
    const tolerance = Math.max(road.w / 2 + 2.5, 5.5);

    // Sample road vertices and segment midpoints.
    for (let i = 0; i < count; i++) {
      const x = road.pts[i * 2];
      const z = road.pts[i * 2 + 1];

      if (distanceToRoute(x, z) <= tolerance) matches++;
      samples++;

      if (i < count - 1) {
        const mx = (x + road.pts[(i + 1) * 2]) / 2;
        const mz = (z + road.pts[(i + 1) * 2 + 1]) / 2;

        if (distanceToRoute(mx, mz) <= tolerance) matches++;
        samples++;
      }
    }

    return samples > 0 && matches / samples >= 0.65;
  };

  const addVertex = (bucket, x, z, y, color) => {
    const index = bucket.pos.length / 3;
    bucket.pos.push(x, y, z);
    bucket.col.push(color.r, color.g, color.b);
    bucket.uv.push(x / 4, z / 4);
    return index;
  };

  const color = new THREE.Color();

  for (const road of roads) {
    if (!road.pts || road.pts.length < 4) continue;

    const count = road.pts.length / 2;
    const isKinyanjui = String(road.id) === '4821502';
    const isMurram = isKinyanjui;
    const isSelectedAsphalt =
      !isMurram && belongsToSelectedRoute(road);
    const halfWidth = road.w / 2 + (isSelectedAsphalt ? 0.8 : 0);
    const y = 0.02 + (road.rank || 0) * 0.004 + (isSelectedAsphalt ? 0.003 : 0);

    const bucket = isMurram
      ? buckets.murram
      : isSelectedAsphalt
        ? buckets.asphalt
        : buckets.base;

    if (isMurram) {
      color.setHex(0xffffff);
    } else if (isSelectedAsphalt) {
      color.setHex(0xffffff);
    } else {
      const surfaceColor = ['murram', 'dirt', 'ground', 'unpaved', 'gravel'].includes(road.surface)
        ? 0x716447
        : ['paving_stones', 'sett', 'concrete', 'concrete:plates'].includes(road.surface)
          ? 0x52575a
          : (ROAD_COLOR[road.rank] ?? ROAD_COLOR[0]);

      color.setHex(surfaceColor);
    }

    const vertex = (x, z) => addVertex(bucket, x, z, y, color);

    for (let i = 0; i < count - 1; i++) {
      const ax = road.pts[i * 2];
      const az = road.pts[i * 2 + 1];
      const bx = road.pts[i * 2 + 2];
      const bz = road.pts[i * 2 + 3];

      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;

      const nx = (-dz / length) * halfWidth;
      const nz = (dx / length) * halfWidth;

      const leftA = vertex(ax + nx, az + nz);
      const rightA = vertex(ax - nx, az - nz);
      const leftB = vertex(bx + nx, bz + nz);
      const rightB = vertex(bx - nx, bz - nz);

      bucket.idx.push(
        leftA, leftB, rightA,
        rightA, leftB, rightB
      );
    }

    // Fill bends with small discs, matching the road's assigned material.
    for (let i = 1; i < count - 1; i++) {
      const cx = road.pts[i * 2];
      const cz = road.pts[i * 2 + 1];
      const centre = vertex(cx, cz);
      const ring = [];

      for (let k = 0; k < RING; k++) {
        const angle = (k / RING) * Math.PI * 2;
        ring.push(vertex(
          cx + Math.cos(angle) * halfWidth,
          cz + Math.sin(angle) * halfWidth
        ));
      }

      for (let k = 0; k < RING; k++) {
        bucket.idx.push(
          centre,
          ring[(k + 1) % RING],
          ring[k]
        );
      }
    }
  }


  // Merge all road surfaces into one mesh while retaining
  // separate materials for default roads, selected-route asphalt
  // and the designated Kinyanjui murram section.
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const materialGroups = [];

  const materialDefinitions = [
    {
      bucket: buckets.base,
      material: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.98,
        metalness: 0
      })
    },
    {
      bucket: buckets.asphalt,
      material: new THREE.MeshStandardMaterial({
        map: asphaltTexture || null,
        color: asphaltTexture ? 0xffffff : 0x303338,
        roughness: 0.96,
        metalness: 0
      })
    },
    {
      bucket: buckets.murram,
      material: new THREE.MeshStandardMaterial({
        map: murramTexture || null,
        color: murramTexture ? 0xffffff : 0x716447,
        roughness: 1,
        metalness: 0
      })
    }
  ];

  let vertexOffset = 0;
  let indexOffset = 0;

  for (let materialIndex = 0; materialIndex < materialDefinitions.length; materialIndex++) {
    const { bucket } = materialDefinitions[materialIndex];

    if (!bucket.pos.length || !bucket.idx.length) continue;

    for (const value of bucket.pos) positions.push(value);
    for (const value of bucket.col) colors.push(value);
    for (const value of bucket.uv) uvs.push(value);

    for (const index of bucket.idx) {
      indices.push(index + vertexOffset);
    }

    materialGroups.push({
      start: indexOffset,
      count: bucket.idx.length,
      materialIndex
    });

    vertexOffset += bucket.pos.length / 3;
    indexOffset += bucket.idx.length;
  }

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(colors, 3)
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(uvs, 2)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  for (const group of materialGroups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }

  const roadMesh = new THREE.Mesh(
    geometry,
    materialDefinitions.map((definition) => definition.material)
  );

  roadMesh.name = 'HOOD_RoadNetwork';
  return roadMesh;

}

/** Real footprints extruded to height, merged into ONE geometry with per-building vertex colour. */
export function buildBuildingMesh(buildings) {
  const geos = []; const c = new THREE.Color();
  for (const b of buildings) {
    try {
      const shape = new THREE.Shape(); const p = b.pts;
      shape.moveTo(p[0], -p[1]); for (let i = 2; i < p.length; i += 2) shape.lineTo(p[i], -p[i + 1]);   // shape-y = -world-z
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);                                                  // extrusion axis -> +Y (up)
      g.deleteAttribute('uv');
      c.setHex(BUILDING_COLORS[b.id % BUILDING_COLORS.length]);
      const colors = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geos.push(g);
    } catch (e) { console.warn('skip building', b.id, e.message); }
  }
  const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}

/** Painted centre-line dashes along a route. One merged mesh = 1 draw call. */
export function buildRouteMarkings(route, { cell } = {}) {
  const pos = [], col = [], idx = []; const P = route.path.pts, y = 0.055, hw = 0.075, DASH = 3.5, GAP = 5.5;
  const quad = (ax, az, bx, bz, w, yy, c) => {
    const l = Math.hypot(bx - ax, bz - az); if (l < 0.01) return;
    const nx = (-(bz - az) / l) * w, nz = ((bx - ax) / l) * w, b = pos.length / 3;
    for (const [px, pz] of [[ax + nx, az + nz], [ax - nx, az - nz], [bx + nx, bz + nz], [bx - nx, bz - nz]]) { pos.push(px, yy, pz); col.push(c.r, c.g, c.b); }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  const paint = new THREE.Color(0xf5f2e8); let s = GAP / 2;
  for (let i = 0; i < P.length - 1; i++) {                                   // dashes follow the resampled route (2 m steps)
    const a = P[i], b = P[i + 1];
    if (s >= DASH + GAP) s -= DASH + GAP;
    const midpointX = (a.x + b.x) / 2;
    const midpointZ = (a.z + b.z) / 2;
    const inCell = !cell ||
      (Math.floor(midpointX / 128) === cell[0] && Math.floor(midpointZ / 128) === cell[1]);
    if (inCell && s < DASH) quad(a.x, a.z, b.x, b.z, hw, y, paint);
    s += route.path.step;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
}

export function buildFinishGate(route) {
  const finish = route.path.pts[route.path.pts.length - 1];
  const roadWidth = route.w || 12;
  const span = roadWidth + 4;
  const halfSpan = span / 2;
  const frame = new THREE.MeshStandardMaterial({ color: 0x16a8b5, metalness: 0.42, roughness: 0.5 });
  const support = new THREE.MeshStandardMaterial({ color: 0xf3b632, metalness: 0.12, roughness: 0.66 });
  const truss = new THREE.MeshStandardMaterial({ color: 0x26343b, metalness: 0.22, roughness: 0.7 });
  const banner = new THREE.MeshStandardMaterial({ color: 0x111a20, metalness: 0.15, roughness: 0.58 });
  const partsByMaterial = new Map();
  const gate = new THREE.Group();
  gate.name = 'HOOD_FinishGate';
  gate.position.set(finish.x, 0, finish.z);
  gate.rotation.y = -finish.psi;

  const addPart = (part) => {
    const parts = partsByMaterial.get(part.userData.material) || [];
    parts.push(part);
    partsByMaterial.set(part.userData.material, parts);
  };
  const addBeam = (startX, startY, endX, endY, z, thickness, material) => {
    const dx = endX - startX;
    const dy = endY - startY;
    const beam = box(
      Math.hypot(dx, dy),
      thickness,
      0.16,
      material,
      (startX + endX) / 2,
      (startY + endY) / 2,
      z
    );
    beam.rotation.z = Math.atan2(dy, dx);
    addPart(beam);
  };

  for (const x of [-halfSpan, halfSpan]) {
    addPart(box(0.52, 5.6, 0.62, support, x, 2.8, 0));
  }
  addPart(box(span + 0.8, 0.36, 1.15, frame, 0, 5.75, 0));
  addPart(box(span, 0.2, 0.62, support, 0, 4.65, 0));
  addPart(box(span * 0.48, 0.82, 0.22, banner, 0, 3.95, 0.42));

  const trussBottom = 4.78;
  const trussTop = 5.55;
  const bayCount = Math.max(4, Math.floor(span / 2));
  for (const z of [-0.48, 0.48]) {
    for (let bay = 0; bay <= bayCount; bay++) {
      const x = -halfSpan + span * bay / bayCount;
      addBeam(x, trussBottom, x, trussTop, z, 0.09, truss);
    }
    for (let bay = 0; bay < bayCount; bay++) {
      const x0 = -halfSpan + span * bay / bayCount;
      const x1 = -halfSpan + span * (bay + 1) / bayCount;
      if (bay % 2 === 0) {
        addBeam(x0, trussBottom, x1, trussTop, z, 0.07, support);
      } else {
        addBeam(x0, trussTop, x1, trussBottom, z, 0.07, support);
      }
    }
  }

  for (const [index, [material, parts]] of [...partsByMaterial].entries()) {
    const merged = mergedMesh(parts, material);
    merged.name = `FinishBridgePart_${index}`;
    gate.add(merged);
  }

  const stripeWidth = roadWidth + 0.5;
  const columns = 16;
  const rows = 2;
  const positions = [];
  const colors = [];
  const indices = [];
  const light = new THREE.Color(0xf3eee2);
  const dark = new THREE.Color(0x171d21);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x0 = -stripeWidth / 2 + stripeWidth * column / columns;
      const x1 = -stripeWidth / 2 + stripeWidth * (column + 1) / columns;
      const z0 = -0.7 + 1.4 * row / rows;
      const z1 = -0.7 + 1.4 * (row + 1) / rows;
      const vertex = positions.length / 3;
      positions.push(x0, 0.075, z0, x1, 0.075, z0, x0, 0.075, z1, x1, 0.075, z1);
      const color = (row + column) % 2 ? dark : light;
      for (let i = 0; i < 4; i++) colors.push(color.r, color.g, color.b);
      indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
    }
  }
  const checkerGeometry = new THREE.BufferGeometry();
  checkerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  checkerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  checkerGeometry.setIndex(indices);
  checkerGeometry.computeVertexNormals();
  const checkerLine = new THREE.Mesh(
    checkerGeometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })
  );
  checkerLine.name = 'FinishCheckerLine';
  gate.add(checkerLine);

  return gate;
}
