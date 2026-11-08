use bevy::prelude::Component;

const G: f32 = 9.81;

#[derive(Clone, Copy, Debug)]
pub struct VehiclePhysics {
    pub mass: f32,
    pub wheel_radius: f32,
    pub wheelbase: f32,
    pub final_drive: f32,
    pub efficiency: f32,
    pub idle_rpm: f32,
    pub redline_rpm: f32,
    pub ratios: &'static [f32],
    pub reverse_ratio: f32,
    pub drag: f32,
    pub max_reverse: f32,
    pub grip: f32,
    pub steer_lock: f32,
    pub acceleration: f32,
    pub braking: f32,
    pub max_speed: f32,
    pub peak_torque: f32,
    pub peak_torque_rpm: f32,
    pub torque_floor: f32,
    pub torque_curve_width: f32,
}

pub const DEFAULT_RATIOS: &[f32] = &[4.71, 3.14, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67];
pub const GTR_RATIOS: &[f32] = &[4.056, 2.301, 1.595, 1.248, 1.001, 0.796];

pub const DODGE: VehiclePhysics = VehiclePhysics {
    mass: 1900.0,
    wheel_radius: 0.34,
    wheelbase: 2.95,
    final_drive: 3.09,
    efficiency: 0.9,
    idle_rpm: 850.0,
    redline_rpm: 6400.0,
    ratios: DEFAULT_RATIOS,
    reverse_ratio: 3.5,
    drag: 0.70,
    max_reverse: 12.0,
    grip: 1.15,
    steer_lock: 0.62,
    acceleration: 1.0,
    braking: 1.0,
    max_speed: f32::INFINITY,
    peak_torque: 560.0,
    peak_torque_rpm: 4300.0,
    torque_floor: 180.0,
    torque_curve_width: 5200.0,
};

pub const SUBARU: VehiclePhysics = DODGE;
pub const SKYLINE_R34: VehiclePhysics = DODGE;
pub const GTR35: VehiclePhysics = VehiclePhysics {
    mass: 1740.0,
    wheel_radius: 0.36,
    wheelbase: 2.78,
    final_drive: 3.70,
    efficiency: 0.90,
    idle_rpm: 650.0,
    redline_rpm: 7000.0,
    ratios: GTR_RATIOS,
    reverse_ratio: 3.5,
    drag: 0.75,
    max_reverse: 12.0,
    grip: 1.15,
    steer_lock: 0.58,
    acceleration: 1.0,
    braking: 1.0,
    max_speed: 200.0 / 3.6,
    peak_torque: 588.0,
    peak_torque_rpm: 4500.0,
    torque_floor: 180.0,
    torque_curve_width: 5200.0,
};

#[derive(Clone, Copy, Debug, Default)]
pub struct Surface {
    pub mu: f32,
    pub roll: f32,
    pub roughness: f32,
}

impl Surface {
    pub const ASPHALT: Self = Self {
        mu: 1.0,
        roll: 0.015,
        roughness: 0.0,
    };

    pub const GRASS: Self = Self {
        mu: 0.55,
        roll: 0.08,
        roughness: 0.0,
    };

    pub const MURRAM: Self = Self {
        mu: 0.72,
        roll: 0.04,
        roughness: 0.0,
    };
}

#[derive(Clone, Copy, Debug)]
pub struct Controls {
    pub throttle: f32,
    pub brake: f32,
    pub steer: f32,
    pub handbrake: bool,
    pub nitro: bool,
}

impl Default for Controls {
    fn default() -> Self {
        Self {
            throttle: 0.0,
            brake: 0.0,
            steer: 0.0,
            handbrake: false,
            nitro: false,
        }
    }
}

#[derive(Clone, Debug, Component)]
pub struct Vehicle {
    pub x: f32,
    pub z: f32,
    pub psi: f32,
    pub vx: f32,
    pub vz: f32,
    pub yaw_rate: f32,
    pub rpm: f32,
    pub gear: usize,
    pub shift_timer: f32,
    pub throttle: f32,
    pub nitro: f32,
    pub reverse: bool,
    pub speed: f32,
    pub u: f32,
    pub v: f32,
    pub a_long: f32,
    pub a_lat: f32,
    pub slip: f32,
    pub boosting: bool,
    pub drifting: bool,
    pub wheel_angle: f32,
    pub wheel_spin: f32,
    pub suspension_y: f32,
    pub suspension_velocity: f32,
    pub suspension_pitch: f32,
    pub suspension_pitch_velocity: f32,
    pub suspension_roll: f32,
    pub suspension_roll_velocity: f32,
}

