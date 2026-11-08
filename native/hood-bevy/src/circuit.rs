use crate::world::RouteDef;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CircuitStatus {
    Ready,
    Racing,
    Finished,
}

#[derive(Clone, Copy, Debug)]
pub struct Gate {
    start_x: f32,
    start_z: f32,
    forward_x: f32,
    forward_z: f32,
    right_x: f32,
    right_z: f32,
    half_width: f32,
}

impl Gate {
    pub fn from_route(route: &RouteDef) -> Option<Self> {
        if route.pts.len() < 8 {
            return None;
        }
        let start_x = route.pts[0];
        let start_z = route.pts[1];
        let (dx, dz) = (1..route.pts.len() / 2)
            .map(|index| {
                (
                    route.pts[index * 2] - start_x,
                    route.pts[index * 2 + 1] - start_z,
                )
            })
            .find(|(dx, dz)| dx.hypot(*dz) > 0.01)?;
        let length = dx.hypot(dz);
        let (forward_x, forward_z) = (dx / length, dz / length);
        Some(Self {
            start_x,
            start_z,
            forward_x,
            forward_z,
            right_x: -forward_z,
            right_z: forward_x,
            half_width: (route.w * 0.75).max(4.0),
        })
    }

    fn side(self, x: f32, z: f32) -> f32 {
        (x - self.start_x) * self.forward_x + (z - self.start_z) * self.forward_z
    }

    fn offset(self, x: f32, z: f32) -> f32 {
        (x - self.start_x) * self.right_x + (z - self.start_z) * self.right_z
    }

    fn crossing(self, previous: (f32, f32), current: (f32, f32)) -> Option<f32> {
        let before = self.side(previous.0, previous.1);
        let after = self.side(current.0, current.1);
        if !(before < 0.0 && after >= 0.0) {
            return None;
        }
        let fraction = -before / (after - before);
        let x = previous.0 + (current.0 - previous.0) * fraction;
        let z = previous.1 + (current.1 - previous.1) * fraction;
        (self.offset(x, z).abs() <= self.half_width).then_some(fraction)
    }
}

#[derive(Clone, Debug)]
pub struct CircuitSession {
    pub route_id: String,
    pub status: CircuitStatus,
    pub target_laps: u8,
    pub completed_laps: u8,
    pub current_lap: Option<u8>,
    pub current_lap_ms: f64,
    pub last_lap_ms: Option<f64>,
    pub best_lap_ms: Option<f64>,
    pub lap_times_ms: Vec<f64>,
    gate: Gate,
    previous_position: Option<(f32, f32)>,
    previous_timestamp_ms: Option<f64>,
    lap_started_at_ms: Option<f64>,
    last_gate_at_ms: Option<f64>,
    min_lap_ms: f64,
}

impl CircuitSession {
    pub fn new(route: &RouteDef, target_laps: u8) -> Option<Self> {
        if !(1..=5).contains(&target_laps) {
            return None;
        }
        Some(Self {
            route_id: route.id.clone(),
            status: CircuitStatus::Ready,
            target_laps,
            completed_laps: 0,
            current_lap: None,
            current_lap_ms: 0.0,
            last_lap_ms: None,
            best_lap_ms: None,
            lap_times_ms: Vec::new(),
            gate: Gate::from_route(route)?,
            previous_position: None,
            previous_timestamp_ms: None,
            lap_started_at_ms: None,
            last_gate_at_ms: None,
            min_lap_ms: 5000.0,
        })
    }

    pub fn reset(&mut self, route: &RouteDef, target_laps: u8) {
        if let Some(session) = Self::new(route, target_laps) {
            *self = session;
        }
    }

