const STORAGE_KEY = 'hood.stats.v1';
const DEFAULT_CAR_IDS = ['dodge', 'subaru', 'nissan-skyline-r34-gt-r'];

const emptyStats = (carIds) => ({
  version: 1,
  cars: Object.fromEntries(carIds.map((id) => [
    id,
    { distanceM: 0, activeSeconds: 0, sessions: 0 }
  ])),
  sprints: {}
});

const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function normaliseStats(value, carIds) {
  const stats = emptyStats(carIds);
  if (!value || value.version !== 1 || typeof value !== 'object') return stats;

  for (const carId of carIds) {
    const source = value.cars?.[carId];
    if (!source || typeof source !== 'object') continue;
    for (const key of ['distanceM', 'activeSeconds', 'sessions']) {
      if (finiteNonNegative(source[key])) stats.cars[carId][key] = source[key];
    }
  }

  if (value.sprints && typeof value.sprints === 'object' && !Array.isArray(value.sprints)) {
    for (const [routeId, cars] of Object.entries(value.sprints)) {
      if (!routeId || !cars || typeof cars !== 'object' || Array.isArray(cars)) continue;
      stats.sprints[routeId] = {};
      for (const carId of carIds) {
        const sprint = cars[carId];
        if (!sprint || typeof sprint !== 'object' ||
            !Number.isFinite(sprint.bestSeconds) || sprint.bestSeconds <= 0 ||
            !finiteNonNegative(sprint.completed)) continue;
        stats.sprints[routeId][carId] = {
          bestSeconds: sprint.bestSeconds,
          completed: sprint.completed
        };
      }
      if (!Object.keys(stats.sprints[routeId]).length) delete stats.sprints[routeId];
    }
  }
  return stats;
}

export function createStatsStore(storage, configuredCarIds = DEFAULT_CAR_IDS) {
  const target = safeStorage(storage);
  const carIds = [...new Set(configuredCarIds.filter((id) => typeof id === 'string' && id))];
  const carIdSet = new Set(carIds);
  let stats = emptyStats(carIds);

  try {
    const raw = target?.getItem(STORAGE_KEY);
    if (raw) stats = normaliseStats(JSON.parse(raw), carIds);
  } catch { /* Storage can be blocked or contain invalid data. */ }

  const persist = () => {
    try { target?.setItem(STORAGE_KEY, JSON.stringify(stats)); return !!target; }
    catch { return false; }
  };

  return {
    snapshot() { return JSON.parse(JSON.stringify(stats)); },
    flush: persist,
    startSession(carId) {
      if (!carIdSet.has(carId)) return false;
      stats.cars[carId].sessions++;
      persist();
      return true;
    },
    addDrive(carId, distanceM, activeSeconds) {
      if (!carIdSet.has(carId) || !finiteNonNegative(distanceM) || !finiteNonNegative(activeSeconds)) return false;
      stats.cars[carId].distanceM += distanceM;
      stats.cars[carId].activeSeconds += activeSeconds;
      return true;
    },
    recordSprint({ routeId, carId, timeSeconds, checkpointsPassed, totalCheckpoints } = {}) {
      if (typeof routeId !== 'string' || !routeId || !carIdSet.has(carId) ||
          !Number.isFinite(timeSeconds) || timeSeconds <= 0 ||
          !Number.isInteger(totalCheckpoints) || totalCheckpoints <= 0 ||
          checkpointsPassed !== totalCheckpoints) return { saved: false, personalBest: false };

      const byCar = stats.sprints[routeId] ||= {};
      const previous = byCar[carId];
      const personalBest = !previous || timeSeconds < previous.bestSeconds;
      byCar[carId] = {
        bestSeconds: personalBest ? timeSeconds : previous.bestSeconds,
        completed: (previous?.completed || 0) + 1
      };
      persist();
      return { saved: true, personalBest, bestSeconds: byCar[carId].bestSeconds };
    }
  };
}