impl Vehicle {
    pub fn new(x: f32, z: f32, psi: f32, physics: VehiclePhysics) -> Self {
        Self {
            x,
            z,
            psi,
            vx: 0.0,
            vz: 0.0,
            yaw_rate: 0.0,
            rpm: physics.idle_rpm,
            gear: 0,
            shift_timer: 0.0,
            throttle: 0.0,
            nitro: 1.0,
            reverse: false,
            speed: 0.0,
            u: 0.0,
            v: 0.0,
            a_long: 0.0,
            a_lat: 0.0,
            slip: 0.0,
            boosting: false,
            drifting: false,
            wheel_angle: 0.0,
            wheel_spin: 0.0,
            suspension_y: 0.0,
            suspension_velocity: 0.0,
            suspension_pitch: 0.0,
            suspension_pitch_velocity: 0.0,
            suspension_roll: 0.0,
            suspension_roll_velocity: 0.0,
        }
    }
}

fn clamp(value: f32, low: f32, high: f32) -> f32 {
    value.min(high).max(low)
}

fn damp(from: f32, to: f32, lambda: f32, dt: f32) -> f32 {
    from + (to - from) * (1.0 - (-lambda * dt).exp())
}

fn torque(rpm: f32, physics: VehiclePhysics) -> f32 {
    (physics.peak_torque
        * (1.0 - ((rpm - physics.peak_torque_rpm) / physics.torque_curve_width).powi(2)))
    .max(physics.torque_floor)
}

