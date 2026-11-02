// HOOD Circuit Timing Engine
// Independent of Three.js, DOM and rendering.

export const CIRCUIT_LAP_OPTIONS = Object.freeze([3, 5]);

const DEFAULT_MIN_LAP_MS = 5000;

function getRouteGeometry(route) {
  if (!route || !Array.isArray(route.pts) || route.pts.length < 8) {
    throw new Error('Circuit requires at least four route points.');
  }

  const points = [];

  for (let i = 0; i < route.pts.length; i += 2) {
    points.push({
      x: Number(route.pts[i]),
      z: Number(route.pts[i + 1])
    });
  }

  const start = points[0];
  let next = null;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - start.x;
    const dz = points[i].z - start.z;

    if (Math.hypot(dx, dz) > 0.01) {
      next = { dx, dz };
      break;
    }
  }

  if (!next) {
    throw new Error('Circuit has no usable starting direction.');
  }

  const length = Math.hypot(next.dx, next.dz);
  const forward = {
    x: next.dx / length,
    z: next.dz / length
  };

  // Right-hand perpendicular to the route direction.
  const right = {
    x: -forward.z,
    z: forward.x
  };

  return {
    start,
    forward,
    right,
    halfWidth: Math.max(4, (Number(route.w) || 8) * 0.75)
  };
}

function gateSide(position, gate) {
  return (
    (position.x - gate.start.x) * gate.forward.x +
    (position.z - gate.start.z) * gate.forward.z
  );
}

function gateOffset(position, gate) {
  return (
    (position.x - gate.start.x) * gate.right.x +
    (position.z - gate.start.z) * gate.right.z
  );
}

function detectGateCrossing(previous, current, gate) {
  if (!previous || !current) return null;

  const before = gateSide(previous, gate);
  const after = gateSide(current, gate);

  // Only count crossings in the forward direction.
  if (!(before < 0 && after >= 0)) return null;

  const denominator = after - before;
  if (denominator <= 0) return null;

  const fraction = -before / denominator;

  const crossing = {
    x: previous.x + (current.x - previous.x) * fraction,
    z: previous.z + (current.z - previous.z) * fraction
  };

  const lateralOffset = Math.abs(gateOffset(crossing, gate));

  if (lateralOffset > gate.halfWidth) return null;

  return fraction;
}

export function createCircuitSession({
  route,
  routeId = route?.id,
  laps = 3,
  minLapMs = DEFAULT_MIN_LAP_MS
} = {}) {
  if (!CIRCUIT_LAP_OPTIONS.includes(laps)) {
    throw new Error('Circuit events support 3 or 5 laps.');
  }

  if (!routeId) {
    throw new Error('A circuit route ID is required.');
  }

  const gate = getRouteGeometry(route);

  return {
    routeId,
    targetLaps: laps,
    minLapMs,
    status: 'ready',

    completedLaps: 0,
    currentLap: null,

    lapStartedAt: null,
    currentLapMs: 0,
    lastLapMs: null,
    bestLapMs: null,

    lapTimes: [],

    gate,
    previousPosition: null,
    lastGateAt: null
  };
}

export function updateCircuitSession(session, position, timestamp) {
  if (!session || !position) return getCircuitSnapshot(session);

  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    return getCircuitSnapshot(session);
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error('Circuit timestamp must be milliseconds.');
  }

  if (session.status === 'finished') {
    return getCircuitSnapshot(session);
  }

  const current = {
    x: position.x,
    z: position.z
  };

  const crossing = detectGateCrossing(
    session.previousPosition,
    current,
    session.gate
  );

  if (crossing !== null) {
    const previous = session.previousPosition;
    const before = gateSide(previous, session.gate);
    const after = gateSide(current, session.gate);

    const crossingAt = timestamp -
      (timestamp - (session.previousTimestamp ?? timestamp)) *
      (1 - crossing);

    const canCount = session.lastGateAt === null ||
      crossingAt - session.lastGateAt >= session.minLapMs;

    if (canCount) {
      if (session.status === 'ready') {
        // First crossing starts the event; it is not a completed lap.
        session.status = 'racing';
        session.currentLap = 1;
        session.lapStartedAt = crossingAt;
        session.currentLapMs = 0;
        session.lastGateAt = crossingAt;
      } else {
        const lapTime = crossingAt - session.lapStartedAt;

        if (lapTime >= session.minLapMs) {
          session.lapTimes.push(lapTime);
          session.lastLapMs = lapTime;
          session.bestLapMs = session.bestLapMs === null
            ? lapTime
            : Math.min(session.bestLapMs, lapTime);

          session.completedLaps++;
          session.lastGateAt = crossingAt;

          if (session.completedLaps >= session.targetLaps) {
            session.status = 'finished';
            session.currentLap = null;
            session.currentLapMs = 0;
          } else {
            session.currentLap = session.completedLaps + 1;
            session.lapStartedAt = crossingAt;
            session.currentLapMs = 0;
          }
        }
      }
    }
  }

  session.previousPosition = current;
  session.previousTimestamp = timestamp;

  if (session.status === 'racing') {
    session.currentLapMs = Math.max(
      0,
      timestamp - session.lapStartedAt
    );
  }

  return getCircuitSnapshot(session);
}

export function resetCircuitSession(session) {
  if (!session) return null;

  return createCircuitSession({
    route: {
      id: session.routeId,
      w: session.gate.halfWidth / 0.75,
      pts: [
        session.gate.start.x,
        session.gate.start.z,
        session.gate.start.x + session.gate.forward.x,
        session.gate.start.z + session.gate.forward.z,
        session.gate.start.x,
        session.gate.start.z
      ]
    },
    routeId: session.routeId,
    laps: session.targetLaps,
    minLapMs: session.minLapMs
  });
}

export function getCircuitSnapshot(session) {
  if (!session) return null;

  return {
    routeId: session.routeId,
    status: session.status,
    targetLaps: session.targetLaps,
    completedLaps: session.completedLaps,
    currentLap: session.currentLap,
    currentLapMs: session.currentLapMs,
    lastLapMs: session.lastLapMs,
    bestLapMs: session.bestLapMs,
    lapTimes: [...session.lapTimes]
  };
}

export function formatLapTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return '--:--.---';
  }

  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = Math.floor(milliseconds % 1000);

  return `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}.` +
    `${String(millis).padStart(3, '0')}`;
}
