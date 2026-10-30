// src/world/meshes.js — turns a tile into 2 merged meshes (roads, buildings) = 2 draw calls total.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_COLOR = [0x292c30, 0x2c2f33, 0x303338, 0x33363a, 0x36393d, 0x393c40, 0x3c3f43];   // by rank: busier = slightly lighter
const BUILDING_COLORS = [0xb8b2a4, 0xc8c0ad, 0xaaa9a1, 0xd1c7b5, 0x8f999a];
const MURRAM_COLOR = 0x716447;
const PAVED_COLOR = 0x52575a;

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
    const halfWidth = road.w / 2;
    const y = 0.02 + (road.rank || 0) * 0.004;

    const isKinyanjui = String(road.id) === '4821502';
    const isMurram = isKinyanjui;
    const isSelectedAsphalt =
      !isMurram && belongsToSelectedRoute(road);

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

    positions.push(...bucket.pos);
    colors.push(...bucket.col);
    uvs.push(...bucket.uv);

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

/** v1.2.2: painted centre-line dashes along a route + a coloured post at its start and end. One merged mesh = 1 draw call. */
export function buildRouteMarkings(route) {
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
    if (s < DASH) quad(a.x, a.z, b.x, b.z, hw, y, paint);
    s += route.path.step;
  }
  const post = (p, hex) => {                                                  // 1 m square, 14 m tall pillar so the ends are visible from afar
    const c = new THREE.Color(hex), b = pos.length / 3, r = 0.5;
    const ring = [[p.x - r, p.z - r], [p.x + r, p.z - r], [p.x + r, p.z + r], [p.x - r, p.z + r]];
    for (const [px, pz] of ring) { pos.push(px, 0.05, pz); col.push(c.r, c.g, c.b); }
    for (const [px, pz] of ring) { pos.push(px, 14, pz); col.push(c.r, c.g, c.b); }
    for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; idx.push(b + k, b + n, b + 4 + k, b + n, b + 4 + n, b + 4 + k, b + k, b + 4 + k, b + n, b + n, b + 4 + k, b + 4 + n); }
  };
  post(P[P.length - 1], 0xf05448);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
}
