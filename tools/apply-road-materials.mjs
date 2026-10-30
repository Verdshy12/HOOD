import fs from 'node:fs';

const meshFile = 'src/world/meshes.js';
const mainFile = 'src/main.js';

let meshes = fs.readFileSync(meshFile, 'utf8');
let main = fs.readFileSync(mainFile, 'utf8');

const start = meshes.indexOf('export function buildRoadMesh(roads)');
const end = meshes.indexOf('/** Real footprints', start);

if (start < 0 || end < 0) {
  throw new Error('Could not locate buildRoadMesh boundaries. No changes made.');
}

const replacement = String.raw`
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

  const group = new THREE.Group();
  group.name = 'HOOD_RoadNetwork';

  const makeGeometry = (bucket) => {
    if (bucket.pos.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(bucket.pos, 3)
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(bucket.col, 3)
    );
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(bucket.uv, 2)
    );
    geometry.setIndex(bucket.idx);
    geometry.computeVertexNormals();
    return geometry;
  };

  const baseGeometry = makeGeometry(buckets.base);
  if (baseGeometry) {
    group.add(new THREE.Mesh(
      baseGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.98,
        metalness: 0
      })
    ));
  }

  const asphaltGeometry = makeGeometry(buckets.asphalt);
  if (asphaltGeometry) {
    group.add(new THREE.Mesh(
      asphaltGeometry,
      new THREE.MeshStandardMaterial({
        map: asphaltTexture || null,
        color: asphaltTexture ? 0xffffff : 0x303338,
        roughness: 0.96,
        metalness: 0
      })
    ));
  }

  const murramGeometry = makeGeometry(buckets.murram);
  if (murramGeometry) {
    group.add(new THREE.Mesh(
      murramGeometry,
      new THREE.MeshStandardMaterial({
        map: murramTexture || null,
        color: murramTexture ? 0xffffff : 0x716447,
        roughness: 1,
        metalness: 0
      })
    ));
  }

  return group;
}

`;

meshes = meshes.slice(0, start) + replacement + meshes.slice(end);

// Pass the selected route and loaded textures into the mesh builder.
const oldCall = 'const roadMeshes = [buildRoadMesh(tile.roads), buildRouteMarkings(route)];';

if (!main.includes(oldCall)) {
  throw new Error('Could not find the expected road mesh call. meshes.js was changed; main.js was not.');
}

main = main.replace(
  oldCall,
  `const asphaltTexture = await new THREE.TextureLoader().loadAsync('./assets/Terrain/asphalt_track/textures/asphalt_track_diff_4k.jpg');
  const murramTexture = await new THREE.TextureLoader().loadAsync('./assets/Terrain/grass_ground/textures/grass_ground_diff_4k.jpg');

  for (const texture of [asphaltTexture, murramTexture]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    texture.needsUpdate = true;
  }

  const roadMeshes = [
    buildRoadMesh(tile.roads, { route, asphaltTexture, murramTexture }),
    buildRouteMarkings(route)
  ];`
);

fs.writeFileSync(meshFile, meshes);
fs.writeFileSync(mainFile, main);

console.log('Road material implementation applied.');
