// tools/vendor-three.mjs — copy exactly the Three.js files the game needs into ./vendor (no CDN at runtime).
// usage: npm i three && node tools/vendor-three.mjs
import fs from 'node:fs'; import path from 'node:path';
const src = 'node_modules/three', dst = 'vendor/three';
const files = ['build/three.module.js', 'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/libs/meshopt_decoder.module.js'];
for (const f of files) { const to = path.join(dst, f.replace('examples/jsm/', 'addons/')); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(src, f), to); }
console.log('vendored', files.length, 'files, three r' + JSON.parse(fs.readFileSync(src + '/package.json')).version.split('.')[1]);
