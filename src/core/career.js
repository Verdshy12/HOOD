import { CONFIG } from '../config.js?garage-assets=6';

const STORAGE_KEY = 'hood.career.v1';
const CAREER_CIRCUIT_ROUTE_IDS = [
  'ngara-circuit-7',
  'ngara-circuit-6',
  'ngara-circuit-8',
  'ngara-circuit-5',
  'ngara-circuit-2',
  'ngara-circuit-3',
  'ngara-circuit-4',
  'ngara-circuit-1'
];
export const CAREER_CIRCUIT_EVENTS = CAREER_CIRCUIT_ROUTE_IDS.flatMap((routeId) =>
  [3, 5].map((laps) => ({
    id: `${routeId}-${laps}-laps`,
    routeId,
    laps
  }))
);
const BASE_ROUTE_ORDER = [
  'state-house-eastbound',
  'nairobi-ngara-sprint',
  'state-house-westbound'
];
export const CAREER_ROUTE_ORDER = [
  ...BASE_ROUTE_ORDER,
  ...CAREER_CIRCUIT_EVENTS.map((event) => event.id)
];
const ROUTE_ORDER = CAREER_ROUTE_ORDER;
const CIRCUIT_LEGACY_EVENTS = new Map(
  CAREER_CIRCUIT_EVENTS
    .filter((event) => event.laps === 3)
    .map((event) => [event.routeId, event.id])
);
const ROUTE_IDS = new Set([...ROUTE_ORDER, ...CIRCUIT_LEGACY_EVENTS.keys()]);
const CAR_UNLOCKS = new Map(
  Object.entries(CONFIG.cars).map(([id, car]) => [id, car.careerUnlockAt ?? 0])
);

const emptyCareer = () => ({ version: 1, profiles: [] });

function normaliseCareer(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.profiles)) return emptyCareer();
  const ids = new Set();
  const profiles = [];

  for (const source of value.profiles) {
    if (!source || typeof source.id !== 'string' || !source.id ||
        typeof source.name !== 'string' || !source.name || ids.has(source.id)) continue;
    ids.add(source.id);
    const completedRouteIds = Array.isArray(source.completedRouteIds)
      ? [...new Set(source.completedRouteIds
        .filter((id) => ROUTE_IDS.has(id))
        .map((id) => CIRCUIT_LEGACY_EVENTS.get(id) || id))]
      : [];
    profiles.push({
      id: source.id,
      name: source.name.slice(0, 24),
      createdAt: Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
      eventsCompleted: Number.isInteger(source.eventsCompleted) && source.eventsCompleted >= 0
        ? source.eventsCompleted
        : completedRouteIds.length,
      completedRouteIds
    });
  }
  return { version: 1, profiles };
}

function getStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createCareerStore(storage) {
  const target = getStorage(storage);
  let career = emptyCareer();
  try {
    const raw = target?.getItem(STORAGE_KEY);
    if (raw) career = normaliseCareer(JSON.parse(raw));
  } catch {
    career = emptyCareer();
  }

  const persist = () => {
    try { target?.setItem(STORAGE_KEY, JSON.stringify(career)); return !!target; }
    catch { return false; }
  };

  return {
    snapshot() {
      return clone(career);
    },
    isEventUnlocked(profileId, eventId) {
      const profile = career.profiles.find((item) => item.id === profileId);
      const milestone = ROUTE_ORDER.indexOf(eventId);
      return !!profile && milestone >= 0 && profile.eventsCompleted >= milestone;
    },
    isCarUnlocked(profileId, carId) {
      const profile = career.profiles.find((item) => item.id === profileId);
      const milestone = CAR_UNLOCKS.get(carId);
      return !!profile && milestone !== undefined && profile.eventsCompleted >= milestone;
    },
    addProfile(name) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (cleanName.length < 2 || cleanName.length > 24) {
        return { profile: null, persisted: false };
      }
      const profile = {
        id: globalThis.crypto?.randomUUID?.() || `driver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: cleanName,
        createdAt: Date.now(),
        eventsCompleted: 0,
        completedRouteIds: []
      };
      career.profiles.push(profile);
      return { profile: clone(profile), persisted: persist() };
    },
    completeEvent(profileId, eventId) {
      if (typeof profileId !== 'string' || !profileId || !ROUTE_ORDER.includes(eventId)) {
        return { saved: false, persisted: false };
      }
      const profile = career.profiles.find((item) => item.id === profileId);
      if (!profile) return { saved: false, persisted: false };
      const alreadyCompleted = profile.completedRouteIds.includes(eventId);
      if (!alreadyCompleted) {
        profile.completedRouteIds.push(eventId);
        profile.eventsCompleted = Math.max(profile.eventsCompleted, profile.completedRouteIds.length);
      }
      return {
        saved: true,
        persisted: persist(),
        eventsCompleted: profile.eventsCompleted,
        alreadyCompleted,
        completedRouteIds: [...profile.completedRouteIds]
      };
    }
  };
}