pub fn step_vehicle(
    state: &mut Vehicle,
    controls: Controls,
    surface: Surface,
    dt: f32,
    physics: VehiclePhysics,
) {
    let mu = if surface.mu > 0.0 { surface.mu } else { 1.0 };
    let roll = if surface.roll > 0.0 {
        surface.roll
    } else {
        0.015
    };
    let handbrake = controls.handbrake;
    let previous_forward_speed = state.u;
    let absolute_speed = previous_forward_speed.abs();
    let steering_lock = physics.steer_lock / (1.0 + (absolute_speed / 12.0).powf(1.3));
    let lateral_grip = mu * G * physics.grip * (if handbrake { 0.35 } else { 1.0 });

    state.drifting = handbrake && absolute_speed > 8.0;
    let mut target_yaw_rate = (previous_forward_speed / physics.wheelbase)
        * (clamp(controls.steer, -1.0, 1.0) * steering_lock).tan();
    if state.drifting {
        target_yaw_rate *= 1.3;
        if state.throttle > 0.3 {
            target_yaw_rate += controls.steer * state.throttle * 0.5;
        }
    } else {
        let max_yaw_rate = 1.25 * lateral_grip / absolute_speed.max(2.0);
        target_yaw_rate = clamp(target_yaw_rate, -max_yaw_rate, max_yaw_rate);
    }
    state.yaw_rate = damp(state.yaw_rate, target_yaw_rate, 10.0, dt);
    state.psi += state.yaw_rate * dt;
    if state.psi > std::f32::consts::PI {
        state.psi -= std::f32::consts::TAU;
    } else if state.psi < -std::f32::consts::PI {
        state.psi += std::f32::consts::TAU;
    }

    let (sin_heading, cos_heading) = state.psi.sin_cos();
    let (forward_x, forward_z) = (sin_heading, -cos_heading);
    let (right_x, right_z) = (cos_heading, sin_heading);
    let forward_speed = state.vx * forward_x + state.vz * forward_z;
    let lateral_speed = state.vx * right_x + state.vz * right_z;

    if controls.brake > 0.1 && forward_speed < 0.5 && controls.throttle < 0.05 {
        state.reverse = true;
    } else if controls.throttle > 0.1 && forward_speed > -0.5 {
        state.reverse = false;
    }
    let gas = if state.reverse {
        controls.brake
    } else {
        controls.throttle
    };
    let brake = if state.reverse {
        controls.throttle
    } else {
        controls.brake
    };
    state.throttle = damp(
        state.throttle,
        gas,
        if gas > state.throttle { 6.0 } else { 10.0 },
        dt,
    );
    state.boosting = controls.nitro && state.nitro > 0.02 && gas > 0.1 && !state.reverse;
    state.nitro = clamp(
        state.nitro + (if state.boosting { -0.22 } else { 0.05 }) * dt,
        0.0,
        1.0,
    );

    let gear_ratio = (if state.reverse {
        physics.reverse_ratio
    } else {
        physics.ratios[state.gear.min(physics.ratios.len() - 1)]
    }) * physics.final_drive;
    let driven_rpm =
        ((forward_speed.abs() / physics.wheel_radius) * 60.0 / std::f32::consts::TAU) * gear_ratio;
    state.shift_timer = (state.shift_timer - dt).max(0.0);
    state.rpm = damp(
        state.rpm,
        if forward_speed.abs() < 4.0 {
            physics.idle_rpm + state.throttle * 3200.0
        } else {
            physics.idle_rpm.max(driven_rpm)
        },
        if state.shift_timer > 0.0 { 7.0 } else { 14.0 },
        dt,
    );
    if !state.reverse && state.shift_timer == 0.0 {
        if state.rpm > physics.redline_rpm - 350.0
            && state.gear < physics.ratios.len() - 1
            && state.throttle > 0.3
        {
            state.gear += 1;
            state.shift_timer = 0.22;
        } else if state.gear > 0
            && driven_rpm
                < if state.throttle > 0.85 {
                    3400.0
                } else {
                    1800.0
                }
            && absolute_speed > 3.0
        {
            state.gear -= 1;
            state.shift_timer = 0.18;
        } else if absolute_speed < 2.5 {
            state.gear = 0;
        }
    }
    state.rpm = clamp(state.rpm, physics.idle_rpm, physics.redline_rpm);

    let mut drive_force = if state.shift_timer > 0.0 {
        0.0
    } else {
        (torque(state.rpm, physics)
            * state.throttle
            * (if state.boosting { 1.35 } else { 1.0 })
            * gear_ratio
            * physics.efficiency
            * physics.acceleration)
            / physics.wheel_radius
    };
    drive_force = drive_force.min(physics.mass * G * mu * if handbrake { 0.45 } else { 0.9 });
    if state.reverse && -forward_speed > physics.max_reverse {
        drive_force = 0.0;
    }
    let drive_sign = if state.reverse { -1.0 } else { 1.0 };
    let drag_force = physics.drag * forward_speed * forward_speed.abs();
    let mut new_forward_speed =
        forward_speed + ((drive_sign * drive_force - drag_force) / physics.mass) * dt;
    let resistance_force = brake * physics.braking * physics.mass * G * mu * 1.05
        + (if handbrake {
            0.3 * physics.mass * G * mu
        } else {
            0.0
        })
        + roll * physics.mass * G
        + 0.04 * physics.mass * G * (1.0 - state.throttle) * (absolute_speed / 5.0).min(1.0);
    let deceleration = resistance_force / physics.mass * dt;
    new_forward_speed = if new_forward_speed.abs() <= deceleration {
        0.0
    } else {
        new_forward_speed - new_forward_speed.signum() * deceleration
    };
    new_forward_speed = new_forward_speed.min(physics.max_speed);

    let slip_now = (lateral_speed / forward_speed.abs().max(0.5)).atan().abs();
    let recovery = 1.0 + 1.5 * clamp((slip_now - 0.6) / 0.5, 0.0, 1.0);
    let mut new_lateral_speed = lateral_speed
        - clamp(
            lateral_speed,
            -lateral_grip * recovery * dt,
            lateral_grip * recovery * dt,
        );
    if absolute_speed < 3.0 {
        new_lateral_speed *= (-8.0 * dt).exp();
    }

    state.vx = new_forward_speed * forward_x + new_lateral_speed * right_x;
    state.vz = new_forward_speed * forward_z + new_lateral_speed * right_z;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    state.a_long = (new_forward_speed - forward_speed) / dt;
    state.a_lat = new_forward_speed * state.yaw_rate;

    let suspension_dt = dt.min(0.05);
    let pitch_target = clamp(state.a_long * 0.0028, -0.055, 0.045);
    let roll_target = clamp(-state.a_lat * 0.0038, -0.075, 0.075);
    state.suspension_pitch_velocity += ((pitch_target - state.suspension_pitch) * 42.0
        - state.suspension_pitch_velocity * 12.0)
        * suspension_dt;
    state.suspension_pitch += state.suspension_pitch_velocity * suspension_dt;
    state.suspension_roll_velocity += ((roll_target - state.suspension_roll) * 38.0
        - state.suspension_roll_velocity * 11.0)
        * suspension_dt;
    state.suspension_roll += state.suspension_roll_velocity * suspension_dt;

    let roughness = surface.roughness.max(0.0);
    let road_input = roughness * (state.x * 7.1).sin() * (state.z * 5.7).sin();
    state.suspension_velocity += (-state.suspension_y * 48.0 - state.suspension_velocity * 12.0
        + road_input)
        * suspension_dt;
    state.suspension_y = clamp(
        state.suspension_y + state.suspension_velocity * suspension_dt,
        -0.16,
        0.12,
    );

    state.u = new_forward_speed;
    state.v = new_lateral_speed;
    state.speed = state.vx.hypot(state.vz);
    state.slip = (new_lateral_speed / new_forward_speed.abs().max(0.1)).atan();
    state.wheel_angle = clamp(controls.steer, -1.0, 1.0) * steering_lock;
    state.wheel_spin -= (new_forward_speed / physics.wheel_radius) * dt;
}

