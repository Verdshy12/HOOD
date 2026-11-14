/* src/main.js — composition root.
 *Creates systems, wires them, owns nothing else. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG as C } from './config.js';
import { createLoop } from './core/loop.js';
import { createRenderer, createDebugOverlay } from './core/renderer.js?v=1.2.5';
import { QualityScaler } from './core/quality.js';
import { createInput } from './core/input.js?v=1.2.12';
import {
  createVehicle, stepVehicle, applyImpact
} from './car/vehicle.js';
import { resolveVehiclePhysics }from './physics/vehicleProfiles.js';
import { rigCar } from './car/carRig.js';
import { StaticWorld, collideCar } from './world/staticWorld.js';
import { WorldVisualChunks, WorldVisualStream, WORLD_CHUNK_SIZE } from './world/visualChunks.js';
import { buildRoute, sampleAt, trackProgress } from './world/routes.js';
import { preloadMusic } from '../music/preload.js';
import { rigSteeringWheel, flashMesh, scanNearby, previewSplit } from './car/steeringWheel.js';
import { createCarLights } from './car/carLights.js';
import { createStatsStore } from './core/persistence.js';
import { CAREER_CIRCUIT_EVENTS, createCareerStore } from './core/career.js';
import {
  createCircuitSession,
  formatLapTime,
  updateCircuitSession
} from './core/circuit.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function applyCarProfileAppearance(modelScene, carConfig) {
  if (!carConfig.bodyColor || !Array.isArray(carConfig.paintMaterials)) return;
  const paintMaterials = new Set(carConfig.paintMaterials);
  const paint = (material) => {
    if (!paintMaterials.has(material.name)) return material;
    const variant = material.clone();
    variant.color.set(carConfig.bodyColor);
    variant.needsUpdate = true;
    return variant;
  };
  modelScene.traverse((object) => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(paint)
      : paint(object.material);
  });
}

// Only touches the DOM when the value actually changes.
const text = (() => {
  const cache = {};
  return (id, value) => {
    if (cache[id] !== value) {
      cache[id] = value;
      const element = $(id);
      if (element) element.textContent = value;
    }
  };
})();

function drawTachometerScale() {
  const namespace = 'http://www.w3.org/2000/svg';
  const centerX = 130;
  const centerY = 130;
  const createMark = (parent, value, max, innerRadius, outerRadius, className) => {
    const angle = THREE.MathUtils.degToRad(135 + value / max * 270);
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * outerRadius;
    const y2 = centerY + Math.sin(angle) * outerRadius;
    const mark = document.createElementNS(namespace, 'path');
    mark.setAttribute('d', `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`);
    mark.setAttribute('class', className);
    parent.append(mark);
  };
  const createLabel = (parent, value, max, radius) => {
    const angle = THREE.MathUtils.degToRad(135 + value / max * 270);
    const label = document.createElementNS(namespace, 'text');
    label.setAttribute('x', (centerX + Math.cos(angle) * radius).toFixed(2));
    label.setAttribute('y', (centerY + Math.sin(angle) * radius).toFixed(2));
    label.textContent = String(value);
    parent.append(label);
  };

  const ticks = $('tachometer-ticks');
  const labels = $('tachometer-labels');
  if (!ticks || !labels) return;

  for (let rpm = 0; rpm <= 8000; rpm += 250) {
    const major = rpm % 1000 === 0;
    const medium = rpm % 500 === 0;
    createMark(
      ticks,
      rpm,
      8000,
      major ? 99 : medium ? 104 : 108,
      116,
      `${major ? 'major' : medium ? 'medium' : 'minor'}${rpm >= 6500 ? ' redline' : ''}`
    );
    if (major && rpm % 2000 === 0) createLabel(labels, rpm / 1000, 8000, 88);
  }
}

drawTachometerScale();

const debug = new URLSearchParams(location.search).has('debug');
const mobileLayoutQuery = matchMedia('(max-width: 700px), (pointer: coarse)');
const updateMobileLayout = () => document.body.classList.toggle('mobile-layout', mobileLayoutQuery.matches);
updateMobileLayout();
mobileLayoutQuery.addEventListener('change', updateMobileLayout);

// Safe fallback if #app-shell is not in index.html
const shell = $('app-shell') || document.documentElement;
const fsSupported = !!(shell?.requestFullscreen || shell?.webkitRequestFullscreen);
const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const fsEnter = () => shell.requestFullscreen
? shell.requestFullscreen({ navigationUI: 'hide' })
: shell.webkitRequestFullscreen?.();
const fsExit = () => document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
const lockLandscape = async () => {
  try { await screen.orientation.lock('landscape'); return true; } catch { return false; }
};

const fullscreenButtons = [$('fullscreenBtn')].filter(Boolean);
if (!fsSupported) fullscreenButtons.forEach((b) => { b.style.display = 'none'; });

const updateFullscreenButton = () => {
  const active = fsActive();
  fullscreenButtons.forEach((button) => {
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = active ? 'Exit fullscreen' : 'Fullscreen';
  });
};
const toggleFullscreen = async () => {
  try {
    if (fsActive()) {
      await fsExit();
      try { screen.orientation?.unlock?.(); } catch { /* optional */ }
    } else {
      await fsEnter();
      if (mobileLayoutQuery.matches) await lockLandscape();
    }
  } catch {
    const button = $('fullscreenBtn');
    if (button) button.title = 'Install HOOD to hide browser controls';
  }
  updateFullscreenButton();
};
fullscreenButtons.forEach((button) => button.addEventListener('click', toggleFullscreen));

$('orientationGateBtn')?.addEventListener('click', async () => {
  if (!mobileLayoutQuery.matches) return;
  try { if (fsSupported && !fsActive()) await fsEnter(); } catch { /* fall through */ }
  if (!(await lockLandscape())) $('orientationGateBtn').textContent = 'ROTATE PHONE MANUALLY';
});
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

(function checkConfig() {
  const required = [
    'car.model', 'car.targetLength', 'car.headingOffset', 'car.chase', 'car.chaseLook', 'car.cockpit',
    'routes.file', 'map.tile',
    'gfx.maxPixelRatio', 'gfx.minScale', 'gfx.targetFps', 'gfx.sky', 'gfx.fogNear', 'gfx.fogFar',
    'sim.fixedDt', 'sim.maxSubSteps'
  ];
  const missing = required.filter((path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C) === undefined);
  if (missing.length) {
    const msg = 'config.js is missing: ' + missing.join(', ');
    console.error('[HOOD] ' + msg);
    throw new Error(msg);
  }
})();

const game = {
  ready: false,
  routeReady: false,
  routeLoading: false,
  started: false,
  error: null,
  sim: null,
  world: null,
  stats: {},
  paused: false,
  userPaused: false,
  sprintFinished: false,
  circuit: null,
  sessionDistanceM: 0,
  sessionActiveSeconds: 0
};

window.__game = game;

let startRequested = false;
let loop = null;
const statsStore = createStatsStore(undefined, Object.keys(C.cars || {}));
const careerStore = createCareerStore();
let pendingDriveDistance = 0;
let pendingDriveSeconds = 0;
let statsFlushTimer = 0;
let dashboardUpdateTimer = 0;
let activeMenuView = 'home';
let engine = null;
let camSet = [];
let camIndex = 0;
let nextViewGestureAt = 0;
let cockpitFov = 75;
let cockpitOffset = 0;
let cockpitOffsetY = 0;
let cockpitPointerX = null;
let cockpitPointerY = null;
const touchPoints = new Map();
let pinchDistance = 0;
let headlightsOn = false;
let lightsMsgUntil = 0;

function flushDriveStats() {
  if (pendingDriveDistance || pendingDriveSeconds) {
    statsStore.addDrive(game.session?.carId, pendingDriveDistance, pendingDriveSeconds);
    pendingDriveDistance = 0;
    pendingDriveSeconds = 0;
  }
  statsStore.flush();
}

