// src/config.js — vehicle, map and simulation settings.
export const CONFIG = {
  // Default vehicle values (main.js reads car.model at boot).
  car: {
    model: './models/dodge.glb',
    targetLength: 5.02,
    headingOffset: Math.PI,
    cockpit: [-0.42, 1.18, 0.15],
    chase: [0, 2.6, 7.2],
    chaseLook: [0, 1.0, -4.0]
  },

  // Cars shown in the splash picker. Each entry overrides the values in `car`.
  cars: {
    dodge: {
      name: 'Dodge Challenger R/T',
      model: './models/dodge.glb',
      targetLength: 5.02,
      headingOffset: Math.PI,
      cockpit: [-0.42, 1.18, 0.15],
      chase: [0, 2.6, 7.2],
      chaseLook: [0, 1.0, -4.0]
    },

    subaru: {
      name: '2006 Subaru Impreza WRX STI',
      model: './models/2006_subaru/subaru-wrx-sti.glb',
      targetLength: 4.42,
      headingOffset: Math.PI,
      cockpit: [-0.42, 1.12, 0.15],
      chase: [0, 2.6, 7.2],
      chaseLook: [0, 1.0, -4.0],
      steeringWheel: { split: { center: [-0.35, 0.90, -0.30], radius: 0.14, thickness: 0.11}, tilt: 25}
      },

    nissan_x_trail: {
      name: 'Nissan X Trail',
      model: './models/nissan_x_trail.glb',
      targetLength: 4.65,
      headingOffset: Math.PI,
      cockpit: [-0.30, 0.95, 0.10],
      chase: [0, 2.2, 5.8],
      chaseLook: [0, 0.8, -3.0]
    },

    'nissan-skyline-r34-gt-r': {
      name: 'Nissan Skyline R34 GT-R',
      model: './models/nissan_skyline_r34_gt-r.glb',
      targetLength: 4.65,
      headingOffset: Math.PI,
      wheelLayout: 'skyline-r34'
    }
  },
  defaultCar: 'dodge',

  // JSON file with the route definitions ({ routes: [ { id, name, short, spawn, path, ... } ] }).
  // main.js fetches this at boot. CHECK THIS PATH against your data/ folder.
  routes: {
    file: './data/routes/all-routes.json'
  },

  // Route registry (informational for now; main.js does not read it yet).
  // Keys must match the route ids inside the routes JSON above.
  routeRegistry: {
    'state-house-eastbound': {
      name: 'State House Avenue to Nairobi Gallery',
      tile: './data/tiles/state-house.json'
    }
  },

  defaultRoute: 'state-house-eastbound',

  // Map tile loaded for the selected route.
  map: {
    tile: './data/tiles/state-house.json'
  },

  sim: {
    fixedDt: 1 / 120,
    maxSubSteps: 6
  },

  gfx: {
    maxPixelRatio: 1.5,
    minScale: 0.6,
    targetFps: 45,
    fogNear: 90,
    fogFar: 380,
    sky: 0x91b9d1
  }
};
