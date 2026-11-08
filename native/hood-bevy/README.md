# HOOD Native PC

This is a native Rust desktop build of HOOD using Bevy 0.15.3. It opens with a cinematic vehicle pass and an interactive mode/car picker before driving. It includes the fixed-step vehicle model, circuit gate/lap timing, Mombasa checkpoint sprints, asphalt and murram road surfaces, and building collisions. Nairobi and Mombasa route and world data are embedded from the repository, while vehicle models are loaded from the existing `source/` and `models/` directories.

## Run

Install a Rust toolchain with Cargo, then run from the repository root:

```sh
cargo run --release --manifest-path native/hood-bevy/Cargo.toml
```

The first build downloads Bevy dependencies. The release profile enables LTO and optimized dependency builds.

## Controls

| Key | Action |
| --- | --- |
| W / Up | Accelerate |
| S / Down | Brake / reverse |
| A,D / Left,Right | Steer |
| Space | Handbrake |
| Shift / N | Nitro |
| 1-0 | Select a route within the current mode |
| F1-F3 | Select vehicle |
| L | Cycle circuit lap count (1-5) |
| Tab | Cycle circuit, sprint, and free-drive modes |
| C | Toggle chase and overhead cameras |
| R | Reset the session |
| Escape / P | Pause |

This is an additive PC edition; the browser game remains unchanged. The native edition currently includes Nairobi circuits and the Mombasa sprint, circuit, and free-drive areas. Career progression, State House events, audio, and mobile input are not included.