function syncRunState() {
  const portraitPaused = game.started && portraitGate.matches;
  const visibilityPaused = game.started && document.hidden;
  game.paused = game.userPaused || portraitPaused || visibilityPaused || game.sprintFinished;
  input?.setEnabled(!game.paused);
  if (game.paused) loop?.stop();
  else if (game.started) loop?.start();
  const pauseMenu = $('pauseOverlay');
  if (pauseMenu) pauseMenu.hidden = !game.userPaused || game.sprintFinished;
}

function showMenuView(view) {
  activeMenuView = view;
  $('menuHome').hidden = view !== 'home';
  $('dashboardView').hidden = view !== 'dashboard';
  $('controlsView').hidden = view !== 'controls';
  if (view === 'home') {
    const mode = game.session?.profileId
      ? 'Career'
      : game.session?.mode === 'race' ? 'Sprint'
        : game.session?.mode === 'circuit' ? 'Circuit' : 'Free Drive';
    text('pauseTitle', `${mode} menu`);
    text('goToModeMenuBtn', `${mode} mode menu`);
  }
  if (view === 'dashboard') updateDriverStats();
}

function setUserPaused(paused) {
  if ((!game.started && !paused) || game.sprintFinished) return;
  game.userPaused = paused;
  if (paused) showMenuView('home');
  syncRunState();
}

function formatDriveTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return hours ? `${hours}H ${(minutes % 60).toString().padStart(2, '0')}M` : `${minutes}:${remainder}`;
}

function completeCareerEvent() {
  if (!game.session?.profileId) return;
  const progress = careerStore.completeEvent(
    game.session.profileId,
    game.session.careerEventId
  );
  if (progress.saved && !progress.persisted) {
    console.warn('[HOOD] Career progress could not be saved to local storage.');
  }
}

function eventLeaderboard(timeMs) {
  const profile = game.session?.profileId
    ? careerStore.snapshot().profiles.find((item) => item.id === game.session.profileId)
    : null;
  return {
    driverName: profile?.name || 'YOU',
    carName: game.carConfigs?.[game.session?.carId]?.name || game.session?.carId || 'VEHICLE',
    timeMs
  };
}

function updateDriverStats() {
  const carId = game.session?.carId;
  const saved = statsStore.snapshot();
  const cars = Object.values(saved.cars);
  text('sessionDistance', `${(game.sessionDistanceM / 1000).toFixed(2)} KM`);
  text('sessionTime', formatDriveTime(game.sessionActiveSeconds));
  text('dashboardRoute', game.route?.name || '—');
  text('dashboardLocation', game.currentLocation || '—');
  text('dashboardRemaining', game.routeRemaining || '—');
  text('dashboardEta', game.routeEta || '—');
  text('lifetimeDistance', `${(cars.reduce((sum, item) => sum + item.distanceM, 0) / 1000).toFixed(1)} KM`);
  text('lifetimeTime', formatDriveTime(cars.reduce((sum, item) => sum + item.activeSeconds, 0)));
  text('sessionCount', String(cars.reduce((sum, item) => sum + item.sessions, 0)));
  for (const id of ['dodge', 'subaru']) {
    const car = saved.cars[id] || { distanceM: 0, activeSeconds: 0, sessions: 0 };
    text(`${id}Distance`, `${(car.distanceM / 1000).toFixed(1)} KM`);
    text(`${id}Time`, formatDriveTime(car.activeSeconds));
    text(`${id}Sessions`, String(car.sessions));
    const best = saved.sprints[game.session?.routeId]?.[id];
    text(`${id}SprintBest`, best ? `${best.bestSeconds.toFixed(1)} S` : '—');
  }
  const records = $('sprintRecords');
  if (records) {
    records.replaceChildren();
    const sprintEntries = Object.entries(saved.sprints);
    if (!sprintEntries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No completed sprints.';
      records.append(empty);
    }
    for (const [routeId, routeCars] of sprintEntries) {
      const routeName = engine?.routesData.routes.find((route) => route.id === routeId)?.name || routeId;
      for (const id of Object.keys(saved.cars)) {
        const record = routeCars[id];
        if (!record) continue;
        const row = document.createElement('div');
        row.className = 'sprint-record';
        const label = document.createElement('span');
        label.textContent = `${routeName} · ${id.toUpperCase()}`;
        const value = document.createElement('strong');
        value.textContent = `${record.bestSeconds.toFixed(1)} S · ${record.completed} RUNS`;
        row.append(label, value);
        records.append(row);
      }
    }
  }
  const sprint = carId ? saved.sprints[game.session?.routeId]?.[carId] : null;
  text('sprintBest', sprint ? `${sprint.bestSeconds.toFixed(1)} S` : '—');
  const race = game.race;
  const sprintDetails = $('sprintDetails');
  if (sprintDetails) sprintDetails.hidden = !race;
  text('dashboardCheckpoint', race ? `${race.nextCheckpoint}/${race.checkpoints.length}` : '—');
  const circuitDetails = $('circuitDetails');
  if (circuitDetails) circuitDetails.hidden = !game.circuit;
  const circuit = game.circuit?.snapshot;
  text('dashboardCircuitLap', circuit
    ? `${circuit.completedLaps}/${circuit.targetLaps}`
    : '—');
  text('dashboardCircuitTime', formatLapTime(circuit?.currentLapMs));
  text('dashboardCircuitBest', formatLapTime(circuit?.bestLapMs));
}

function replayEvent() {
  if (!game.session || !game.route) return;
  const params = new URLSearchParams(location.search);
  params.set('route', game.session.routeId);
  params.set('car', game.session.carId);
  params.set('mode', game.session.mode);
  params.set('autostart', '1');
  location.assign(`${location.pathname}?${params}`);
}

function showModeResult(timeSeconds, result) {
  const isSprint = game.session?.mode === 'race';
  const isCircuit = game.session?.mode === 'circuit' && result?.circuit;
  text('resultTitle', isCircuit ? 'Circuit complete.' : isSprint ? 'Sprint complete.' : 'Route complete.');
  text('resultStatus', result?.personalBest ? 'NEW PERSONAL BEST' : isCircuit ? 'CIRCUIT COMPLETE' : 'EVENT COMPLETE');
  text(
    'resultMessage',
    isCircuit
      ? `${result.circuit.targetLaps}-lap race on ${game.route?.name || 'this circuit'} complete.`
      : isSprint
        ? `Finish line reached. Your race on ${game.route?.name || 'this route'} is over. Replay now or return to the menu.`
        : `${game.route?.name || 'Your route'} is complete. Return to the mode menu to start another drive or choose a different mode.`
  );
  const times = $('resultTimes');
  if (times) times.hidden = !result?.saved && !isCircuit;
  if (isCircuit) {
    text('resultTimeLabel', 'EVENT TIME');
    text('resultBestLabel', 'BEST LAP');
    text('resultTime', formatLapTime(result.circuit.totalTimeMs));
    text('resultBest', formatLapTime(result.circuit.bestLapMs));
  } else if (result?.saved) {
    text('resultTimeLabel', 'YOUR TIME');
    text('resultBestLabel', 'PERSONAL BEST');
    text('resultTime', `${timeSeconds.toFixed(1)} S`);
    text('resultBest', `${result.bestSeconds.toFixed(1)} S`);
  } else {
    text('resultTimeLabel', 'YOUR TIME');
    text('resultBestLabel', 'PERSONAL BEST');
  }

  const leaderboardPanel = $('resultLeaderboardPanel');
  const leaderboardBody = $('resultLeaderboard');
  const leaderboard = result?.leaderboard;
  if (leaderboardPanel) leaderboardPanel.hidden = !leaderboard;
  if (leaderboardBody) {
    leaderboardBody.replaceChildren();
    if (leaderboard) {
      const row = document.createElement('tr');
      for (const value of [
        '1 / 1',
        leaderboard.driverName || 'YOU',
        leaderboard.carName || game.session?.carId || 'VEHICLE',
        isCircuit
          ? formatLapTime(result.circuit.totalTimeMs)
          : `${(leaderboard.timeMs / 1000).toFixed(2)} S`
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      leaderboardBody.append(row);
    }
  }
  const lapTimesPanel = $('resultLapTimesPanel');
  const lapTimesList = $('resultLapTimes');
  const lapTimes = isCircuit ? result.circuit.lapTimes : [];
  if (lapTimesPanel) lapTimesPanel.hidden = !lapTimes.length;
  if (lapTimesList) {
    lapTimesList.replaceChildren();
    lapTimes.forEach((lapTime, index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `LAP ${index + 1}`;
      const value = document.createElement('strong');
      value.textContent = formatLapTime(lapTime);
      item.append(label, value);
      lapTimesList.append(item);
    });
  }

  const replayButton = $('resultReplayBtn');
  if (replayButton) {
    replayButton.disabled = false;
    replayButton.textContent = 'Replay event';
  }
  const results = $('resultsOverlay');
  if (results) results.hidden = false;
  const isFreeDrive = game.session?.mode === 'free-drive' && !game.session?.profileId;
  if (!isFreeDrive && leaderboard) startResultsPreview();
}

function goToModeMenu() {
  const mode = game.session?.profileId
    ? 'career'
    : game.session?.mode === 'race' ? 'sprint'
      : game.session?.mode === 'circuit' ? 'circuit' : 'free-drive';
  const params = new URLSearchParams({ mode });
  if (mode === 'career') {
    params.set('profile', game.session.profileId);
    params.set('careerMenu', '1');
  }
  flushDriveStats();
  window.location.assign(`./index3.html?${params}`);
}

function goToMainMenu() {
  flushDriveStats();
  window.location.assign('./index3.html');
}

// ---------- Session lifecycle ----------
function beginSession() {
  if (!startRequested || game.started) return;

  const blockers = {
    gameReady: game.ready,
    routeReady: game.routeReady,
    loopExists: !!loop
  };

  if (!game.ready || !game.routeReady || !loop) {
    console.warn('[HOOD] Cannot begin session yet:', blockers);
    return;
  }

  console.log('[HOOD] Starting driving session');
  game.started = true;
  if (game.race && !game.race.startedAt) game.race.startedAt = 1;
  game.userPaused = false;
  game.sprintFinished = false;
  game.sessionDistanceM = 0;
  game.sessionActiveSeconds = 0;
  pendingDriveDistance = 0;
  pendingDriveSeconds = 0;
  statsStore.startSession(game.session?.carId);

  input.clear?.();

  window.focus();
  document.body.focus?.();
  syncRunState();
  requestAnimationFrame(() => window.focus());

  const loading = $('loading');
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => { loading.style.display = 'none'; }, 450);
  }

  text('message', 'Welcome to HOOD · Press ↑ to accelerate · C for camera');

  window.dispatchEvent(new Event('hood:session-started'));
}

