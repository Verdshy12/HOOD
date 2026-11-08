use crate::physics::Surface;
use bevy::{
    asset::RenderAssetUsages,
    prelude::*,
    render::mesh::{Indices, PrimitiveTopology},
};
use serde::Deserialize;
use std::collections::HashMap;

const ROUTES_JSON: &str = include_str!("../../../data/routes/all-routes.json");
const TILE_JSON: &str = include_str!("../../../data/tiles/ngara-sprint.json");
const MOMBASA_TILE_JSON: &str = include_str!("../../../data/tiles/mombasa.json");
const CELL_SIZE: f32 = 32.0;
const RENDER_CHUNK_SIZE: f32 = 128.0;

#[derive(Clone, Debug, Deserialize)]
pub struct RouteDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub tile: String,
    #[serde(default = "default_route_width")]
    pub w: f32,
    pub pts: Vec<f32>,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub circuit: bool,
    #[serde(default)]
    pub checkpoints: Vec<RouteCheckpoint>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RouteCheckpoint {
    pub name: String,
    pub x: f32,
    pub z: f32,
}

fn default_route_width() -> f32 {
    8.0
}

#[derive(Deserialize)]
struct RouteCatalog {
    routes: Vec<RouteDef>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Road {
    #[serde(default = "default_route_width")]
    pub w: f32,
    #[serde(default)]
    pub surface: Option<String>,
    pub pts: Vec<f32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Building {
    #[serde(default = "default_building_height")]
    pub h: f32,
    pub pts: Vec<f32>,
}

fn default_building_height() -> f32 {
    8.0
}

#[derive(Deserialize)]
struct TileData {
    roads: Vec<Road>,
    buildings: Vec<Building>,
}
#[derive(Resource, Default)]
pub struct WorldVisualChunks {
    roads: HashMap<(i32, i32), RoadSurfaceChunks>,
    buildings: HashMap<(i32, i32), Vec<Building>>,
}

#[derive(Default)]
struct RoadSurfaceChunks {
    asphalt: Vec<Road>,
    murram: Vec<Road>,
}

impl WorldVisualChunks {
    fn new(tile: &TileData) -> Self {
        let mut chunks = Self::default();

        // Split roads into individual segments so a long road can
        // belong to multiple chunks without being rendered repeatedly.
        for road in &tile.roads {
            for pair in road.pts.chunks_exact(2).collect::<Vec<_>>().windows(2) {
                let a = pair[0];
                let b = pair[1];
                let cell = render_cell((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);

                let chunk = chunks.roads.entry(cell).or_default();
                let surface_roads = if road.surface.as_deref() == Some("murram") {
                    &mut chunk.murram
                } else {
                    &mut chunk.asphalt
                };
                surface_roads.push(Road {
                    w: road.w,
                    surface: road.surface.clone(),
                    pts: vec![a[0], a[1], b[0], b[1]],
                });
            }
        }

        // Assign each building to the chunk containing its centroid.
        for building in &tile.buildings {
            let points = building.pts.chunks_exact(2).collect::<Vec<_>>();
            if points.len() < 3 {
                continue;
            }

            let (center_x, center_z) = points.iter().fold((0.0, 0.0), |sum, point| {
                (sum.0 + point[0], sum.1 + point[1])
            });

            let cell = render_cell(
                center_x / points.len() as f32,
                center_z / points.len() as f32,
            );

            chunks
                .buildings
                .entry(cell)
                .or_default()
                .push(building.clone());
        }

        chunks
    }

    pub fn cells(&self) -> Vec<(i32, i32)> {
        let mut cells = std::collections::HashSet::new();
        cells.extend(self.roads.keys().copied());
        cells.extend(self.buildings.keys().copied());
        cells.into_iter().collect()
    }

    pub fn build_chunk(&self, cell: (i32, i32)) -> (Option<Mesh>, Option<Mesh>, Option<Mesh>) {
        let asphalt = self
            .roads
            .get(&cell)
            .and_then(|items| build_roads_mesh(&items.asphalt).into_iter().next());
        let murram = self
            .roads
            .get(&cell)
            .and_then(|items| build_roads_mesh(&items.murram).into_iter().next());

        let buildings = self
            .buildings
            .get(&cell)
            .map(|items| build_buildings_mesh(items).into_iter().next())
            .flatten();

        (asphalt, murram, buildings)
    }
}

#[derive(Clone, Copy)]
struct RoadSegment {
    x1: f32,
    z1: f32,
    x2: f32,
    z2: f32,
    half_width: f32,
    surface: SurfaceKind,
}

#[derive(Clone, Copy)]
enum SurfaceKind {
    Asphalt,
    Murram,
}

#[derive(Clone, Copy)]
struct BuildingEdge {
    x1: f32,
    z1: f32,
    x2: f32,
    z2: f32,
    building_index: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct Collision {
    pub normal_x: f32,
    pub normal_z: f32,
    pub depth: f32,
}

#[derive(Resource)]
pub struct WorldMap {
    roads: Vec<RoadSegment>,
    road_cells: HashMap<(i32, i32), Vec<usize>>,
    buildings: Vec<Building>,
    building_edges: Vec<BuildingEdge>,
    building_cells: HashMap<(i32, i32), Vec<usize>>,
    edge_stamps: Vec<u32>,
    building_stamps: Vec<u32>,
    inside_stamps: Vec<u32>,
    tick: u32,
}

impl WorldMap {
    fn new(tile: &TileData) -> Self {
        let mut world = Self {
            roads: Vec::new(),
            road_cells: HashMap::new(),
            buildings: tile.buildings.clone(),
            building_edges: Vec::new(),
            building_cells: HashMap::new(),
            edge_stamps: Vec::new(),
            building_stamps: vec![0; tile.buildings.len()],
            inside_stamps: vec![0; tile.buildings.len()],
            tick: 0,
        };
        for road in &tile.roads {
            let surface = if road.surface.as_deref() == Some("murram") {
                SurfaceKind::Murram
            } else {
                SurfaceKind::Asphalt
            };
            for pair in road.pts.chunks_exact(2).collect::<Vec<_>>().windows(2) {
                let (a, b) = (pair[0], pair[1]);
                let id = world.roads.len();
                world.roads.push(RoadSegment {
                    x1: a[0],
                    z1: a[1],
                    x2: b[0],
                    z2: b[1],
                    half_width: road.w * 0.5 + 0.6,
                    surface,
                });
                insert_cells(
                    &mut world.road_cells,
                    id,
                    a[0],
                    a[1],
                    b[0],
                    b[1],
                    road.w * 0.5 + 0.6,
                );
            }
        }
        for (building_index, building) in tile.buildings.iter().enumerate() {
            let points = building.pts.chunks_exact(2).collect::<Vec<_>>();
            if points.len() < 3 {
                continue;
            }
            for index in 0..points.len() {
                let a = points[index];
                let b = points[(index + 1) % points.len()];
                let edge_id = world.building_edges.len();
                world.building_edges.push(BuildingEdge {
                    x1: a[0],
                    z1: a[1],
                    x2: b[0],
                    z2: b[1],
                    building_index,
                });
                insert_cells(
                    &mut world.building_cells,
                    edge_id,
                    a[0],
                    a[1],
                    b[0],
                    b[1],
                    3.0,
                );
            }
        }
        world.edge_stamps = vec![0; world.building_edges.len()];
        world
    }

    fn next_tick(&mut self) -> u32 {
        self.tick = self.tick.wrapping_add(1);
        if self.tick == 0 {
            self.edge_stamps.fill(0);
            self.building_stamps.fill(0);
            self.inside_stamps.fill(0);
            self.tick = 1;
        }
        self.tick
    }

    pub fn surface_at(&self, x: f32, z: f32) -> Surface {
        let cell = cell_for(x, z);
        if let Some(segments) = self.road_cells.get(&cell) {
            for &id in segments {
                let segment = self.roads[id];
                let (distance, _, _) =
                    closest_on_segment(x, z, segment.x1, segment.z1, segment.x2, segment.z2);
                if distance <= segment.half_width {
                    return match segment.surface {
                        SurfaceKind::Asphalt => Surface::ASPHALT,
                        SurfaceKind::Murram => Surface::MURRAM,
                    };
                }
            }
        }
        Surface::GRASS
    }

    pub fn collide_circle(&mut self, x: f32, z: f32, radius: f32) -> Option<Collision> {
        let tick = self.next_tick();
        let min_x = ((x - radius) / CELL_SIZE).floor() as i32;
        let max_x = ((x + radius) / CELL_SIZE).floor() as i32;
        let min_z = ((z - radius) / CELL_SIZE).floor() as i32;
        let max_z = ((z + radius) / CELL_SIZE).floor() as i32;
        let mut best: Option<(f32, Collision)> = None;
        for cell_x in min_x..=max_x {
            for cell_z in min_z..=max_z {
                let Some(edges) = self.building_cells.get(&(cell_x, cell_z)) else {
                    continue;
                };
                for &edge_id in edges {
                    if self.edge_stamps[edge_id] == tick {
                        continue;
                    }
                    self.edge_stamps[edge_id] = tick;
                    let edge = self.building_edges[edge_id];
                    if self.building_stamps[edge.building_index] != tick {
                        self.building_stamps[edge.building_index] = tick;
                        if point_in_polygon(x, z, &self.buildings[edge.building_index].pts) {
                            self.inside_stamps[edge.building_index] = tick;
                        }
                    }
                    let (distance, closest_x, closest_z) =
                        closest_on_segment(x, z, edge.x1, edge.z1, edge.x2, edge.z2);
                    if distance >= radius || distance == 0.0 {
                        continue;
                    }
                    let inside = self.inside_stamps[edge.building_index] == tick;
                    let (normal_x, normal_z, depth) = if inside {
                        (
                            (closest_x - x) / distance,
                            (closest_z - z) / distance,
                            radius + distance,
                        )
                    } else {
                        (
                            (x - closest_x) / distance,
                            (z - closest_z) / distance,
                            radius - distance,
                        )
                    };
                    if best.map_or(true, |(best_depth, _)| depth > best_depth) {
                        best = Some((
                            depth,
                            Collision {
                                normal_x,
                                normal_z,
                                depth,
                            },
                        ));
                    }
                }
            }
        }
        best.map(|(_, collision)| collision)
    }
}

fn cell_for(x: f32, z: f32) -> (i32, i32) {
    (
        (x / CELL_SIZE).floor() as i32,
        (z / CELL_SIZE).floor() as i32,
    )
}

fn insert_cells(
    cells: &mut HashMap<(i32, i32), Vec<usize>>,
    id: usize,
    x1: f32,
    z1: f32,
    x2: f32,
    z2: f32,
    padding: f32,
) {
    let min_x = ((x1.min(x2) - padding) / CELL_SIZE).floor() as i32;
    let max_x = ((x1.max(x2) + padding) / CELL_SIZE).floor() as i32;
    let min_z = ((z1.min(z2) - padding) / CELL_SIZE).floor() as i32;
    let max_z = ((z1.max(z2) + padding) / CELL_SIZE).floor() as i32;
    for cell_x in min_x..=max_x {
        for cell_z in min_z..=max_z {
            cells.entry((cell_x, cell_z)).or_default().push(id);
        }
    }
}

fn closest_on_segment(x: f32, z: f32, x1: f32, z1: f32, x2: f32, z2: f32) -> (f32, f32, f32) {
    let (dx, dz) = (x2 - x1, z2 - z1);
    let length_squared = dx * dx + dz * dz;
    let t = if length_squared > 0.0 {
        (((x - x1) * dx + (z - z1) * dz) / length_squared).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let closest_x = x1 + dx * t;
    let closest_z = z1 + dz * t;
    ((x - closest_x).hypot(z - closest_z), closest_x, closest_z)
}

fn point_in_polygon(x: f32, z: f32, points: &[f32]) -> bool {
    let count = points.len() / 2;
    let mut inside = false;
    let mut previous = count - 1;
    for current in 0..count {
        let (xi, zi) = (points[current * 2], points[current * 2 + 1]);
        let (xj, zj) = (points[previous * 2], points[previous * 2 + 1]);
        if (zi > z) != (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi {
            inside = !inside;
        }
        previous = current;
    }
    inside
}

pub fn load_route_catalog() -> Vec<RouteDef> {
    let catalog: RouteCatalog =
        serde_json::from_str(ROUTES_JSON).expect("embedded route catalogue must be valid JSON");
    catalog
        .routes
        .into_iter()
        .filter(|route| {
            (route.circuit || !route.checkpoints.is_empty() || route.mode == "free-drive")
                && route.pts.len() >= 8
        })
        .collect()
}

pub fn load_world(tile_path: &str) -> (WorldMap, WorldVisualChunks) {
    let tile_json = if tile_path.ends_with("/mombasa.json") {
        MOMBASA_TILE_JSON
    } else {
        TILE_JSON
    };
    let tile: TileData =
        serde_json::from_str(tile_json).expect("embedded world tile must be valid JSON");

    let map = WorldMap::new(&tile);
    let visual_chunks = WorldVisualChunks::new(&tile);

    (map, visual_chunks)
}

pub fn build_route_mesh(route: &RouteDef) -> Mesh {
    let mut mesh_data = MeshData::default();
    for pair in route.pts.chunks_exact(2).collect::<Vec<_>>().windows(2) {
        push_road_segment(&mut mesh_data, pair[0], pair[1], route.w);
    }
    mesh_data.into_mesh()
}

fn build_roads_mesh(roads: &[Road]) -> Vec<Mesh> {
    let mut chunks = HashMap::<(i32, i32), MeshData>::new();
    for road in roads {
        for pair in road.pts.chunks_exact(2).collect::<Vec<_>>().windows(2) {
            let a = pair[0];
            let b = pair[1];
            let cell = render_cell((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
            push_road_segment(chunks.entry(cell).or_default(), a, b, road.w);
        }
    }
    chunks.into_values().map(MeshData::into_mesh).collect()
}

fn push_road_segment(mesh: &mut MeshData, a: &[f32], b: &[f32], width: f32) {
    let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dz);
    if length <= f32::EPSILON {
        return;
    }
    let (right_x, right_z) = (-dz / length * width * 0.5, dx / length * width * 0.5);
    let texture_repeats = length / 4.0;
    let start = mesh.positions.len() as u32;
    mesh.vertex(
        [a[0] - right_x, 0.025, a[1] - right_z],
        [0.0, 1.0, 0.0],
        [0.0, 0.0],
    );
    mesh.vertex(
        [a[0] + right_x, 0.025, a[1] + right_z],
        [0.0, 1.0, 0.0],
        [1.0, 0.0],
    );
    mesh.vertex(
        [b[0] + right_x, 0.025, b[1] + right_z],
        [0.0, 1.0, 0.0],
        [1.0, texture_repeats],
    );
    mesh.vertex(
        [b[0] - right_x, 0.025, b[1] - right_z],
        [0.0, 1.0, 0.0],
        [0.0, texture_repeats],
    );
    mesh.indices
        .extend_from_slice(&[start, start + 1, start + 2, start, start + 2, start + 3]);
}

fn build_buildings_mesh(buildings: &[Building]) -> Vec<Mesh> {
    let mut chunks = HashMap::<(i32, i32), MeshData>::new();
    for building in buildings {
        let points = building.pts.chunks_exact(2).collect::<Vec<_>>();
        if points.len() < 3 {
            continue;
        }
        let (center_x, center_z) = points.iter().fold((0.0, 0.0), |sum, point| {
            (sum.0 + point[0], sum.1 + point[1])
        });
        let mesh_data = chunks
            .entry(render_cell(
                center_x / points.len() as f32,
                center_z / points.len() as f32,
            ))
            .or_default();
        let height = building.h.clamp(3.0, 80.0);
        let first = mesh_data.positions.len() as u32;
        for point in &points {
            mesh_data.vertex([point[0], height, point[1]], [0.0, 1.0, 0.0], [0.0, 0.0]);
        }
        for i in 1..points.len() - 1 {
            mesh_data
                .indices
                .extend_from_slice(&[first, first + i as u32 + 1, first + i as u32]);
        }
        for i in 0..points.len() {
            let a = points[i];
            let b = points[(i + 1) % points.len()];
            let dx = b[0] - a[0];
            let dz = b[1] - a[1];
            let length = dx.hypot(dz).max(f32::EPSILON);
            let normal = [dz / length, 0.0, -dx / length];
            let wall = mesh_data.positions.len() as u32;
            mesh_data.vertex([a[0], 0.0, a[1]], normal, [0.0, 0.0]);
            mesh_data.vertex([b[0], 0.0, b[1]], normal, [1.0, 0.0]);
            mesh_data.vertex([b[0], height, b[1]], normal, [1.0, 1.0]);
            mesh_data.vertex([a[0], height, a[1]], normal, [0.0, 1.0]);
            mesh_data.indices.extend_from_slice(&[
                wall,
                wall + 1,
                wall + 2,
                wall,
                wall + 2,
                wall + 3,
            ]);
        }
    }
    chunks.into_values().map(MeshData::into_mesh).collect()
}

fn render_cell(x: f32, z: f32) -> (i32, i32) {
    (
        (x / RENDER_CHUNK_SIZE).floor() as i32,
        (z / RENDER_CHUNK_SIZE).floor() as i32,
    )
}

#[derive(Default)]
struct MeshData {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Vec<[f32; 2]>,
    indices: Vec<u32>,
}

impl MeshData {
    fn vertex(&mut self, position: [f32; 3], normal: [f32; 3], uv: [f32; 2]) {
        self.positions.push(position);
        self.normals.push(normal);
        self.uvs.push(uv);
    }

    fn into_mesh(self) -> Mesh {
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uvs);
        mesh.insert_indices(Indices::U32(self.indices));
        mesh
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_world_and_routes_have_renderable_geometry() {
        let routes = load_route_catalog();

        assert_eq!(routes.iter().filter(|route| route.circuit).count(), 10);
        assert_eq!(
            routes
                .iter()
                .filter(|route| route.mode == "sprint" || !route.checkpoints.is_empty())
                .count(),
            3
        );
        assert_eq!(
            routes
                .iter()
                .filter(|route| route.city == "Mombasa" && route.mode == "free-drive")
                .count(),
            1
        );
        assert_eq!(
            routes
                .iter()
                .filter(|route| route.city == "Mombasa" && !route.checkpoints.is_empty())
                .count(),
            2
        );
        assert!(routes.iter().all(|route| route.pts.len() >= 8));

        let (world, chunks) = load_world("./data/tiles/ngara-sprint.json");

        assert!(world.roads.len() > 100);

        let cells = chunks.cells();
        assert!(!cells.is_empty());

        let mut has_roads = false;
        let mut has_buildings = false;

        for cell in cells {
            let (asphalt, murram, buildings) = chunks.build_chunk(cell);

            has_roads |= asphalt.is_some() || murram.is_some();
            has_buildings |= buildings.is_some();
        }

        assert!(has_roads, "world should contain renderable road chunks");
        assert!(
            has_buildings,
            "world should contain renderable building chunks"
        );

        let (mombasa, mombasa_chunks) = load_world("./data/tiles/mombasa.json");
        assert!(mombasa.roads.len() > world.roads.len());
        assert!(!mombasa_chunks.cells().is_empty());
    }

    #[test]
    fn visual_chunks_keep_asphalt_and_murram_separate() {
        let tile = TileData {
            roads: vec![
                Road {
                    w: 8.0,
                    surface: Some("asphalt".to_owned()),
                    pts: vec![0.0, 0.0, 12.0, 0.0],
                },
                Road {
                    w: 8.0,
                    surface: Some("murram".to_owned()),
                    pts: vec![0.0, 8.0, 12.0, 8.0],
                },
            ],
            buildings: Vec::new(),
        };
        let chunks = WorldVisualChunks::new(&tile);
        let (asphalt, murram, buildings) = chunks.build_chunk((0, 0));

        assert!(asphalt.is_some());
        assert!(murram.is_some());
        assert!(buildings.is_none());
    }

    #[test]
    fn world_queries_surface_and_building_collisions() {
        let tile = TileData {
            roads: vec![Road {
                w: 8.0,
                surface: Some("asphalt".to_owned()),
                pts: vec![-10.0, 0.0, 10.0, 0.0],
            }],
            buildings: vec![Building {
                h: 5.0,
                pts: vec![10.0, 10.0, 20.0, 10.0, 20.0, 20.0, 10.0, 20.0],
            }],
        };
        let mut world = WorldMap::new(&tile);
        assert_eq!(world.surface_at(0.0, 0.0).mu, Surface::ASPHALT.mu);
        assert_eq!(world.surface_at(0.0, 15.0).mu, Surface::GRASS.mu);
        let impact = world.collide_circle(10.5, 15.0, 1.0).unwrap();
        assert!(impact.normal_x < 0.0);
        assert!(impact.depth > 1.0);
    }
}
