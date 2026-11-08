mod circuit;
mod game;
mod physics;
mod world;

use bevy::prelude::*;
use game::{
    handle_gameplay_keys, interpolate_vehicle_transform, setup, simulate_vehicle,
    stream_world_chunks, update_follow_camera, update_frontend, update_hud, update_selected_world,
};
use std::path::PathBuf;

fn main() {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");

    App::new()
        .insert_resource(ClearColor(Color::srgb(0.27, 0.16, 0.12)))
        .add_plugins(
            DefaultPlugins
                .set(AssetPlugin {
                    file_path: workspace_root.to_string_lossy().into_owned(),
                    ..default()
                })
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "HOOD — Native PC".to_owned(),
                        resolution: (960.0_f32, 540.0_f32).into(),
                        present_mode: bevy::window::PresentMode::AutoVsync,
                        ..default()
                    }),
                    ..default()
                }),
        )
        .insert_resource(Time::<Fixed>::from_hz(60.0))
        .add_systems(Startup, setup)
        .add_systems(FixedUpdate, simulate_vehicle)
        .add_systems(
            Update,
            (
                update_frontend,
                handle_gameplay_keys,
                update_selected_world,
                interpolate_vehicle_transform,
                stream_world_chunks,
                update_follow_camera,
                update_hud,
            )
                .chain(),
        )
        .run();
}