function requestSessionStart() {
  startRequested = true;
  window.__HOOD_START_REQUESTED = true;
  console.log('[HOOD] Start requested');

  // If the splash screen requested start before selecting a route, auto-load the first route
  if (game.ready && !game.routeReady && !game.routeLoading && game.routes?.length) {
    console.log('[HOOD] No route loaded yet — auto-loading first route:', game.routes[0]);
    loadRoute(game.routes[0], { carId: game.defaultCar });
    return;
  }

  beginSession();
}

window.addEventListener('hood:start-requested', requestSessionStart);

// ---------- Renderer / scene ----------
const gfx = createRenderer($('game'), {
  maxPixelRatio: C.gfx.maxPixelRatio,

  onLost: () => {
    loop?.stop();
    text('message', 'Graphics context lost — waiting for the GPU to recover…');
  },

  onRestored: () => {
    if (game.started) syncRunState();
  }
});

const { renderer } = gfx;
const scaler = new QualityScaler({
  min: C.gfx.minScale,
  targetFps: C.gfx.targetFps
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.gfx.sky);
scene.fog = new THREE.Fog(C.gfx.sky, C.gfx.fogNear, C.gfx.fogFar);

scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x4c3b2b, 2.1));

const sun = new THREE.DirectionalLight(0xffe6c6, 2.8);
sun.position.set(-30, 50, 20);
scene.add(sun);

const skyFill = new THREE.DirectionalLight(0x8dbdff, 0.55);
skyFill.position.set(35, 18, -40);
scene.add(skyFill);

// HOOD terrain grass: repeating grass-medium surface.
const GROUND_SIZE = 768;
const groundTexture = new THREE.TextureLoader().load(
  './assets/Terrain/grass_medium/textures/grass_medium_01_diff_4k.jpg',
  () => console.info('[HOOD] Terrain grass texture loaded.'),
  undefined,
  (error) => console.error('[HOOD] Terrain grass texture failed to load:', error)
);

groundTexture.wrapS = THREE.RepeatWrapping;
groundTexture.wrapT = THREE.RepeatWrapping;
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.repeat.set(GROUND_SIZE / 12, GROUND_SIZE / 12);
groundTexture.anisotropy = 4;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({
    map: groundTexture,
    color: 0xffffff,
    roughness: 1,
    metalness: 0
  })
);
ground.name = 'HOOD_GrassTerrain';
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

function centerGroundOn(x, z) {
  ground.position.x = Math.floor(x / WORLD_CHUNK_SIZE) * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
  ground.position.z = Math.floor(z / WORLD_CHUNK_SIZE) * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
}

const gameViewport = () => ({
  width: $('game')?.clientWidth || innerWidth,
                            height: $('game')?.clientHeight || innerHeight
});
const initialViewport = gameViewport();
const camera = new THREE.PerspectiveCamera(75, initialViewport.width / initialViewport.height, 0.1, 600);

const syncCamera = () => {
  const { width, height } = gameViewport();
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
if ($('game')) new ResizeObserver(syncCamera).observe($('game'));
addEventListener('orientationchange', () => setTimeout(syncCamera, 250));

let resultsPreviewFrame = 0;
let worldVisualStream = null;
function startResultsPreview() {
  const points = game.route?.path?.pts;
  if (!points?.length) return;
  cancelAnimationFrame(resultsPreviewFrame);

  const bounds = points.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x),
    maxX: Math.max(box.maxX, point.x),
    minZ: Math.min(box.minZ, point.z),
    maxZ: Math.max(box.maxZ, point.z)
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  worldVisualStream?.update(centerX, centerZ);
  centerGroundOn(centerX, centerZ);
  const radius = Math.max(
    70,
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2
  );
  const distance = radius * 2.15;

  if (game.carRoot) game.carRoot.visible = false;
  document.body.classList.add('results-preview-active');
  if ($('navigationMap')) $('navigationMap').hidden = true;
  scene.fog.near = 0;
  scene.fog.far = Math.max(C.gfx.fogFar, distance * 3);
  camera.near = 1;
  camera.far = Math.max(600, distance * 3);
  camera.fov = 62;
  camera.updateProjectionMatrix();

  const animate = (time) => {
    const angle = time * 0.000035;
    camera.position.set(
      centerX + Math.cos(angle) * distance * 0.82,
      distance * 0.62,
      centerZ + Math.sin(angle) * distance * 0.82
    );
    camera.lookAt(centerX, 0, centerZ);
    renderer.render(scene, camera);
    resultsPreviewFrame = requestAnimationFrame(animate);
  };
  resultsPreviewFrame = requestAnimationFrame(animate);
}
addEventListener('pagehide', () => cancelAnimationFrame(resultsPreviewFrame));

const rig = new THREE.Group();
scene.add(rig);

const overlay = debug ? createDebugOverlay(renderer) : null;

// ---------- Input ----------
const input = createInput({
  onKey: (k) => {
    if (!game.started || game.paused) return;

    if (k === 'c') toggleCamera();
    if (k === 'm') setUserPaused(true);
  }
});

window.addEventListener('keydown', (event) => {
  if (!game.started || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    event.preventDefault();
    if (game.userPaused && event.key === 'Escape' && activeMenuView !== 'home') {
      showMenuView('home');
      return;
    }
    setUserPaused(!game.userPaused);
  }
});

