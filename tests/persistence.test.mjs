import { createStatsStore } from '../src/core/persistence.js';

const ok = (name, condition, info = '') => {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  [' + info + ']' : ''));
  if (!condition) process.exitCode = 1;
};

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    value() { return value; }
  };
}

const storage = memoryStorage();
const stats = createStatsStore(storage);
stats.startSession('dodge');
stats.addDrive('dodge', 120.5, 30);
stats.startSession('subaru');
stats.addDrive('subaru', 45, 12);
stats.flush();
const saved = createStatsStore(storage).snapshot();
ok('valid usage statistics persist per vehicle',
  saved.cars.dodge.distanceM === 120.5 && saved.cars.subaru.activeSeconds === 12);

const first = stats.recordSprint({ routeId: 'ngara', carId: 'dodge', timeSeconds: 72.4, checkpointsPassed: 4, totalCheckpoints: 4 });
const slower = stats.recordSprint({ routeId: 'ngara', carId: 'dodge', timeSeconds: 75, checkpointsPassed: 4, totalCheckpoints: 4 });
const faster = stats.recordSprint({ routeId: 'ngara', carId: 'dodge', timeSeconds: 70, checkpointsPassed: 4, totalCheckpoints: 4 });
const invalid = stats.recordSprint({ routeId: 'ngara', carId: 'dodge', timeSeconds: 60, checkpointsPassed: 3, totalCheckpoints: 4 });
ok('first valid sprint establishes a personal best', first.saved && first.personalBest);
ok('slower sprint keeps the faster personal best', slower.saved && !slower.personalBest && slower.bestSeconds === 72.4);
ok('faster sprint improves the personal best', faster.personalBest && faster.bestSeconds === 70);
ok('incomplete sprint is not recorded', !invalid.saved && stats.snapshot().sprints.ngara.dodge.completed === 3);

const malformed = createStatsStore(memoryStorage('{broken')).snapshot();
ok('malformed storage falls back to empty statistics', malformed.cars.dodge.distanceM === 0);
const invalidShape = createStatsStore(memoryStorage(JSON.stringify({ version: 99, cars: { dodge: { distanceM: 900 } } }))).snapshot();
ok('unsupported data version is ignored', invalidShape.cars.dodge.distanceM === 0);
const unavailable = createStatsStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
ok('unavailable storage remains usable in memory', unavailable.startSession('subaru') && unavailable.snapshot().cars.subaru.sessions === 1);