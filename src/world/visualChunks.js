import * as THREE from 'three';
import { buildBuildingMesh, buildRoadMesh, buildRouteBarricades, buildRouteMarkings } from './meshes.js';

export const WORLD_CHUNK_SIZE = 128;
const LOAD_RADIUS = 300;
const UNLOAD_RADIUS = 400;

const cellKey = ([x, z]) => `${x},${z}`;
const cellAt = (x, z) => [
  Math.floor(x / WORLD_CHUNK_SIZE),
  Math.floor(z / WORLD_CHUNK_SIZE)
];

function distanceToCell(x, z, [cellX, cellZ]) {
  const minX = cellX * WORLD_CHUNK_SIZE;
  const minZ = cellZ * WORLD_CHUNK_SIZE;
  const nearestX = THREE.MathUtils.clamp(x, minX, minX + WORLD_CHUNK_SIZE);
  const nearestZ = THREE.MathUtils.clamp(z, minZ, minZ + WORLD_CHUNK_SIZE);
  return Math.hypot(x - nearestX, z - nearestZ);
}

export class WorldVisualChunks {
  constructor(tile, { route = null, barricades = [] } = {}) {
    this.roads = new Map();
    this.buildings = new Map();
    this.routeCells = new Set();
    this.route = route;
    this.routeWithBarricades = route ? { ...route, barricades } : null;

    for (const road of tile.roads) {
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        const x1 = road.pts[i];
        const z1 = road.pts[i + 1];
        const x2 = road.pts[i + 2];
        const z2 = road.pts[i + 3];
        const cell = cellAt((x1 + x2) / 2, (z1 + z2) / 2);
        const key = cellKey(cell);
        const chunkRoads = this.roads.get(key) || [];
        chunkRoads.push({ ...road, pts: [x1, z1, x2, z2] });
        this.roads.set(key, chunkRoads);
      }
    }

    for (const building of tile.buildings) {
      const count = building.pts.length / 2;
      if (count < 3) continue;

      let centerX = 0;
      let centerZ = 0;
      for (let i = 0; i < building.pts.length; i += 2) {
        centerX += building.pts[i];
        centerZ += building.pts[i + 1];
      }

      const key = cellKey(cellAt(centerX / count, centerZ / count));
      const chunkBuildings = this.buildings.get(key) || [];
      chunkBuildings.push(building);
      this.buildings.set(key, chunkBuildings);
    }

    for (let i = 0; i + 1 < (route?.path?.pts.length || 0); i++) {
      const a = route.path.pts[i];
      const b = route.path.pts[i + 1];
      this.routeCells.add(cellKey(cellAt((a.x + b.x) / 2, (a.z + b.z) / 2)));
    }

    for (const barricade of barricades) {
      this.routeCells.add(cellKey(cellAt(barricade.x, barricade.z)));
    }
  }

  cellsNear(x, z, radius) {
    const minCell = cellAt(x - radius, z - radius);
    const maxCell = cellAt(x + radius, z + radius);
    const cells = [];

    for (let cellX = minCell[0]; cellX <= maxCell[0]; cellX++) {
      for (let cellZ = minCell[1]; cellZ <= maxCell[1]; cellZ++) {
        const cell = [cellX, cellZ];
        const key = cellKey(cell);
        if (
          (this.roads.has(key) || this.buildings.has(key) || this.routeCells.has(key)) &&
          distanceToCell(x, z, cell) <= radius
        ) {
          cells.push(cell);
        }
      }
    }

    return cells;
  }

  buildChunk(cell, roadOptions) {
    const key = cellKey(cell);
    const meshes = [];
    const roads = this.roads.get(key);
    const buildings = this.buildings.get(key);

    if (roads?.length) meshes.push(buildRoadMesh(roads, roadOptions));
    if (buildings?.length) meshes.push(buildBuildingMesh(buildings));
    if (this.route) {
      const markings = buildRouteMarkings(this.route, { cell });
      if (markings) meshes.push(markings);
    }
    if (this.routeWithBarricades?.barricades.length) {
      const barricades = buildRouteBarricades(this.routeWithBarricades, { cell });
      if (barricades) meshes.push(barricades);
    }
    return meshes;
  }
}

function disposeMesh(mesh) {
  mesh.traverse((child) => {
    child.geometry?.dispose();
  });
  if (!mesh.isMesh) return;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material?.dispose();
  }
}

export class WorldVisualStream {
  constructor(scene, chunks, roadOptions = {}) {
    this.chunks = chunks;
    this.roadOptions = roadOptions;
    this.root = new THREE.Group();
    this.root.name = 'HOOD_StreamedWorld';
    this.loaded = new Map();
    scene.add(this.root);
  }

  update(x, z) {
    for (const [key, { cell, meshes }] of this.loaded) {
      if (distanceToCell(x, z, cell) <= UNLOAD_RADIUS) continue;
      for (const mesh of meshes) {
        this.root.remove(mesh);
        disposeMesh(mesh);
      }
      this.loaded.delete(key);
    }

    for (const cell of this.chunks.cellsNear(x, z, LOAD_RADIUS)) {
      const key = cellKey(cell);
      if (this.loaded.has(key)) continue;
      const meshes = this.chunks.buildChunk(cell, this.roadOptions);
      for (const mesh of meshes) this.root.add(mesh);
      this.loaded.set(key, { cell, meshes });
    }
  }

  dispose() {
    for (const { meshes } of this.loaded.values()) {
      for (const mesh of meshes) disposeMesh(mesh);
    }
    this.loaded.clear();
    this.root.parent?.remove(this.root);
  }
}