$('menuBtn')?.addEventListener('click', () => setUserPaused(true));
$('resumeBtn')?.addEventListener('click', () => {
  if (!game.started && game.routeReady) requestSessionStart();
  else setUserPaused(false);
});
$('openDashboardBtn')?.addEventListener('click', () => showMenuView('dashboard'));
$('goToModeMenuBtn')?.addEventListener('click', goToModeMenu);
$('goToMainMenuBtn')?.addEventListener('click', goToMainMenu);
$('openControlsBtn')?.addEventListener('click', () => showMenuView('controls'));
document.querySelectorAll('.menuBackBtn').forEach((button) => button.addEventListener('click', () => showMenuView('home')));
$('resultReplayBtn')?.addEventListener('click', () => {
  if (!$('resultReplayBtn')?.disabled) replayEvent();
});
$('resultModeMenuBtn')?.addEventListener('click', goToModeMenu);
$('resultMainMenuBtn')?.addEventListener('click', goToMainMenu);
addEventListener('pagehide', flushDriveStats);

$('routesBtn')?.addEventListener('click', () => { if (game.started) changeRoute(); });
$('camBtn')?.addEventListener('click', () => { if (game.started) toggleCamera(); });

const portraitGate = matchMedia('(max-width: 700px) and (orientation: portrait), (pointer: coarse) and (orientation: portrait)');
const syncPortraitPause = () => {
  if (!game.started || !loop) return;
  syncRunState();
};
portraitGate.addEventListener('change', syncPortraitPause);
document.addEventListener('visibilitychange', syncRunState);

$('game')?.addEventListener('pointerdown', (event) => {
  cockpitPointerX = event.clientX;
  cockpitPointerY = event.clientY;
  if (event.pointerType === 'touch') {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2) pinchDistance = touchDistance();
  }
});
$('game')?.addEventListener('pointermove', (event) => {
  const isTouch = touchPoints.has(event.pointerId);
  if (isTouch) touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!game.started || camSet[camIndex]?.id !== 'cockpit') return;
  if (isTouch && touchPoints.size === 2) {
    const distance = touchDistance();
    if (pinchDistance) cockpitFov = clamp(cockpitFov + (distance - pinchDistance) * 0.12, 55, 100);
    pinchDistance = distance;
  } else if (isTouch && touchPoints.size === 1 || event.pointerType === 'mouse' && event.buttons === 1) {
    if (cockpitPointerX != null) cockpitOffset = clamp(cockpitOffset + (event.clientX - cockpitPointerX) * 0.003, 0, 0.84);
    if (cockpitPointerY != null) cockpitOffsetY = clamp(cockpitOffsetY - (event.clientY - cockpitPointerY) * 0.002, -0.18, 0.28);
  }
  cockpitPointerX = event.clientX;
  cockpitPointerY = event.clientY;
}, { passive: true });
$('game')?.addEventListener('pointerup', (event) => {
  touchPoints.delete(event.pointerId);
  cockpitPointerX = null;
  cockpitPointerY = null;
  if (touchPoints.size < 2) pinchDistance = 0;
});
$('game')?.addEventListener('pointercancel', (event) => {
  touchPoints.delete(event.pointerId);
  cockpitPointerX = null;
  cockpitPointerY = null;
  if (touchPoints.size < 2) pinchDistance = 0;
});
$('game')?.addEventListener('wheel', (event) => {
  if (!game.started || camSet[camIndex]?.id !== 'cockpit' || (!event.ctrlKey && !event.shiftKey && !event.altKey)) return;
  event.preventDefault();
  const now = performance.now();
  if (now < nextViewGestureAt) return;
  nextViewGestureAt = now + 80;
  if (event.ctrlKey) cockpitFov = clamp(cockpitFov - event.deltaY * 0.035, 55, 100);
  else if (event.altKey) cockpitOffsetY = clamp(cockpitOffsetY - event.deltaY * 0.0015, -0.18, 0.28);
  else cockpitOffset = clamp(cockpitOffset + (event.deltaX || event.deltaY) * 0.002, 0, 0.84);
}, { passive: false });

