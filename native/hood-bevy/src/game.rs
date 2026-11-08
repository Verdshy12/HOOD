use crate::{
    circuit::{format_lap_time, CircuitSession, CircuitStatus},
    physics::{
        apply_impact, step_vehicle, Controls, Vehicle, VehiclePhysics, DODGE, SKYLINE_R34, SUBARU,
    },
    world::{
        build_route_mesh, load_route_catalog, load_world, RouteDef, WorldMap, WorldVisualChunks,
    },
};
use bevy::image::{ImageAddressMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use std::collections::HashSet;

const CAR_MODELS: [(&str, &str, VehiclePhysics, f32, [f32; 3]); 3] = [
    (
        "Dodge Challenger R/T",
        "source/dodge/scene.gltf#Scene0",
        DODGE,
        95.26566,
        [0.0, 0.00336, -0.04488],
    ),
    (
        "2006 Subaru Impreza WRX STI",
        "models/2006_subaru/scene.gltf#Scene0",
        SUBARU,
        99.51107,
        [0.0, 0.02401, 0.03933],
    ),
    (
        "Nissan Skyline R34",
        "models/nissan_skyline_r34_gt-r.glb#Scene0",
        SKYLINE_R34,
        1.39208,
        [2.46525, -0.36925, 1.04571],
    ),
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum GameMode {
    Circuit,
    Sprint,
    FreeDrive,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FrontendAction {
    SelectMode(GameMode),
    SelectCar(usize),
    StartDriving,
}

#[derive(Resource)]
pub(crate) struct WorldRenderMaterials {
    asphalt: Handle<StandardMaterial>,
    murram: Handle<StandardMaterial>,
    buildings: Handle<StandardMaterial>,
}

#[derive(Component)]
pub(crate) struct StreamedWorldChunk {
    cell: (i32, i32),
    mesh: Handle<Mesh>,
}
#[derive(Resource)]
pub(crate) struct GameState {
    routes: Vec<RouteDef>,
    selected_route: usize,
    selected_car: usize,
    mode: GameMode,
    lap_count: u8,
    session: CircuitSession,
    loaded_tile: String,
    rendered_route: String,
    elapsed_ms: f64,
    sprint_next_checkpoint: usize,
    sprint_started_at_ms: Option<f64>,
    sprint_finished_at_ms: Option<f64>,
    paused: bool,
    steer_input: f32,
    camera_top_down: bool,
    started: bool,
    intro_elapsed: f32,
}

fn route_matches_mode(route: &RouteDef, mode: GameMode) -> bool {
    match mode {
        GameMode::Circuit => route.circuit,
        GameMode::Sprint => !route.checkpoints.is_empty(),
        GameMode::FreeDrive => route.mode == "free-drive",
    }
}

fn mode_route_indices(routes: &[RouteDef], mode: GameMode) -> Vec<usize> {
    routes
        .iter()
        .enumerate()
        .filter_map(|(index, route)| route_matches_mode(route, mode).then_some(index))
        .collect()
}

fn select_mode(state: &mut GameState, mode: GameMode) -> bool {
    state.mode = mode;
    if route_matches_mode(&state.routes[state.selected_route], mode) {
        return false;
    }
    if let Some(index) = state
        .routes
        .iter()
        .position(|route| route_matches_mode(route, mode))
    {
        state.selected_route = index;
        true
    } else {
        false
    }
}

#[derive(Resource, Clone, Copy)]
pub(crate) struct VehicleRenderState {
    previous: Transform,
    current: Transform,
}

#[derive(Component)]
pub(crate) struct PlayerCar;

#[derive(Component)]
pub(crate) struct CarModel;

#[derive(Component)]
pub(crate) struct PreviewCar;

#[derive(Component)]
pub(crate) struct PreviewCarModel;

#[derive(Component)]
pub(crate) struct RouteVisual(Handle<Mesh>);

#[derive(Component)]
pub(crate) struct FollowCamera;

#[derive(Component)]
pub(crate) struct HudText;

#[derive(Component)]
pub(crate) struct MenuRoot;

#[derive(Component)]
pub(crate) struct MenuButton {
    action: FrontendAction,
    label: &'static str,
}

#[derive(Component)]
pub(crate) struct IntroTitle;

pub fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    asset_server: Res<AssetServer>,
) {
    let routes = load_route_catalog();
    assert!(
        !routes.is_empty(),
        "the embedded route catalogue has no playable routes"
    );
    let selected_route = routes
        .iter()
        .position(|route| route.id == "ngara-circuit-7")
        .unwrap_or(0);
    let lap_count = 3;
    let route = routes[selected_route].clone();
    let (spawn_x, spawn_z, spawn_heading) = route_spawn(&route);
    let session = CircuitSession::new(&route, lap_count)
        .expect("the selected circuit route must define a valid start/finish gate");
    let (world_map, world_chunks) = load_world(&route.tile);

    commands.insert_resource(world_map);
    commands.insert_resource(world_chunks);
    commands.insert_resource(GameState {
        routes,
        selected_route,
        selected_car: 0,
        mode: GameMode::Circuit,
        lap_count,
        session,
        loaded_tile: route.tile.clone(),
        rendered_route: route.id.clone(),
        elapsed_ms: 0.0,
        sprint_next_checkpoint: 0,
        sprint_started_at_ms: None,
        sprint_finished_at_ms: None,
        paused: false,
        steer_input: 0.0,
        camera_top_down: false,
        started: false,
        intro_elapsed: 0.0,
    });
    let spawn_transform = Transform::from_xyz(spawn_x, 0.35, spawn_z)
        .with_rotation(Quat::from_rotation_y(-spawn_heading));
    commands.insert_resource(VehicleRenderState {
        previous: spawn_transform,
        current: spawn_transform,
    });

    commands.spawn((
        Mesh3d(meshes.add(Cuboid::new(5000.0, 0.2, 5000.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.16, 0.22, 0.15),
            perceptual_roughness: 1.0,
            ..default()
        })),
        Transform::from_xyz(0.0, -0.12, 0.0),
    ));

    let tarmac: Handle<Image> = asset_server.load_with_settings(
        "assets/Terrain/asphalt_track/textures/asphalt_track_diff_4k.jpg",
        |settings: &mut bevy::image::ImageLoaderSettings| {
            let mut sampler = ImageSamplerDescriptor::default();
            sampler.address_mode_u = ImageAddressMode::Repeat;
            sampler.address_mode_v = ImageAddressMode::Repeat;
            settings.sampler = ImageSampler::Descriptor(sampler);
        },
    );
    let asphalt_material = materials.add(StandardMaterial {
        base_color: Color::WHITE,
        base_color_texture: Some(tarmac),
        perceptual_roughness: 0.94,
        ..default()
    });

    let murram_material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.35, 0.24, 0.15),
        perceptual_roughness: 0.94,
        ..default()
    });

    let building_material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.39, 0.36, 0.31),
        perceptual_roughness: 0.95,
        cull_mode: None,
        ..default()
    });

    commands.insert_resource(WorldRenderMaterials {
        asphalt: asphalt_material,
        murram: murram_material,
        buildings: building_material,
    });

    let route_mesh = meshes.add(build_route_mesh(&route));
    commands.spawn((
        Mesh3d(route_mesh.clone()),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.08, 0.73, 0.83),
            emissive: Color::srgb(0.02, 0.24, 0.28).into(),
            perceptual_roughness: 0.55,
            ..default()
        })),
        RouteVisual(route_mesh),
    ));

    let car = commands
        .spawn((
            PlayerCar,
            Vehicle::new(spawn_x, spawn_z, spawn_heading, CAR_MODELS[0].2),
            Transform::from_xyz(spawn_x, 0.35, spawn_z)
                .with_rotation(Quat::from_rotation_y(-spawn_heading)),
            Visibility::Hidden,
        ))
        .id();
    commands.entity(car).with_children(|parent| {
        parent.spawn((
            SceneRoot(asset_server.load(CAR_MODELS[0].1)),
            car_model_transform(0),
            CarModel,
        ));
    });

    let preview_car = commands
        .spawn((
            PreviewCar,
            Transform::from_xyz(
                spawn_x + spawn_heading.sin() * 24.0,
                0.35,
                spawn_z - spawn_heading.cos() * 24.0,
            )
            .with_rotation(Quat::from_rotation_y(-spawn_heading)),
        ))
        .id();
    commands.entity(preview_car).with_children(|parent| {
        parent.spawn((
            SceneRoot(asset_server.load(CAR_MODELS[0].1)),
            car_model_transform(0),
            PreviewCarModel,
        ));
    });

    commands.spawn((
        Camera3d::default(),
        Msaa::Off,
        Transform::from_xyz(spawn_x, 5.0, spawn_z + 11.0)
            .looking_at(Vec3::new(spawn_x, 0.6, spawn_z), Vec3::Y),
        FollowCamera,
    ));
    commands.spawn((
        Text::new(""),
        TextFont {
            font_size: 22.0,
            ..default()
        },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(24.0),
            top: Val::Px(20.0),
            display: Display::None,
            ..default()
        },
        HudText,
    ));

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                padding: UiRect::axes(Val::Px(34.0), Val::Px(28.0)),
                justify_content: JustifyContent::SpaceBetween,
                align_items: AlignItems::FlexEnd,
                ..default()
            },
            MenuRoot,
        ))
        .with_children(|root| {
            root.spawn((Node {
                position_type: PositionType::Absolute,
                left: Val::Px(36.0),
                top: Val::Px(26.0),
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(4.0),
                ..default()
            },))
                .with_children(|brand| {
                    brand.spawn((
                        Text::new("HOOD"),
                        TextFont {
                            font_size: 76.0,
                            ..default()
                        },
                        TextColor(Color::srgba(1.0, 0.69, 0.27, 0.0)),
                        IntroTitle,
                    ));
                    brand.spawn((
                        Text::new("NATIVE EDITION  |  NAIROBI & MOMBASA"),
                        TextFont {
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::srgba(1.0, 0.93, 0.82, 0.9)),
                    ));
                });

            root.spawn((
                Node {
                    width: Val::Px(365.0),
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(12.0),
                    padding: UiRect::all(Val::Px(22.0)),
                    border: UiRect::all(Val::Px(1.0)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.035, 0.045, 0.055, 0.9)),
                BorderColor(Color::srgba(1.0, 0.72, 0.35, 0.65)),
            ))
            .with_children(|panel| {
                panel.spawn((
                    Text::new("READY TO PLAY"),
                    TextFont {
                        font_size: 29.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
                panel.spawn((
                    Text::new("SELECT MODE"),
                    TextFont {
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::srgba(1.0, 0.72, 0.39, 1.0)),
                ));
                panel
                    .spawn(Node {
                        width: Val::Percent(100.0),
                        column_gap: Val::Px(8.0),
                        ..default()
                    })
                    .with_children(|modes| {
                        for (label, mode) in [
                            ("CIRCUIT", GameMode::Circuit),
                            ("SPRINT", GameMode::Sprint),
                            ("FREE DRIVE", GameMode::FreeDrive),
                        ] {
                            modes
                                .spawn((
                                    Button,
                                    MenuButton {
                                        action: FrontendAction::SelectMode(mode),
                                        label,
                                    },
                                    Node {
                                        width: Val::Percent(33.333),
                                        min_height: Val::Px(42.0),
                                        justify_content: JustifyContent::Center,
                                        align_items: AlignItems::Center,
                                        ..default()
                                    },
                                    BackgroundColor(Color::srgba(0.42, 0.24, 0.11, 0.92)),
                                    BorderColor(Color::srgba(1.0, 0.72, 0.35, 0.8)),
                                ))
                                .with_children(|button| {
                                    button.spawn((
                                        Text::new(label),
                                        TextFont {
                                            font_size: 13.0,
                                            ..default()
                                        },
                                        TextColor(Color::WHITE),
                                    ));
                                });
                        }
                    });
                panel.spawn((
                    Text::new("SELECT CAR"),
                    TextFont {
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::srgba(1.0, 0.72, 0.39, 1.0)),
                ));
                panel
                    .spawn(Node {
                        width: Val::Percent(100.0),
                        flex_direction: FlexDirection::Column,
                        row_gap: Val::Px(7.0),
                        ..default()
                    })
                    .with_children(|cars| {
                        for (index, (label, ..)) in CAR_MODELS.iter().enumerate() {
                            cars.spawn((
                                Button,
                                MenuButton {
                                    action: FrontendAction::SelectCar(index),
                                    label,
                                },
                                Node {
                                    width: Val::Percent(100.0),
                                    min_height: Val::Px(38.0),
                                    padding: UiRect::horizontal(Val::Px(10.0)),
                                    justify_content: JustifyContent::FlexStart,
                                    align_items: AlignItems::Center,
                                    ..default()
                                },
                                BackgroundColor(Color::srgba(0.12, 0.15, 0.17, 0.92)),
                                BorderColor(Color::srgba(1.0, 1.0, 1.0, 0.16)),
                            ))
                            .with_children(|button| {
                                button.spawn((
                                    Text::new(*label),
                                    TextFont {
                                        font_size: 12.0,
                                        ..default()
                                    },
                                    TextColor(Color::WHITE),
                                ));
                            });
                        }
                    });
                panel
                    .spawn((
                        Button,
                        MenuButton {
                            action: FrontendAction::StartDriving,
                            label: "START DRIVING",
                        },
                        Node {
                            width: Val::Percent(100.0),
                            min_height: Val::Px(52.0),
                            margin: UiRect::top(Val::Px(4.0)),
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            ..default()
                        },
                        BackgroundColor(Color::srgb(0.88, 0.43, 0.12)),
                        BorderColor(Color::srgba(1.0, 0.77, 0.39, 1.0)),
                    ))
                    .with_children(|button| {
                        button.spawn((
                            Text::new("START DRIVING"),
                            TextFont {
                                font_size: 15.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });
            });
        });

    commands.spawn((
        DirectionalLight {
            illuminance: 18_000.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_xyz(-400.0, 800.0, 300.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

pub(crate) fn handle_gameplay_keys(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<GameState>,
    mut cars: Query<(&mut Vehicle, &mut Transform), With<PlayerCar>>,
    car_entities: Query<Entity, With<PlayerCar>>,
    car_models: Query<Entity, With<CarModel>>,
    mut render_state: ResMut<VehicleRenderState>,
) {
    if !state.started {
        return;
    }

    let mut reset = false;
    let mode_routes = mode_route_indices(&state.routes, state.mode);
    for (slot, key) in [
        KeyCode::Digit1,
        KeyCode::Digit2,
        KeyCode::Digit3,
        KeyCode::Digit4,
        KeyCode::Digit5,
        KeyCode::Digit6,
        KeyCode::Digit7,
        KeyCode::Digit8,
        KeyCode::Digit9,
        KeyCode::Digit0,
    ]
    .into_iter()
    .enumerate()
    {
        if keys.just_pressed(key) && slot < mode_routes.len() {
            state.selected_route = mode_routes[slot];
            reset = true;
        }
    }

    if keys.just_pressed(KeyCode::Tab) {
        let next_mode = match state.mode {
            GameMode::Circuit => GameMode::Sprint,
            GameMode::Sprint => GameMode::FreeDrive,
            GameMode::FreeDrive => GameMode::Circuit,
        };
        reset |= select_mode(&mut state, next_mode);
    }

    let mut car_changed = false;
    if keys.just_pressed(KeyCode::KeyL) {
        state.lap_count = state.lap_count % 5 + 1;
        reset = true;
    }
    if keys.just_pressed(KeyCode::KeyR) {
        reset = true;
    }
    if keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::KeyP) {
        state.paused = !state.paused;
    }
    if keys.just_pressed(KeyCode::KeyC) {
        state.camera_top_down = !state.camera_top_down;
    }

    for (index, key) in [KeyCode::F1, KeyCode::F2, KeyCode::F3]
        .into_iter()
        .enumerate()
    {
        if keys.just_pressed(key) && state.selected_car != index {
            state.selected_car = index;
            car_changed = true;
        }
    }

    if car_changed {
        if let Ok(car_entity) = car_entities.get_single() {
            for model_entity in &car_models {
                commands.entity(model_entity).despawn_recursive();
            }
            commands.entity(car_entity).with_children(|parent| {
                parent.spawn((
                    SceneRoot(asset_server.load(CAR_MODELS[state.selected_car].1)),
                    car_model_transform(state.selected_car),
                    CarModel,
                ));
            });
        }
    }

    if reset {
        let route = state.routes[state.selected_route].clone();
        let lap_count = state.lap_count;
        let selected_car = state.selected_car;

        state.session.reset(&route, lap_count);
        state.elapsed_ms = 0.0;
        state.sprint_next_checkpoint = 0;
        state.sprint_started_at_ms = None;
        state.sprint_finished_at_ms = None;
        state.steer_input = 0.0;
        state.paused = false;

        if let Ok((mut vehicle, mut transform)) = cars.get_single_mut() {
            if selected_car < CAR_MODELS.len() {
                let (x, z, heading) = route_spawn(&route);

                *vehicle = Vehicle::new(x, z, heading, CAR_MODELS[selected_car].2);

                transform.translation = Vec3::new(x, 0.35, z);
                transform.rotation = Quat::from_rotation_y(-heading);
            }
        }
    } else if car_changed {
        let route = &state.routes[state.selected_route];
        let selected_car = state.selected_car;
        if let Ok((mut vehicle, mut transform)) = cars.get_single_mut() {
            if selected_car < CAR_MODELS.len() {
                let (x, z, heading) = route_spawn(route);
                *vehicle = Vehicle::new(x, z, heading, CAR_MODELS[selected_car].2);
                transform.translation = Vec3::new(x, 0.35, z);
                transform.rotation = Quat::from_rotation_y(-heading);
            }
        }
    }

    if reset || car_changed {
        if let Ok((_, transform)) = cars.get_single() {
            render_state.previous = *transform;
            render_state.current = *transform;
        }
    }
}

pub(crate) fn simulate_vehicle(
    time: Res<Time<Fixed>>,
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<GameState>,
    mut world: ResMut<WorldMap>,
    mut cars: Query<&mut Vehicle, With<PlayerCar>>,
    mut render_state: ResMut<VehicleRenderState>,
) {
    if !state.started || state.paused {
        return;
    }
    let Ok(mut vehicle) = cars.get_single_mut() else {
        return;
    };
    let dt = time.delta_secs();
    let steer_target = axis(
        keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft),
        keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight),
    );
    let steer_rate = if steer_target == 0.0 { 7.0 } else { 3.2 };
    let max_steer_step = steer_rate * dt;
    state.steer_input += (steer_target - state.steer_input).clamp(-max_steer_step, max_steer_step);
    let controls = Controls {
        throttle: if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
            1.0
        } else {
            0.0
        },
        brake: if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
            1.0
        } else {
            0.0
        },
        steer: state.steer_input,
        handbrake: keys.pressed(KeyCode::Space),
        nitro: keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::KeyN),
    };
    let physics = CAR_MODELS[state.selected_car].2;
    let surface = world.surface_at(vehicle.x, vehicle.z);
    step_vehicle(&mut vehicle, controls, surface, dt, physics);

    for offset in [-1.6, 0.0, 1.6] {
        let center_x = vehicle.x + vehicle.psi.sin() * offset;
        let center_z = vehicle.z - vehicle.psi.cos() * offset;
        if let Some(collision) = world.collide_circle(center_x, center_z, 1.05) {
            apply_impact(
                &mut vehicle,
                crate::physics::Impact {
                    normal_x: collision.normal_x,
                    normal_z: collision.normal_z,
                    depth: collision.depth,
                },
            );
        }
    }

    state.elapsed_ms += f64::from(dt) * 1000.0;

    let elapsed_ms = state.elapsed_ms;
    match state.mode {
        GameMode::Circuit => state.session.update(vehicle.x, vehicle.z, elapsed_ms),
        GameMode::Sprint => {
            let checkpoint = state.routes[state.selected_route]
                .checkpoints
                .get(state.sprint_next_checkpoint)
                .map(|point| (point.x, point.z));
            let checkpoint_count = state.routes[state.selected_route].checkpoints.len();
            if let Some((checkpoint_x, checkpoint_z)) = checkpoint {
                state.sprint_started_at_ms.get_or_insert(elapsed_ms);
                if (vehicle.x - checkpoint_x).hypot(vehicle.z - checkpoint_z) <= 14.0 {
                    state.sprint_next_checkpoint += 1;
                    if state.sprint_next_checkpoint >= checkpoint_count {
                        state.sprint_finished_at_ms = Some(elapsed_ms);
                    }
                }
            }
        }
        GameMode::FreeDrive => {}
    }
    render_state.previous = render_state.current;
    render_state.current = Transform::from_xyz(vehicle.x, 0.35 + vehicle.suspension_y, vehicle.z)
        .with_rotation(Quat::from_rotation_y(-vehicle.psi));
}

pub(crate) fn interpolate_vehicle_transform(
    fixed_time: Res<Time<Fixed>>,
    render_state: Res<VehicleRenderState>,
    mut cars: Query<&mut Transform, With<PlayerCar>>,
) {
    let Ok(mut transform) = cars.get_single_mut() else {
        return;
    };
    let alpha = fixed_time.overstep_fraction();
    transform.translation = render_state
        .previous
        .translation
        .lerp(render_state.current.translation, alpha);
    transform.rotation = render_state
        .previous
        .rotation
        .slerp(render_state.current.rotation, alpha);
}

pub(crate) fn update_follow_camera(
    time: Res<Time>,
    state: Res<GameState>,
    cars: Query<&Transform, With<PlayerCar>>,
    mut cameras: Query<&mut Transform, (With<FollowCamera>, Without<PlayerCar>)>,
) {
    let Ok(car_transform) = cars.get_single() else {
        return;
    };
    let Ok(mut camera) = cameras.get_single_mut() else {
        return;
    };
    let position = if state.camera_top_down {
        car_transform.translation + Vec3::new(0.0, 38.0, 0.1)
    } else {
        car_transform.translation + car_transform.rotation * Vec3::new(0.0, 3.1, 8.5)
    };
    let blend = 1.0_f32 - (-5.0_f32 * time.delta_secs()).exp();
    camera.translation = camera.translation.lerp(position, blend);
    let target = car_transform.translation + Vec3::Y * 0.9;
    camera.look_at(target, Vec3::Y);
}

pub(crate) fn update_hud(
    state: Res<GameState>,
    cars: Query<&Vehicle, With<PlayerCar>>,
    mut text: Query<&mut Text, With<HudText>>,
) {
    if !state.started {
        return;
    }
    let (Ok(vehicle), Ok(mut text)) = (cars.get_single(), text.get_single_mut()) else {
        return;
    };
    let route = &state.routes[state.selected_route];
    let mode = match state.mode {
        GameMode::Circuit => "CIRCUIT",
        GameMode::Sprint => "SPRINT",
        GameMode::FreeDrive => "FREE DRIVE",
    };
    let gear = if vehicle.reverse {
        "R".to_owned()
    } else if vehicle.speed < 0.5 && vehicle.throttle < 0.05 {
        "N".to_owned()
    } else {
        format!("D{}", vehicle.gear + 1)
    };
    let race_info = match state.mode {
        GameMode::Circuit => match state.session.status {
            CircuitStatus::Ready => "Cross the start line to begin".to_owned(),
            CircuitStatus::Racing => format!(
                "Lap {}/{}   {}   Best {}",
                state.session.current_lap.unwrap_or(1),
                state.session.target_laps,
                format_lap_time(Some(state.session.current_lap_ms)),
                format_lap_time(state.session.best_lap_ms)
            ),
            CircuitStatus::Finished => format!(
                "FINISHED   Best {}   Last {}",
                format_lap_time(state.session.best_lap_ms),
                format_lap_time(state.session.last_lap_ms)
            ),
        },
        GameMode::Sprint => {
            if let Some(finished_at) = state.sprint_finished_at_ms {
                format!(
                    "SPRINT COMPLETE   {}",
                    format_lap_time(Some(
                        finished_at - state.sprint_started_at_ms.unwrap_or(finished_at)
                    ))
                )
            } else if let Some(started_at) = state.sprint_started_at_ms {
                let checkpoint_name = route
                    .checkpoints
                    .get(state.sprint_next_checkpoint)
                    .map_or("Finish", |checkpoint| checkpoint.name.as_str());
                format!(
                    "Checkpoint {}/{}: {}   {}",
                    state.sprint_next_checkpoint,
                    route.checkpoints.len(),
                    checkpoint_name,
                    format_lap_time(Some(state.elapsed_ms - started_at))
                )
            } else {
                format!("Clear all {} sprint checkpoints", route.checkpoints.len())
            }
        }
        GameMode::FreeDrive => format!(
            "Explore the {} road network",
            if route.city.is_empty() {
                "open"
            } else {
                route.city.as_str()
            }
        ),
    };
    let pause = if state.paused { "   PAUSED" } else { "" };
    let route_indices = mode_route_indices(&state.routes, state.mode);
    let route_number = route_indices
        .iter()
        .position(|index| *index == state.selected_route)
        .map_or(0, |index| index + 1);
    text.0 = format!(
        "HOOD  |  {mode}{pause}\n{}\nRoute {}/{}  |  {}  |  {}  |  {} km/h  |  {} RPM\n{}\n\
         W/S accelerate / brake   A/D steer   Space handbrake   Shift/N nitro\n\
         1-0 route   F1-F3 car   L laps   Tab mode   C camera   R reset   Esc pause",
        route.name,
        route_number,
        route_indices.len(),
        CAR_MODELS[state.selected_car].0,
        gear,
        (vehicle.speed * 3.6).round() as u32,
        vehicle.rpm.round() as u32,
        race_info,
    );
}

pub(crate) fn update_frontend(
    mut commands: Commands,
    time: Res<Time>,
    mut state: ResMut<GameState>,
    mut buttons: Query<(&Interaction, &MenuButton, &mut BackgroundColor, &Children), With<Button>>,
    mut labels: Query<&mut Text>,
    mut title: Query<&mut TextColor, With<IntroTitle>>,
    mut preview_car: Query<&mut Transform, (With<PreviewCar>, Without<PlayerCar>)>,
    mut cars: Query<(Entity, &mut Vehicle, &mut Transform, &mut Visibility), With<PlayerCar>>,
    player_models: Query<Entity, With<CarModel>>,
    preview_models: Query<Entity, With<PreviewCarModel>>,
    preview_entities: Query<Entity, With<PreviewCar>>,
    menu_roots: Query<Entity, With<MenuRoot>>,
    mut hud: Query<&mut Node, With<HudText>>,
    asset_server: Res<AssetServer>,
    mut render_state: ResMut<VehicleRenderState>,
) {
    if state.started {
        return;
    }

    state.intro_elapsed += time.delta_secs();
    let reveal = (state.intro_elapsed / 1.4).clamp(0.0, 1.0);
    for mut color in &mut title {
        color.0 = Color::srgba(1.0, 0.69, 0.27, reveal);
    }

    let route = &state.routes[state.selected_route];
    let (spawn_x, spawn_z, heading) = route_spawn(route);
    let progress = (state.intro_elapsed / 5.5).clamp(0.0, 1.0);
    let travel = if progress < 1.0 {
        24.0 - progress * 48.0
    } else {
        0.0
    };
    for mut transform in &mut preview_car {
        transform.translation = Vec3::new(
            spawn_x + heading.sin() * travel,
            0.35,
            spawn_z - heading.cos() * travel,
        );
        transform.rotation = Quat::from_rotation_y(-heading);
    }

    let mut pressed_action = None;
    for (interaction, button, _, _) in &mut buttons {
        if *interaction == Interaction::Pressed {
            pressed_action = Some(button.action);
            break;
        }
    }

    let mut selected_car_changed = false;
    let mut route_changed = false;
    let mut start_requested = false;
    if let Some(action) = pressed_action {
        match action {
            FrontendAction::SelectMode(mode) => {
                route_changed = select_mode(&mut state, mode);
            }
            FrontendAction::SelectCar(index) if index < CAR_MODELS.len() => {
                selected_car_changed = state.selected_car != index;
                state.selected_car = index;
            }
            FrontendAction::StartDriving => start_requested = true,
            FrontendAction::SelectCar(_) => {}
        }
    }

    for (interaction, button, mut background, children) in &mut buttons {
        let selected = match button.action {
            FrontendAction::SelectMode(mode) => state.mode == mode,
            FrontendAction::SelectCar(index) => state.selected_car == index,
            FrontendAction::StartDriving => false,
        };
        *background = BackgroundColor(match *interaction {
            Interaction::Pressed => Color::srgb(0.92, 0.52, 0.17),
            Interaction::Hovered if selected => Color::srgb(0.62, 0.36, 0.16),
            Interaction::Hovered => Color::srgb(0.24, 0.27, 0.29),
            Interaction::None if selected => Color::srgb(0.42, 0.24, 0.11),
            Interaction::None if matches!(button.action, FrontendAction::StartDriving) => {
                Color::srgb(0.88, 0.43, 0.12)
            }
            Interaction::None => Color::srgba(0.12, 0.15, 0.17, 0.92),
        });
        for child in children {
            if let Ok(mut text) = labels.get_mut(*child) {
                text.0 = if selected {
                    format!("{}  [SELECTED]", button.label)
                } else {
                    button.label.to_owned()
                };
            }
        }
    }

    if selected_car_changed || route_changed {
        for entity in &player_models {
            if selected_car_changed {
                commands.entity(entity).despawn_recursive();
            }
        }
        if selected_car_changed {
            for entity in &preview_models {
                commands.entity(entity).despawn_recursive();
            }
        }

        if let Ok((car_entity, mut vehicle, mut transform, _)) = cars.get_single_mut() {
            let route = &state.routes[state.selected_route];
            let (x, z, heading) = route_spawn(route);
            *vehicle = Vehicle::new(x, z, heading, CAR_MODELS[state.selected_car].2);
            *transform =
                Transform::from_xyz(x, 0.35, z).with_rotation(Quat::from_rotation_y(-heading));
            if selected_car_changed {
                commands.entity(car_entity).with_children(|parent| {
                    parent.spawn((
                        SceneRoot(asset_server.load(CAR_MODELS[state.selected_car].1)),
                        car_model_transform(state.selected_car),
                        CarModel,
                    ));
                });
            }
            render_state.previous = *transform;
            render_state.current = *transform;
        }

        if selected_car_changed {
            if let Ok(preview_entity) = preview_entities.get_single() {
                commands.entity(preview_entity).with_children(|parent| {
                    parent.spawn((
                        SceneRoot(asset_server.load(CAR_MODELS[state.selected_car].1)),
                        car_model_transform(state.selected_car),
                        PreviewCarModel,
                    ));
                });
            }
        }
    }

    if start_requested {
        let route = state.routes[state.selected_route].clone();
        let lap_count = state.lap_count;
        state.session.reset(&route, lap_count);
        state.elapsed_ms = 0.0;
        state.sprint_next_checkpoint = 0;
        state.sprint_started_at_ms = None;
        state.sprint_finished_at_ms = None;
        state.paused = false;
        let (x, z, heading) = route_spawn(&route);
        if let Ok((_, mut vehicle, mut transform, _)) = cars.get_single_mut() {
            *vehicle = Vehicle::new(x, z, heading, CAR_MODELS[state.selected_car].2);
            *transform =
                Transform::from_xyz(x, 0.35, z).with_rotation(Quat::from_rotation_y(-heading));
            render_state.previous = *transform;
            render_state.current = *transform;
        }
        state.started = true;
        if let Ok((_, _, _, mut visibility)) = cars.get_single_mut() {
            *visibility = Visibility::Visible;
        }
        for entity in &preview_entities {
            commands.entity(entity).despawn_recursive();
        }
        for entity in &menu_roots {
            commands.entity(entity).despawn_recursive();
        }
        for mut node in &mut hud {
            node.display = Display::Flex;
        }
    }
}

fn car_model_transform(index: usize) -> Transform {
    let (_, _, _, scale, translation) = CAR_MODELS[index];
    Transform {
        translation: Vec3::from_array(translation),
        rotation: Quat::from_rotation_y(std::f32::consts::PI),
        scale: Vec3::splat(scale),
    }
}

fn route_spawn(route: &RouteDef) -> (f32, f32, f32) {
    let start_x = route.pts[0];
    let start_z = route.pts[1];
    let (dx, dz) = (1..route.pts.len() / 2)
        .map(|index| {
            (
                route.pts[index * 2] - start_x,
                route.pts[index * 2 + 1] - start_z,
            )
        })
        .find(|(dx, dz)| dx.hypot(*dz) > 0.01)
        .unwrap_or((0.0, -1.0));
    let length = dx.hypot(dz).max(f32::EPSILON);
    let (forward_x, forward_z) = (dx / length, dz / length);
    let (right_x, right_z) = (-forward_z, forward_x);
    let lane_offset = -route.w * 0.25;
    (
        start_x - forward_x * 6.0 + right_x * lane_offset,
        start_z - forward_z * 6.0 + right_z * lane_offset,
        dx.atan2(-dz),
    )
}

fn axis(negative: bool, positive: bool) -> f32 {
    match (negative, positive) {
        (true, false) => -1.0,
        (false, true) => 1.0,
        _ => 0.0,
    }
}

pub(crate) fn update_selected_world(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut world_map: ResMut<WorldMap>,
    mut world_chunks: ResMut<WorldVisualChunks>,
    route_visuals: Query<&RouteVisual>,
    loaded_chunks: Query<(Entity, &StreamedWorldChunk)>,
) {
    let route = state.routes[state.selected_route].clone();
    if route.id == state.rendered_route && route.tile == state.loaded_tile {
        return;
    }

    if route.tile != state.loaded_tile {
        let (new_map, new_chunks) = load_world(&route.tile);
        *world_map = new_map;
        *world_chunks = new_chunks;
        state.loaded_tile = route.tile.clone();
        for (entity, chunk) in &loaded_chunks {
            meshes.remove(chunk.mesh.id());
            commands.entity(entity).despawn();
        }
    }

    if let Ok(visual) = route_visuals.get_single() {
        if let Some(mesh) = meshes.get_mut(&visual.0) {
            *mesh = build_route_mesh(&route);
        }
    }
    state.rendered_route = route.id;
}

pub(crate) fn stream_world_chunks(
    mut commands: Commands,
    cars: Query<&Transform, With<PlayerCar>>,
    world: Res<WorldVisualChunks>,
    render_materials: Res<WorldRenderMaterials>,
    mut meshes: ResMut<Assets<Mesh>>,
    loaded_chunks: Query<(Entity, &StreamedWorldChunk)>,
) {
    const LOAD_RADIUS: f32 = 300.0;
    const UNLOAD_RADIUS: f32 = 400.0;
    const CHUNK_SIZE: f32 = 128.0;

    let Ok(car) = cars.get_single() else {
        return;
    };

    let car_x = car.translation.x;
    let car_z = car.translation.z;

    let distance_to_chunk = |cell: (i32, i32)| {
        let min_x = cell.0 as f32 * CHUNK_SIZE;
        let min_z = cell.1 as f32 * CHUNK_SIZE;
        let max_x = min_x + CHUNK_SIZE;
        let max_z = min_z + CHUNK_SIZE;

        let nearest_x = car_x.clamp(min_x, max_x);
        let nearest_z = car_z.clamp(min_z, max_z);

        (car_x - nearest_x).hypot(car_z - nearest_z)
    };

    let loaded_cells: HashSet<(i32, i32)> =
        loaded_chunks.iter().map(|(_, chunk)| chunk.cell).collect();

    // Unload visual chunks outside the unloading radius.
    for (entity, chunk) in &loaded_chunks {
        if distance_to_chunk(chunk.cell) > UNLOAD_RADIUS {
            meshes.remove(chunk.mesh.id());
            commands.entity(entity).despawn();
        }
    }

    // Load nearby visual chunks that are not already present.
    for cell in world.cells() {
        if loaded_cells.contains(&cell) || distance_to_chunk(cell) > LOAD_RADIUS {
            continue;
        }

        let (asphalt_mesh, murram_mesh, building_mesh) = world.build_chunk(cell);

        if let Some(mesh) = asphalt_mesh {
            let handle = meshes.add(mesh);

            commands.spawn((
                Mesh3d(handle.clone()),
                MeshMaterial3d(render_materials.asphalt.clone()),
                StreamedWorldChunk { cell, mesh: handle },
            ));
        }

        if let Some(mesh) = murram_mesh {
            let handle = meshes.add(mesh);

            commands.spawn((
                Mesh3d(handle.clone()),
                MeshMaterial3d(render_materials.murram.clone()),
                StreamedWorldChunk { cell, mesh: handle },
            ));
        }

        if let Some(mesh) = building_mesh {
            let handle = meshes.add(mesh);

            commands.spawn((
                Mesh3d(handle.clone()),
                MeshMaterial3d(render_materials.buildings.clone()),
                StreamedWorldChunk { cell, mesh: handle },
            ));
        }
    }
}
