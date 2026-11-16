// src/config.js — vehicle, map and simulation settings.
const CAR_LIGHTS = {
  dodge: {
    head: [[-0.64, 0.70, -2.16], [0.64, 0.70, -2.16]],
    tail: [[-0.60, 0.88, 2.23], [0.60, 0.88, 2.23]],
    reverse: [[-0.33, 0.88, 2.23], [0.33, 0.88, 2.23]],
    headMaterial: 'LightA_Material1$',
    tailMaterial: '^red_glass$'
  },
  subaru: {
    head: [[-0.59, 0.64, -1.89], [0.59, 0.64, -1.89]],
    tail: [[-0.62, 0.87, 1.97], [0.62, 0.87, 1.97]],
    reverse: [[-0.57, 0.76, 2.05], [0.57, 0.76, 2.05]],
    headMaterial: '^spMAT_Lights_055$',
    tailMaterial: '^red_glass$'
  },
  skyline: {
    head: [[-0.56, 0.66, -2.07], [0.56, 0.66, -2.07]],
    tail: [[-0.63, 0.85, 2.16], [0.63, 0.85, 2.16]],
    reverse: [[-0.44, 0.82, 2.20], [0.44, 0.82, 2.20]],
    headMaterial: '^Material$',
    tailMaterial: '^Material\\.009$'
  }
};

export const CONFIG = {
  // Default vehicle values (main.js reads car.model at boot).
  car: {
    model: './models/dodge.glb',
    targetLength: 5.02,
    headingOffset: Math.PI,
    cockpit: [-0.42, 1.18, 0.15],
    chase: [0, 2.0, 5.7],
    chaseLook: [0, 0.95, -5.7]
  },

  // Cars shown in the splash picker. Each entry overrides the values in `car`.
  cars: {
    dodge: {
      name: 'Dodge Challenger R/T',
      model: './models/dodge.glb',
      previewImage: './assets/cars/dodge.png',
      targetLength: 5.02,
      headingOffset: Math.PI,
      careerUnlockAt: 1,
      initials: 'V8',
      type: 'V8 · MUSCLE',
      lights: CAR_LIGHTS.dodge,
      cockpit: [-0.42, 1.18, 0.15],
      chase: [0, 2.0, 5.7],
      chaseLook: [0, 0.95, -5.7]
    },

    'dodge-track': {
      name: 'Dodge Challenger · Track Spec',
      model: './models/dodge.glb',
      previewImage: './assets/cars/dodge-track.png',
      targetLength: 5.02,
      headingOffset: Math.PI,
      careerUnlockAt: 5,
      initials: 'RT',
      type: 'TRACK · V8',
      bodyColor: '#315b87',
      paintMaterials: ['dDodge_ChallengerRTShakerF7_2015Paint_Material1'],
      displayStats: ['280 KM/H', 'TRACK TUNE'],
      physics: { acceleration: 1.15, braking: 1.08, maxSpeed: 77.8 },
      lights: CAR_LIGHTS.dodge,
      cockpit: [-0.42, 1.18, 0.15],
      chase: [0, 2.0, 5.7],
      chaseLook: [0, 0.95, -5.7]
    },

    subaru: {
      name: '2006 Subaru Impreza WRX STI',
      model: './models/2006_subaru/subaru-wrx-sti.glb',
      previewImage: './assets/cars/subaru.png',
      targetLength: 4.42,
      headingOffset: Math.PI,
      careerUnlockAt: 0,
      initials: 'STI',
      type: 'RALLY · AWD',
      lights: CAR_LIGHTS.subaru,
      cockpit: [-0.42, 1.12, 0.15],
      chase: [0, 2.0, 5.7],
      chaseLook: [0, 0.95, -5.7],
      steeringWheel: { split: { center: [-0.35, 0.90, -0.30], radius: 0.14, thickness: 0.11}, tilt: 25}
      },

    'subaru-street': {
      name: 'Subaru Impreza · Street Spec',
      model: './models/2006_subaru/subaru-wrx-sti.glb',
      previewImage: './assets/cars/subaru-street.png',
      targetLength: 4.42,
      headingOffset: Math.PI,
      careerUnlockAt: 3,
      initials: 'ST',
      type: 'STREET · AWD',
      bodyColor: '#b82f3d',
      paintMaterials: ['sub_1MAT_Impreza_WRX_Base_067'],
      displayStats: ['245 KM/H', 'STREET TUNE'],
      physics: { acceleration: 1.08, braking: 1.02, maxSpeed: 68 },
      lights: CAR_LIGHTS.subaru,
      cockpit: [-0.42, 1.12, 0.15],
      chase: [0, 2.0, 5.7],
      chaseLook: [0, 0.95, -5.7],
      steeringWheel: { split: { center: [-0.35, 0.90, -0.30], radius: 0.14, thickness: 0.11}, tilt: 25}
    },

    'nissan-skyline-r34-gt-r': {
      name: 'Nissan Skyline R34',
      model: './models/nissan_skyline_r34_gt-r.glb',
      previewImage: './assets/cars/skyline-r34.png',
      targetLength: 4.65,
      headingOffset: Math.PI,
      careerUnlockAt: 4,
      initials: 'R34',
      type: 'TURBO · GT-R',
      lights: CAR_LIGHTS.skyline,
      cockpit: [-0.30, 0.95, 0.10],
      chase: [0, 1.9, 5.4],
      chaseLook: [0, 0.9, -5.3],
      wheelLayout: 'skyline-r34'
    },

    'nissan-skyline-r34-gt-r-street': {
      name: 'Nissan Skyline R34 · Street Spec',
      model: './models/nissan_skyline_r34_gt-r.glb',
      previewImage: './assets/cars/skyline-r34-street.png',
      targetLength: 4.65,
      headingOffset: Math.PI,
      careerUnlockAt: 7,
      initials: 'ST',
      type: 'STREET · TURBO',
      bodyColor: '#1685a2',
      paintMaterials: ['Material.001'],
      displayStats: ['270 KM/H', 'STREET TUNE'],
      physics: { acceleration: 1.12, braking: 1.05, maxSpeed: 75 },
      lights: CAR_LIGHTS.skyline,
      cockpit: [-0.30, 0.95, 0.10],
      chase: [0, 1.9, 5.4],
      chaseLook: [0, 0.9, -5.3],
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