function touchDistance() {
  const [a, b] = [...touchPoints.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------- Camera presets ----------
const DEFAULT_CAMERAS = [
  { id: 'rear',     name: 'CLOSE REAR',          pos: [0, 1.5, 4.9],        look: [0, 0.9, -2.5], smooth: 8 },
  { id: 'front3qR', name: 'FRONT 3/4 · RIGHT',   pos: [5.8, 2.7, -11.5],    look: [0, 0.65, 0.3], rigid: true },
  { id: 'front3qL', name: 'FRONT 3/4 · LEFT',    pos: [-5.8, 2.7, -11.5],   look: [0, 0.65, 0.3], rigid: true },
  { id: 'lowFront', name: 'LOW FRONT',           pos: [0, 2, -12.5],        look: [0, 0.62, 0],   rigid: true, fov: 42, fixedFov: true },
  { id: 'wheelR',   name: 'WHEEL VIEW · RIGHT',  pos: [2.1, 0.32, -3.6],    look: [0.6, 0.55, -1.6], rigid: true, fov: 70, fixedFov: true, roll: -7 },
  { id: 'wheelL',   name: 'WHEEL VIEW · LEFT',   pos: [-2.1, 0.32, -3.6],   look: [-0.6, 0.55, -1.6], rigid: true, fov: 70, fixedFov: true, roll: 7 },
  { id: 'hood',     name: 'HOOD',                pos: [0, 0.75, -2.0],      look: [0, 0.6, -20],  rigid: true }
];

function makeCameraSet(carCfg) {
  const k = (carCfg.targetLength || 5.02) / 5.02;
  const scaled = (p) => [p[0] * k, p[1], p[2] * k];

  const extras = DEFAULT_CAMERAS.map((def) => {
    const o = carCfg.cameras?.[def.id] || {};
    return {
      ...def,
      ...o,
      pos: o.pos || scaled(def.pos),
                                     look: o.look || scaled(def.look)
    };
  });

  return [
    { id: 'chase', name: 'CHASE', pos: carCfg.chase, look: carCfg.chaseLook, smooth: 6 },
    ...extras,
    { id: 'cockpit', name: 'COCKPIT', pos: carCfg.cockpit,
      look: [carCfg.cockpit[0], carCfg.cockpit[1], -20], smooth: 0 }
  ];
}

function selectCamera(index) {
  if (!camSet.length) return;
  camIndex = (index + camSet.length) % camSet.length;
  text(
    'viewSubtitle',
    camSet[camIndex].name + (mobileLayoutQuery.matches
    ? ' CAMERA · TAP 📷 TO CHANGE'
    : ' CAMERA · C NEXT · V PREVIOUS · 1-' + camSet.length + ' SELECT')
  );
}

function cycleCamera(dir) { selectCamera(camIndex + dir); }
function toggleCamera() { cycleCamera(1); }

addEventListener('keydown', (e) => {
  if (!game.started || game.paused || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'v' || e.key === 'V') { cycleCamera(-1); return; }
  if (e.key === 'l' || e.key === 'L') {
    headlightsOn = !headlightsOn;
    lightsMsgUntil = performance.now() + 2000;
    return;
  }
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= camSet.length) selectCamera(n - 1);
});

// ---------- Boot, phase 1: engine (runs at page load) ----------
async function bootEngine() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const part = { car: 0, routes: 0 };
  let label = 'Loading';
  const report = () => emit('hood:load-progress', { p: 0.85 * part.car + 0.15 * part.routes, label });

  if (!mobileLayoutQuery.matches) preloadMusic(() => {}).catch(() => {});

  const [gltf, routesData, modelManifest] = await Promise.all([
    loader.loadAsync(C.car.model, (e) => {
      if (e.lengthComputable) {
        part.car = e.loaded / e.total;
        label = 'Loading the car';
        report();
      }
    }),
    fetch(C.routes.file)
    .then((r) => {
      if (!r.ok) throw new Error('routes HTTP ' + r.status);
      return r.json();
    })
    .then((d) => { part.routes = 1; report(); return d; }),
    fetch('./models/manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error('model manifest HTTP ' + r.status);
        return r.json();
      })
  ]);
  if (!Array.isArray(modelManifest?.models) || modelManifest.models.some((model) =>
    !model || typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.model !== 'string'
  )) {
    throw new Error('model manifest must contain a models array with id, name, and model paths');
  }

  engine = { gltf, routesData, loader };
  game.routes = routesData.routes.map((r) => r.id);

  game.carConfigs = { ...(C.cars || {}) };
  const configuredModels = new Set(Object.values(C.cars || {}).map((car) => car.model));
  const extraCars = modelManifest.models
    .filter((model) => !configuredModels.has(model.model))
    .map((model) => {
      game.carConfigs[model.id] = { name: model.name, model: model.model };
      return { id: model.id, name: model.name };
    });
  game.cars = [
    ...Object.entries(C.cars || {}).map(([id, c]) => ({ id, name: c.name || id })),
    ...extraCars
  ];
  game.defaultCar = C.defaultCar && C.cars?.[C.defaultCar] ? C.defaultCar : game.cars[0]?.id;
  emit('hood:cars', { cars: game.cars, defaultCar: game.defaultCar });

  game.ready = true;
  emit('hood:load-progress', { p: 1, label: 'Ready' });
  console.log('[HOOD] Engine ready. Waiting for a route.');
  window.dispatchEvent(new Event('hood:game-ready'));

  if (location.hash.startsWith('#/drive/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  const qs = new URLSearchParams(location.search);
  const want = qs.get('route');

  if (want && !qs.has('picker')) {
    await loadRoute(want, { carId: qs.get('car') || undefined, mode: qs.get('mode') || undefined });
    if (qs.has('autostart') && game.routeReady) requestSessionStart();
  } else if (game.routes?.length && !qs.has('picker')) {
    // Pre-build the default route so clicking START DRIVING on the splash starts immediately
    await loadRoute(game.routes[0], { carId: game.defaultCar });
  }
}

// ---------- Boot, phase 2: route ----------
async function loadRoute(routeId, opts = {}) {
  if (!game.ready) {
    console.warn('[HOOD] loadRoute ignored: engine not ready');
    emit('hood:route-error', { message: 'Engine is not ready yet' });
    return;
  }
  if (game.routeReady) {
    console.log('[HOOD] loadRoute: route already ready, re-announcing');
    emit('hood:route-ready', { routeId: game.route?.id });
    beginSession();
    return;
  }
  if (game.routeLoading) {
    console.log('[HOOD] loadRoute ignored: already loading');
    return;
  }

  game.routeLoading = true;
  const added = [];
  let routeWorldStream = null;

  const progress = async (p, label) => {
    emit('hood:route-progress', { routeId, p, label });
    await nextFrame();
  };

  try {
    const def = engine.routesData.routes.find((r) => r.id === routeId);
    if (!def) throw new Error('unknown route "' + routeId + '"');
    const route = buildRoute(def);
    const params = new URLSearchParams(location.search);
    const mode = opts.mode || params.get('mode') || 'free-drive';
    if (mode === 'circuit') {
      if (def.circuit !== true || def.mode !== 'circuit') {
        throw new Error('Circuit mode requires a closed circuit route.');
      }
      const startPosition = sampleAt(
        route.path,
        Math.max(0, route.path.length - 6),
        route.laneOffset
      );
      route.spawn = {
        x: +startPosition.x.toFixed(2),
        z: +startPosition.z.toFixed(2),
        psi: +startPosition.psi.toFixed(3)
      };
    }
    game.route = route;

    const carId = opts.carId || game.defaultCar || C.defaultCar || 'dodge';
    const profileId = params.get('career') === '1' ? params.get('profile') : null;
    const careerEventId = params.get('careerEvent') || routeId;
    if (params.get('career') === '1' &&
        (!profileId || !careerStore.snapshot().profiles.some((profile) => profile.id === profileId))) {
      throw new Error('Career profile not found. Return to HOOD and choose a saved profile.');
    }
    if (profileId && mode === 'circuit') {
      const event = CAREER_CIRCUIT_EVENTS.find((item) => item.id === careerEventId);
      if (params.get('career') === '1' &&
          (!event || event.routeId !== routeId || event.laps !== Number(params.get('laps')))) {
        throw new Error('Career circuit event does not match the selected route and lap count.');
      }
    }
    if (profileId && !careerStore.isEventUnlocked(profileId, careerEventId)) {
      throw new Error('Career event is locked. Complete an available event to unlock this route.');
    }
    if (profileId && !careerStore.isCarUnlocked(profileId, carId)) {
      throw new Error('Career vehicle is locked. Complete more events to unlock this car.');
    }
    const carCfg = { ...C.car, ...(game.carConfigs?.[carId] || {}) };
    const carPhysics = resolveVehiclePhysics(carId, game.carConfigs?.[carId]?.physics);
    if (!game.carConfigs?.[carId]) {
      console.warn('[HOOD] No CONFIG.cars.' + carId + ' entry; using CONFIG.car.');
    }
    game.session = {
      carId,
      routeId,
      careerEventId,
      mode,
      profileId
    };
    const isOpenFreeDrive = mode === 'free-drive' && !profileId;
    const navigationMapEnabled = !!$('navigationMapCanvas');
    const navigationMap = $('navigationMap');
    if (navigationMap) {
      navigationMap.hidden = !navigationMapEnabled;
      navigationMap.setAttribute(
        'aria-label',
        isOpenFreeDrive
          ? `Nearby ${route.city || 'Nairobi'} roads, centered on your car and rotating with your heading`
          : 'Nearby route map, centered on your car and rotating with your heading'
      );
    }
    const navigationMapLabel = $('navigationMapLabel');
    if (navigationMapLabel) navigationMapLabel.textContent = isOpenFreeDrive ? 'NEARBY ROADS' : 'ROUTE RADAR';
    document.body.classList.toggle('navigation-map-active', navigationMapEnabled);
    const routeName = $('routeName');
    if (routeName) routeName.textContent = isOpenFreeDrive
      ? `FREE DRIVE · ${String(route.city || 'Nairobi').toUpperCase()}`
      : route.name;
    for (const id of ['routeLeft', 'routeEta']) {
      const row = $(id)?.parentElement;
      if (row) row.hidden = isOpenFreeDrive;
    }
    const routeTrack = $('routeFill')?.parentElement;
    if (routeTrack) routeTrack.hidden = isOpenFreeDrive;
    game.race = null;
    game.circuit = null;
    if (mode === 'circuit') {
      const circuitSession = createCircuitSession({
        route: def,
        laps: Number(params.get('laps') || 3)
      });
      game.circuit = {
        session: circuitSession,
        snapshot: updateCircuitSession(circuitSession, route.spawn, 0),
        elapsedMs: 0,
        startedAtMs: null,
        elapsedAtFinish: null
      };
    }

    camSet = makeCameraSet(carCfg);
    selectCamera(0);
    console.log('[HOOD] Session:', game.session);

    await progress(0.03, 'Reading the road');
    const tile = await fetch(def.tile || C.map.tile).then((response) => {
      if (!response.ok) throw new Error('tile HTTP ' + response.status);
      return response.json();
    });

    await progress(0.2, 'Mapping the streets');
    const routeBarricades = mode === 'race' ? route.barricades || [] : [];
    const world = new StaticWorld(tile, routeBarricades);
    game.world = world;

    await progress(0.32, 'Laying the tarmac');
    const asphaltTexture = await new THREE.TextureLoader().loadAsync('./assets/Terrain/asphalt_track/textures/asphalt_track_diff_4k.jpg');
    const murramTexture = await new THREE.TextureLoader().loadAsync('./assets/Terrain/grass_ground/textures/grass_ground_diff_4k.jpg');

    for (const texture of [asphaltTexture, murramTexture]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      texture.needsUpdate = true;
    }

    routeWorldStream = new WorldVisualStream(
      scene,
      new WorldVisualChunks(tile, {
        route: isOpenFreeDrive ? null : route,
        barricades: routeBarricades
      }),
      { route: isOpenFreeDrive ? null : route, asphaltTexture, murramTexture }
    );
    worldVisualStream = routeWorldStream;
    centerGroundOn(route.spawn.x, route.spawn.z);
    routeWorldStream.update(route.spawn.x, route.spawn.z);

    await progress(0.65, 'Parking the car');
    let carGltf = engine.gltf;
    if (carCfg.model && carCfg.model !== C.car.model) {
      carGltf = await engine.loader.loadAsync(carCfg.model);
    }
    const carTitle = document.querySelector('.hud.top h1');
    if (carTitle && carCfg.name) carTitle.textContent = carCfg.name.toUpperCase();

    applyCarProfileAppearance(carGltf.scene, carCfg);
    const car = rigCar(carGltf.scene, {
      targetLength: carCfg.targetLength,
      headingOffset: carCfg.headingOffset,
      wheelLayout: carCfg.wheelLayout
    });
    game.carRoot = car.root;
    rig.add(car.root);
    added.push(car.root);

    let steeringWheel = null;
    let lights = { update() {} };
    try {
      steeringWheel = rigSteeringWheel(car.root, carCfg);
      lights = createCarLights(car.root, carCfg);
    } catch (err) {
      console.warn('[HOOD] car extras failed (steering wheel / lights):', err);
    }
    window.__hoodFlash = (name) => flashMesh(car.root, name);
    window.__hoodScan = (radius) => scanNearby(car.root, carCfg, radius);
    window.__hoodPreview = (c, r, t) => previewSplit(car.root, carCfg, c, r, t);

    const sp0 = carCfg.steeringWheel?.split || {};
    const split = {
      center: [...(sp0.center || [-0.42, 0.90, -0.40])],
      radius: sp0.radius ?? 0.19,
      thickness: sp0.thickness ?? 0.14
    };
    const applySplit = () => {
      steeringWheel?.dispose?.();
      steeringWheel = rigSteeringWheel(car.root, {
        ...carCfg,
        steeringWheel: { ...(carCfg.steeringWheel || {}), split: { ...split, center: [...split.center] } }
      });
      previewSplit(car.root, carCfg, split.center, split.radius, split.thickness);
      console.log('[HOOD] split =', JSON.stringify(split));
      return !!steeringWheel;
    };
    window.__hoodSplit = (c, r, t) => {
      if (c) split.center = [...c];
      if (r != null) split.radius = r;
      if (t != null) split.thickness = t;
      return applySplit();
    };
    window.__hoodNudge = (dx = 0, dy = 0, dz = 0, dr = 0, dt = 0) => {
      split.center[0] += dx; split.center[1] += dy; split.center[2] += dz;
      split.radius = Math.max(0.02, split.radius + dr);
      split.thickness = Math.max(0.02, split.thickness + dt);
      return applySplit();
    };
    window.__hoodSplitUndo = () => {
      steeringWheel?.dispose?.(); steeringWheel = null;
      previewSplit(car.root, carCfg, null);
    };
    window.__hoodSplitShow = () => applySplit();

    const s = createVehicle(route.spawn.x, route.spawn.z, route.spawn.psi, carPhysics);
    game.sim = s;

    let impactShake = 0;
    let lastImpact = 0;
    let prog = { s: 0, dist: 0 };
    let arrivedAt = 0;
    const checkpoints = (route.checkpoints || []).map((checkpoint) => ({
      ...checkpoint,
      s: trackProgress(route.path, checkpoint.x, checkpoint.z).s
    }));
    const routeLandmarks = (route.landmarks || []).map((landmark) => ({
      name: landmark.name,
      s: landmark.at === 'start' ? 0
        : landmark.at === 'end' ? route.path.length
        : trackProgress(route.path, landmark.x, landmark.z).s
    })).sort((a, b) => a.s - b.s);
    if (game.session.mode === 'race' && checkpoints.length) {
      game.race = { checkpoints, nextCheckpoint: 0, startedAt: 0, finishedAt: 0, elapsedSeconds: 0 };
    }
    const endName = (route.landmarks?.find((l) => l.at === 'end') || {}).name || 'the end of the route';
    const mapCanvas = $('navigationMapCanvas');
    const mapContext = navigationMapEnabled ? mapCanvas?.getContext('2d') : null;
    const mapPaths = tile.roads
      .filter((road) => Array.isArray(road.pts) && road.pts.length >= 4)
      .map((road) => Array.from({ length: road.pts.length / 2 }, (_, index) => ({
        x: road.pts[index * 2],
        z: road.pts[index * 2 + 1]
      })));
    const routeMapPath = isOpenFreeDrive ? null : route.path.pts;
    const renderNavigationMap = (vehicle) => {
      if (!navigationMapEnabled || !mapContext || !mapCanvas) return;
      const rect = mapCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(rect.width * pixelRatio);
      const pixelHeight = Math.round(rect.height * pixelRatio);
      if (mapCanvas.width !== pixelWidth || mapCanvas.height !== pixelHeight) {
        mapCanvas.width = pixelWidth;
        mapCanvas.height = pixelHeight;
      }
      mapContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      mapContext.clearRect(0, 0, rect.width, rect.height);
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const radius = isOpenFreeDrive ? 56 : 72;
      const scale = Math.min(rect.width, rect.height) / (radius * 2);
      const cos = Math.cos(vehicle.psi);
      const sin = Math.sin(vehicle.psi);
      const screenPoint = (x, z) => ({
        x: centerX + ((x - vehicle.x) * cos + (z - vehicle.z) * sin) * scale,
        y: centerY + (-(x - vehicle.x) * sin + (z - vehicle.z) * cos) * scale
      });

      mapContext.save();
      mapContext.beginPath();
      mapContext.arc(centerX, centerY, Math.min(rect.width, rect.height) / 2, 0, Math.PI * 2);
      mapContext.clip();
      mapContext.strokeStyle = 'rgba(95, 205, 244, .12)';
      mapContext.lineWidth = 1;
      for (const fraction of [0.34, 0.67, 1]) {
        mapContext.beginPath();
        mapContext.arc(centerX, centerY, Math.min(rect.width, rect.height) * fraction / 2, 0, Math.PI * 2);
        mapContext.stroke();
      }

      mapContext.beginPath();
      for (const path of mapPaths) {
        path.forEach((point, index) => {
          const mapped = screenPoint(point.x, point.z);
          if (index === 0) mapContext.moveTo(mapped.x, mapped.y);
          else mapContext.lineTo(mapped.x, mapped.y);
        });
      }
      mapContext.strokeStyle = 'rgba(2, 9, 14, .8)';
      mapContext.lineWidth = 4;
      mapContext.lineJoin = 'round';
      mapContext.lineCap = 'round';
      mapContext.stroke();
      mapContext.strokeStyle = 'rgba(155, 201, 216, .48)';
      mapContext.lineWidth = 1.5;
      mapContext.stroke();

      if (routeMapPath?.length) {
        mapContext.beginPath();
        routeMapPath.forEach((point, index) => {
          const mapped = screenPoint(point.x, point.z);
          if (index === 0) mapContext.moveTo(mapped.x, mapped.y);
          else mapContext.lineTo(mapped.x, mapped.y);
        });
        mapContext.strokeStyle = 'rgba(32, 200, 255, .9)';
        mapContext.lineWidth = 2.5;
        mapContext.stroke();
        const start = screenPoint(routeMapPath[0].x, routeMapPath[0].z);
        mapContext.fillStyle = '#6fe6a1';
        mapContext.beginPath();
        mapContext.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
        mapContext.fill();
        if (route.circuit !== true) {
          const end = screenPoint(routeMapPath.at(-1).x, routeMapPath.at(-1).z);
          mapContext.fillStyle = '#ff735f';
          mapContext.beginPath();
          mapContext.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
          mapContext.fill();
        }
      }

      mapContext.beginPath();
      mapContext.moveTo(centerX, centerY - 7);
      mapContext.lineTo(centerX - 5, centerY + 6);
      mapContext.lineTo(centerX, centerY + 3);
      mapContext.lineTo(centerX + 5, centerY + 6);
      mapContext.closePath();
      mapContext.fillStyle = '#fff';
      mapContext.shadowColor = '#20c8ff';
      mapContext.shadowBlur = 7;
      mapContext.fill();
      mapContext.restore();
    };
    let controls = input.poll(0);
    let surface = world.surfaceAt(s.x, s.z);

    const step = (dt) => {
      const previousX = s.x;
      const previousZ = s.z;
      surface = world.surfaceAt(s.x, s.z);
      stepVehicle(s, controls, surface, dt, carPhysics);

      const hit = collideCar(world, s, applyImpact);
      if (hit > 1) {
        lastImpact = hit;
        impactShake = Math.min(1, hit / 15);
      }

      const distance = Math.hypot(s.x - previousX, s.z - previousZ);
      game.sessionDistanceM += distance;
      game.sessionActiveSeconds += dt;
      pendingDriveDistance += distance;
      pendingDriveSeconds += dt;
      statsFlushTimer += dt;
      dashboardUpdateTimer += dt;
      if (game.race?.startedAt && !game.race.finishedAt) game.race.elapsedSeconds += dt;
      if (game.circuit && game.circuit.snapshot.status !== 'finished') {
        const circuit = game.circuit;
        const previousStatus = circuit.snapshot.status;
        circuit.elapsedMs += dt * 1000;
        circuit.snapshot = updateCircuitSession(
          circuit.session,
          { x: s.x, z: s.z },
          circuit.elapsedMs
        );
        if (previousStatus === 'ready' && circuit.snapshot.status === 'racing') {
          circuit.startedAtMs = circuit.session.lapStartedAt;
        }
        if (circuit.snapshot.status === 'finished') {
          circuit.elapsedAtFinish = circuit.elapsedMs - circuit.startedAtMs;
          completeCareerEvent();
          flushDriveStats();
          game.sprintFinished = true;
          syncRunState();
          showModeResult(circuit.elapsedAtFinish / 1000, {
            circuit: {
              ...circuit.snapshot,
              totalTimeMs: circuit.elapsedAtFinish
            },
            leaderboard: eventLeaderboard(circuit.elapsedAtFinish)
          });
        }
      }
      if (statsFlushTimer >= 3) {
        flushDriveStats();
        statsFlushTimer = 0;
      }
    };

    const cam = {
      pos: new THREE.Vector3(),
      local: new THREE.Vector3(),
      look: new THREE.Vector3(),
      init: false
    };
    const v3 = new THREE.Vector3();

    const render = (alpha, dtSec) => {
      controls = input.poll(dtSec);

      rig.position.set(s.x, 0, s.z);
      rig.rotation.y = -s.psi;

      car.update(s.wheelAngle, s.wheelSpin);

      steeringWheel?.update(controls.steer);
      lights.update(dtSec, {
        head: headlightsOn,
        brake: (controls.brake > 0.05 && !s.reverse) || (controls.handbrake && s.speed > 1),
                    reverse: s.reverse
      });

      // Route progress (guarded for optional DOM nodes)
      if (!isOpenFreeDrive) prog = trackProgress(route.path, s.x, s.z, prog.s);
      const left = isOpenFreeDrive ? 0 : Math.max(0, route.path.length - prog.s);
      const remainingText = left > 950 ? (left / 1000).toFixed(2) + ' KM' : Math.round(left / 10) * 10 + ' M';
      const etaSeconds = Math.ceil(left / Math.max(s.speed, 5));
      const etaText = `${String(Math.floor(etaSeconds / 60)).padStart(2, '0')}:${String(etaSeconds % 60).padStart(2, '0')}`;
      const passedLandmarks = routeLandmarks.filter((landmark) => landmark.s <= prog.s);
      const locationText = isOpenFreeDrive
        ? `${route.city || 'Nairobi'} road network`
        : passedLandmarks.at(-1)?.name || routeLandmarks[0]?.name || route.name;
      if (!isOpenFreeDrive) {
        text('routeLeft', remainingText);
        text('routeEta', etaText);
      }
      text('currentLocation', locationText);
      game.currentLocation = locationText;
      game.routeRemaining = isOpenFreeDrive ? '—' : remainingText;
      game.routeEta = isOpenFreeDrive ? '—' : etaText;
      const routeFill = $('routeFill');
      if (routeFill && !isOpenFreeDrive) routeFill.style.width = (prog.s / route.path.length) * 100 + '%';
      renderNavigationMap(s);

      const race = game.race;
      if (race?.startedAt) {
        const previousCheckpoint = race.nextCheckpoint;

        while (race.nextCheckpoint < race.checkpoints.length) {
          const checkpoint = race.checkpoints[race.nextCheckpoint];
          if (prog.s < checkpoint.s - 8 || Math.hypot(s.x - checkpoint.x, s.z - checkpoint.z) > 16) break;
          race.nextCheckpoint++;
        }

        // A checkpoint event is emitted only when progress advances.
        if (race.nextCheckpoint > previousCheckpoint) {
          const reached = race.checkpoints[race.nextCheckpoint - 1];
          const notice = $('checkpointNotice');

          text('checkpointNoticeName', reached.name);
          if (notice) {
            notice.hidden = false;
            notice.classList.remove('checkpoint-pop');
            void notice.offsetWidth;
            notice.classList.add('checkpoint-pop');
          }

          console.info('[HOOD] Checkpoint reached:', reached.name);
        }

        const sprintHud = $('sprintHud');
        if (sprintHud) sprintHud.hidden = false;

        text('hudCheckpointCount', `${race.nextCheckpoint}/${race.checkpoints.length}`);
        text(
          'hudNextCheckpoint',
          race.nextCheckpoint < race.checkpoints.length
            ? race.checkpoints[race.nextCheckpoint].name
            : 'Finish line'
        );
        const checkpointS = race.checkpoints[race.nextCheckpoint]?.s ?? route.path.length;
        const guidancePoint = sampleAt(route.path, Math.min(checkpointS, prog.s + 35));
        const dx = guidancePoint.x - s.x;
        const dz = guidancePoint.z - s.z;
        const targetHeading = Math.atan2(dx, -dz);
        const relativeBearing = Math.atan2(
          Math.sin(targetHeading - s.psi),
          Math.cos(targetHeading - s.psi)
        );
        const arrow = $('checkpointArrow');
        if (arrow) arrow.style.transform = `rotate(${relativeBearing}rad)`;
        const distance = Math.max(0, checkpointS - prog.s);
        text('hudCheckpointDistance', distance >= 1000
          ? `${(distance / 1000).toFixed(1)} KM`
          : `${Math.round(distance)} M`);
      }
      const circuit = game.circuit?.snapshot;
      if (circuit) {
        const circuitHud = $('circuitHud');
        if (circuitHud) circuitHud.hidden = false;
        text('circuitLap', circuit.status === 'ready'
          ? `START / ${circuit.targetLaps}`
          : `${circuit.status === 'finished' ? circuit.completedLaps : circuit.completedLaps + 1}/${circuit.targetLaps}`);
        text('circuitLapTime', formatLapTime(circuit.currentLapMs));
        text('circuitBestLap', formatLapTime(circuit.bestLapMs));
      }
      if (!isOpenFreeDrive && !game.circuit && !arrivedAt && left < 15 && prog.dist < 8 && (!race || race.nextCheckpoint === race.checkpoints.length)) {
        arrivedAt = performance.now();
        completeCareerEvent();
        let result = null;
        const eventTimeSeconds = race?.elapsedSeconds ?? game.sessionActiveSeconds;
        if (race?.startedAt) {
          race.finishedAt = arrivedAt;
          race.elapsedAtFinish = race.elapsedSeconds;
          race.result = statsStore.recordSprint({
            routeId: game.session.routeId,
            carId: game.session.carId,
            timeSeconds: race.elapsedAtFinish,
            checkpointsPassed: race.nextCheckpoint,
            totalCheckpoints: race.checkpoints.length
          });
          result = {
            ...race.result,
            leaderboard: eventLeaderboard(race.elapsedAtFinish * 1000)
          };
        } else if (game.session.mode !== 'free-drive') {
          result = {
            leaderboard: eventLeaderboard(eventTimeSeconds * 1000)
          };
        }
        flushDriveStats();
        game.sprintFinished = true;
        syncRunState();
        showModeResult(eventTimeSeconds, result);
      }
      if (race?.startedAt) {
        const elapsed = race.finishedAt ? race.elapsedAtFinish : race.elapsedSeconds;
        const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const seconds = (elapsed % 60).toFixed(1).padStart(4, '0');
        text('sprintTime', `${minutes}:${seconds}`);
        text('dashboardCheckpoint', `${race.nextCheckpoint}/${race.checkpoints.length}`);
        text('sprintCheckpointName', race.nextCheckpoint < race.checkpoints.length
          ? race.checkpoints[race.nextCheckpoint].name
          : 'Finish line');
      }
      if (dashboardUpdateTimer >= 1) {
        updateDriverStats();
        dashboardUpdateTimer = 0;
      }

      car.root.position.y = s.suspensionY;
      car.root.rotation.x = s.suspensionPitch;
      car.root.rotation.z = s.suspensionRoll;

      impactShake = damp(impactShake, 0, 4, dtSec);
      const sh = impactShake * 0.15 * Math.sin(performance.now() * 0.08);

      const cp = camSet[camIndex];
      const cockpit = cp.id === 'cockpit';
      const cameraPos = cockpit ? [cp.pos[0] + cockpitOffset, cp.pos[1] + cockpitOffsetY, cp.pos[2]] : cp.pos;
      const cameraLook = cockpit ? [cp.look[0] + cockpitOffset, cp.look[1] + cockpitOffsetY * 0.25, cp.look[2]] : cp.look;

      if (cp.rigid || cp.smooth === 0) {
        if (!cam.init) cam.local.set(...cameraPos);
        else cam.local.lerp(v3.set(...cameraPos), cp.smooth === 0 ? 1 : 1 - Math.exp(-8 * dtSec));
        cam.pos.copy(rig.localToWorld(v3.copy(cam.local)));
      } else {
        const want = rig.localToWorld(v3.set(...cameraPos));
        if (!cam.init) cam.pos.copy(want);
        else cam.pos.lerp(want, 1 - Math.exp(-cp.smooth * dtSec));
        cam.local.copy(rig.worldToLocal(v3.copy(cam.pos)));
      }
      cam.init = true;

      camera.position.copy(cam.pos);
      camera.position.y += sh;

      camera.lookAt(rig.localToWorld(v3.set(...cameraLook)));
      if (cp.roll) camera.rotateZ(THREE.MathUtils.degToRad(cp.roll));

      const targetFov = cp.id === 'cockpit'
      ? cockpitFov
      : cp.fixedFov
      ? cp.fov
      : (cp.fov || 72) + s.speed * 0.14 + (s.boosting ? 8 : 0);
      camera.fov = damp(camera.fov, targetFov, 6, dtSec);

      camera.updateProjectionMatrix();

      routeWorldStream.update(s.x, s.z);
      centerGroundOn(s.x, s.z);
      const speedKph = Math.round(s.speed * 3.6);
      text('engineRpm', String(Math.round(s.rpm)));
      const tachometer = $('tachometer-needle')?.closest('.tachometer');
      if (tachometer) {
        const gaugeRpm = THREE.MathUtils.clamp(s.rpm, 0, 8000);
        const gaugeAngle = -135 + gaugeRpm / 8000 * 270;
        tachometer.setAttribute(
          'aria-label',
          `Tachometer: ${Math.round(s.rpm)} RPM`
        );
        $('tachometer-needle').setAttribute('transform', `rotate(${gaugeAngle} 130 130)`);
      }
      text('dashboardSpeed', `${speedKph} KM/H`);
      text('dashboardRpm', `${Math.round(s.rpm)} RPM`);
      text('dashboardGear', s.reverse ? 'R' : s.speed < 0.5 && s.throttle < 0.05 ? 'N' : `D${s.gear + 1}`);
      text('dashboardNitro', `${Math.round(s.nitro * 100)}%`);
      text(
        'gear',
        s.reverse ? 'R' : s.speed < 0.5 && s.throttle < 0.05 ? 'N' : 'D' + (s.gear + 1)
      );

      text('steering', `STEERING: ${Math.round(controls.steer * 30)}°`);
      const boostFill = $('boostFill');
      if (boostFill) boostFill.style.width = s.nitro * 100 + '%';
      text('boostPercent', Math.round(s.nitro * 100) + '%');

      text(
        'message',
        performance.now() < lightsMsgUntil
        ? 'Headlights ' + (headlightsOn ? 'ON' : 'OFF') + ' · L to toggle'
        : arrivedAt && performance.now() - arrivedAt < 7000
        ? 'Arrived · ' + endName + ' · M for routes'
        : !surface.onRoad
        ? 'Off road — grip reduced'
        : s.drifting
        ? 'Drifting — counter-steer!'
        : lastImpact > 6 && impactShake > 0.2
        ? 'Crash!'
        : 'Driving · C camera · R radio'
      );

      renderer.render(scene, camera);

      const ns = scaler.sample(dtSec * 1000);
      if (ns) gfx.setScale(ns);

      overlay?.(
        dtSec * 1000,
        `speed ${(s.speed * 3.6).toFixed(0)} km/h  gear ${s.gear + 1}\n` +
        `scale ${gfx.scale}  surf ${surface.onRoad ? 'road' : 'grass'}`
      );

      game.stats = {
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        geoms: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        scale: gfx.scale,
        wheelsOk: car.ok,
        lastImpact
      };
    };

    loop = createLoop({
      step,
      render,
      fixedDt: C.sim.fixedDt,
      maxSubSteps: C.sim.maxSubSteps
    });
    game.loop = loop;
    syncRunState();

    await progress(0.78, 'Warming up the engine');
    if (renderer.compileAsync) {
      await renderer.compileAsync(scene, camera);
    }

    render(0, C.sim.fixedDt);

    const loading = $('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => { loading.style.display = 'none'; }, 450);
    }

    await progress(0.95, 'Almost there');
    game.routeReady = true;
    game.routeLoading = false;
    console.log('[HOOD] Route ready:', route.id);
    emit('hood:route-ready', { routeId });

    if (new URLSearchParams(location.search).has('menu')) {
      game.userPaused = true;
      showMenuView('home');
      syncRunState();
    }

    beginSession();
  } catch (e) {
    routeWorldStream?.dispose();
    if (worldVisualStream === routeWorldStream) worldVisualStream = null;
    for (const o of added) o.parent?.remove(o);
    loop?.stop?.();
    loop = null;
    game.loop = null;
    game.routeReady = false;
    game.routeLoading = false;
    game.route = null;
    game.world = null;
    game.sim = null;
    game.race = null;
    game.circuit = null;
    game.carRoot = null;
    const navigationMap = $('navigationMap');
    if (navigationMap) navigationMap.hidden = true;
    document.body.classList.remove('navigation-map-active');
    game.error = String(e);
    console.error('[HOOD] Route load failed:', e);
    text('message', 'Failed to load route: ' + (e.message || e));
    emit('hood:route-error', { message: e.message || String(e) });
  }
}

window.addEventListener('hood:select-route', (e) => {
  const d = e.detail || {};
  const params = new URLSearchParams(location.search);
  if (params.has('picker')) {
    for (const key of ['picker', 'route', 'car', 'mode', 'autostart', 'hoodFlow']) params.delete(key);
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  }
  const cur = game.session;
  const changed = cur && (
    cur.routeId !== d.routeId ||
    cur.carId !== (d.carId || game.defaultCar) ||
    cur.mode !== (d.mode || 'free-drive')
  );
  if ((game.routeReady || game.routeLoading) && !game.started && changed) { changeRoute(); return; }
  loadRoute(d.routeId, d);
});

function changeRoute() {
  window.dispatchEvent(new Event('hood:route-switching'));
  try { sessionStorage.setItem('hood.returnToRoutes', '1'); } catch { /* storage blocked */ }

  history.replaceState(null, '', location.pathname + '?picker=1');
  location.reload();
}

bootEngine().catch((e) => {
  game.error = String(e);
  console.error('[HOOD] Boot failed:', e);
  text('message', 'Failed to start: ' + e.message);

  const loading = $('loading');
  if (loading) {
    loading.textContent = 'FAILED TO LOAD — see console';
    loading.style.opacity = '1';
    loading.style.display = 'block';
  }

  window.dispatchEvent(
    new CustomEvent('hood:boot-error', { detail: { message: e.message || String(e) } })
  );
});
