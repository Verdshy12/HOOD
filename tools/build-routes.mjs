// tools/build-routes.mjs — stitches the "real road" routes out of OSM ways already in the tile.
// usage: node tools/build-routes.mjs [data/tiles/state-house.json] [data/routes/real-road-v1.2.2.json]
import fs from 'node:fs';
const [,, tileFile = 'data/tiles/state-house.json', outFile = 'data/routes/real-road-v1.2.2.json'] = process.argv;
const tile = JSON.parse(fs.readFileSync(tileFile, 'utf8'));
const byId = new Map(tile.roads.map((r) => [r.id, r]));
const way = (id) => {
  const r = byId.get(id); if (!r) throw new Error('way ' + id + ' is not in ' + tileFile + ' (rebuild the tile with a larger radius?)');
  const p = []; for (let i = 0; i < r.pts.length; i += 2) p.push([r.pts[i], r.pts[i + 1]]); return p;
};
const join = (...segs) => { const o = []; for (const s of segs) for (const q of s) { const l = o[o.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.01) o.push(q); } return o; };
const len = (p) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
const flat = (p) => p.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);

// State House Avenue (4716860) is long; the route starts at the origin node (0,0), where the v1.2.1 spawn sits.
const shaFull = way(4716860), o = shaFull.findIndex(([x, z]) => x === 0 && z === 0);
if (o < 0) throw new Error('origin node (0,0) not found on way 4716860');
const sha = shaFull.slice(o), link = way(680343415), kenE = way(1151073357), kenW = way(1151075683);

// Eastbound: State House Ave -> junction link -> Kenyatta Ave (one-way eastbound carriageway)
const east = join(sha, link.slice().reverse(), kenE.slice(1));
// Westbound: Kenyatta Ave westbound carriageway -> one-way junction pieces -> back onto State House Ave
const west = join(kenW, way(1302594569), way(1305319781), way(1305321294), kenE.slice(1, 2), link, sha.slice().reverse());

const routes = [
  { id: 'state-house-eastbound', short: 'Eastbound', name: 'State House Avenue to Nairobi Gallery', w: 8, pts: flat(east),
    blurb: 'Out of State House Avenue, through the Kenyatta Avenue junction, down to the Uhuru Highway roundabout.',
    ways: [4716860, 680343415, 1151073357],
    landmarks: [{ name: 'State House Avenue', at: 'start' }, { name: 'Kenyatta Avenue junction', x: 343.2, z: 132.9 },
                { name: 'Nairobi Gallery approach', at: 'end', note: 'The Gallery itself is ~80 m beyond the end of the map data.' }] },
  { id: 'state-house-westbound', short: 'Westbound', name: 'Nairobi Gallery to State House Avenue', w: 8, pts: flat(west),
    blurb: 'Back from the CBD edge on the westbound carriageway, round the junction loop and up State House Avenue.',
    ways: [1151075683, 1302594569, 1305319781, 1305321294, 1151073357, 680343415, 4716860],
    landmarks: [{ name: 'Nairobi Gallery approach', at: 'start' }, { name: 'Kenyatta Avenue junction', x: 343.2, z: 132.9 }, { name: 'State House Avenue', at: 'end' }] },
];
routes.forEach((r) => { r.lengthM = Math.round(len(r.pts.reduce((a, v, i) => (i % 2 ? (a[a.length - 1].push(v), a) : (a.push([v]), a)), []))); });

const placeholders = [
  { id: 'ngong-road', short: 'Coming soon', name: 'Ngong Road', blurb: 'Nairobi Hill towards Upper Hill.' },
  { id: 'valley-road', short: 'Coming soon', name: 'Valley Road', blurb: 'The long curve past Ralph Bunche Road.' },
  { id: 'processional-way', short: 'Coming soon', name: 'Processional Way', blurb: 'Along the northern edge of the hood.' },
  { id: 'free-roam', short: 'Coming soon', name: 'Free roam', blurb: 'Pick any street and just drive.' },
];
fs.mkdirSync(outFile.replace(/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ version: '1.2.2', drivingSide: 'left', routes, placeholders }));
for (const r of routes) console.log(r.id, r.lengthM + ' m', r.pts.length / 2 + ' pts');