    pub fn update(&mut self, x: f32, z: f32, timestamp_ms: f64) {
        if self.status == CircuitStatus::Finished || !x.is_finite() || !z.is_finite() {
            return;
        }
        let position = (x, z);
        let crossing = self
            .previous_position
            .and_then(|previous| self.gate.crossing(previous, position));
        if let (Some(fraction), Some(_previous), Some(previous_time)) =
            (crossing, self.previous_position, self.previous_timestamp_ms)
        {
            let crossing_time = previous_time + (timestamp_ms - previous_time) * fraction as f64;
            let can_count = self
                .last_gate_at_ms
                .map_or(true, |last| crossing_time - last >= self.min_lap_ms);
            if can_count {
                match self.status {
                    CircuitStatus::Ready => {
                        self.status = CircuitStatus::Racing;
                        self.current_lap = Some(1);
                        self.lap_started_at_ms = Some(crossing_time);
                        self.current_lap_ms = 0.0;
                        self.last_gate_at_ms = Some(crossing_time);
                    }
                    CircuitStatus::Racing => {
                        if let Some(started_at) = self.lap_started_at_ms {
                            let lap_time = crossing_time - started_at;
                            if lap_time >= self.min_lap_ms {
                                self.lap_times_ms.push(lap_time);
                                self.last_lap_ms = Some(lap_time);
                                self.best_lap_ms = Some(
                                    self.best_lap_ms.map_or(lap_time, |best| best.min(lap_time)),
                                );
                                self.completed_laps += 1;
                                self.last_gate_at_ms = Some(crossing_time);
                                if self.completed_laps >= self.target_laps {
                                    self.status = CircuitStatus::Finished;
                                    self.current_lap = None;
                                    self.current_lap_ms = 0.0;
                                } else {
                                    self.current_lap = Some(self.completed_laps + 1);
                                    self.lap_started_at_ms = Some(crossing_time);
                                    self.current_lap_ms = 0.0;
                                }
                            }
                        }
                    }
                    CircuitStatus::Finished => {}
                }
            }
        }
        self.previous_position = Some(position);
        self.previous_timestamp_ms = Some(timestamp_ms);
        if self.status == CircuitStatus::Racing {
            if let Some(started_at) = self.lap_started_at_ms {
                self.current_lap_ms = (timestamp_ms - started_at).max(0.0);
            }
        }
    }
}

pub fn format_lap_time(milliseconds: Option<f64>) -> String {
    let Some(milliseconds) = milliseconds.filter(|value| value.is_finite() && *value >= 0.0) else {
        return "--:--.---".to_owned();
    };
    let total_ms = milliseconds.floor() as u64;
    format!(
        "{:02}:{:02}.{:03}",
        total_ms / 60_000,
        (total_ms / 1_000) % 60,
        total_ms % 1_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route() -> RouteDef {
        RouteDef {
            id: "test-circuit".to_owned(),
            name: "Test circuit".to_owned(),
            city: String::new(),
            tile: String::new(),
            w: 8.0,
            pts: vec![0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0],
            mode: "circuit".to_owned(),
            circuit: true,
            checkpoints: Vec::new(),
        }
    }

    fn cross_gate(session: &mut CircuitSession, time_ms: f64) {
        session.update(-2.0, 0.0, time_ms);
        session.update(2.0, 0.0, time_ms + 100.0);
    }

    #[test]
    fn starts_then_finishes_the_requested_number_of_laps() {
        let route = route();
        let mut session = CircuitSession::new(&route, 2).unwrap();
        cross_gate(&mut session, 1000.0);
        assert_eq!(session.status, CircuitStatus::Racing);
        cross_gate(&mut session, 21_000.0);
        cross_gate(&mut session, 41_000.0);
        assert_eq!(session.status, CircuitStatus::Finished);
        assert_eq!(session.completed_laps, 2);
        assert_eq!(session.lap_times_ms, vec![20_000.0, 20_000.0]);
    }

    #[test]
    fn rejects_reverse_and_out_of_bounds_start_line_crossings() {
        let route = route();
        let mut session = CircuitSession::new(&route, 3).unwrap();
        session.update(2.0, 0.0, 1000.0);
        session.update(-2.0, 0.0, 1100.0);
        assert_eq!(session.status, CircuitStatus::Ready);
        session.update(-2.0, 20.0, 2000.0);
        session.update(2.0, 20.0, 2100.0);
        assert_eq!(session.status, CircuitStatus::Ready);
    }

    #[test]
    fn formats_lap_times() {
        assert_eq!(format_lap_time(Some(125_430.0)), "02:05.430");
        assert_eq!(format_lap_time(None), "--:--.---");
    }
}