#[derive(Clone, Copy, Debug)]
pub struct Impact {
    pub normal_x: f32,
    pub normal_z: f32,
    pub depth: f32,
}

pub fn apply_impact(state: &mut Vehicle, impact: Impact) -> f32 {
    state.x += impact.normal_x * impact.depth;
    state.z += impact.normal_z * impact.depth;
    let normal_velocity = state.vx * impact.normal_x + state.vz * impact.normal_z;
    if normal_velocity >= 0.0 {
        return 0.0;
    }
    state.vx -= 1.2 * normal_velocity * impact.normal_x;
    state.vz -= 1.2 * normal_velocity * impact.normal_z;
    let tangent_x = -impact.normal_z;
    let tangent_z = impact.normal_x;
    let tangent_velocity = state.vx * tangent_x + state.vz * tangent_z;
    state.vx -= tangent_velocity * 0.1 * tangent_x;
    state.vz -= tangent_velocity * 0.1 * tangent_z;
    state.yaw_rate *= 0.6;
    let impact_speed = -normal_velocity;
    state.suspension_velocity += (impact_speed * 0.045).min(1.8);
    impact_speed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_accelerates_brakes_and_reverse_works() {
        let mut vehicle = Vehicle::new(0.0, 0.0, 0.0, DODGE);
        for _ in 0..120 {
            step_vehicle(
                &mut vehicle,
                Controls {
                    throttle: 0.8,
                    ..default_controls()
                },
                Surface::ASPHALT,
                1.0 / 120.0,
                DODGE,
            );
        }
        assert!(vehicle.speed > 1.0);
        for _ in 0..600 {
            if vehicle.u.abs() < 0.5 {
                break;
            }
            step_vehicle(
                &mut vehicle,
                Controls {
                    brake: 1.0,
                    ..default_controls()
                },
                Surface::ASPHALT,
                1.0 / 120.0,
                DODGE,
            );
        }
        assert!(vehicle.speed < 0.5);
        assert!(!vehicle.reverse);

        for _ in 0..120 * 10 {
            step_vehicle(
                &mut vehicle,
                Controls {
                    brake: 1.0,
                    ..default_controls()
                },
                Surface::ASPHALT,
                1.0 / 120.0,
                DODGE,
            );
        }
        assert!(vehicle.u < -5.0 && vehicle.u > -13.0);
    }

    fn default_controls() -> Controls {
        Controls::default()
    }
}
