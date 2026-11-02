import fs from 'node:fs';

const tile = JSON.parse(
  fs.readFileSync('data/tiles/ngara-sprint.json', 'utf8')
);
const data = JSON.parse(
  fs.readFileSync('data/routes/ngara-circuit-candidates.json', 'utf8')
);

const roads = (tile.roads || []).map(road => {
  const pts = [];
  for (let i = 0; i < road.pts.length; i += 2) {
    pts.push([road.pts[i], road.pts[i + 1]]);
  }
  return { pts, width: road.w || 7 };
});

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2
    ? Math.max(0, Math.min(1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
    : 0;

  return Math.hypot(
    p[0] - (a[0] + t * dx),
    p[1] - (a[1] + t * dz)
  );
}

const segments = [];
for (const road of roads) {
  for (let i = 1; i < road.pts.length; i++) {
    segments.push({
      a: road.pts[i - 1],
      b: road.pts[i],
      width: road.width
    });
  }
}

function nearestRoadDistance(point) {
  let best = Infinity;
  let width = 7;

  for (const segment of segments) {
    const d = distanceToSegment(point, segment.a, segment.b);
    if (d < best) {
      best = d;
      width = segment.width;
    }
  }

  return { distance: best, width };
}

function validate(route) {
  const pts = [];
  for (let i = 0; i < route.pts.length; i += 2) {
    pts.push([route.pts[i], route.pts[i + 1]]);
  }

  const closure = Math.hypot(
    pts[0][0] - pts.at(-1)[0],
    pts[0][1] - pts.at(-1)[1]
  );

  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1]
    );
  }

  let outside = 0;
  let maxDistance = 0;

  for (const point of pts) {
    const nearest = nearestRoadDistance(point);
    maxDistance = Math.max(maxDistance, nearest.distance);

    if (nearest.distance > nearest.width / 2 + 3) outside++;
  }

  const closed = closure < 0.1;
  const sensibleLength = length >= 500 && length <= 6500;
  const roadCoverage = outside === 0;

  return {
    id: route.id,
    points: pts.length,
    length: Math.round(length),
    closure: +closure.toFixed(2),
    outside,
    maxDistance: +maxDistance.toFixed(2),
    valid: closed && sensibleLength && roadCoverage
  };
}

const results = data.routes.map(validate);

console.log('\n===== NGARA CIRCUIT VALIDATION =====');
for (const result of results) {
  console.log(
    `${result.valid ? 'PASS' : 'REVIEW'} ${result.id}` +
    ` | ${result.length}m` +
    ` | ${result.points} points` +
    ` | closure ${result.closure}m` +
    ` | outside road ${result.outside}` +
    ` | max deviation ${result.maxDistance}m`
  );
}

const passed = results.filter(r => r.valid);
console.log(`\nPassed: ${passed.length}/${results.length}`);
console.log('Not yet added to the live route catalogue.');
