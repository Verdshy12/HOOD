import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultModelsDirectory = path.join(workspace, 'models');

function modelId(relativePath) {
  const id = relativePath
    .replace(/\.glb$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) throw new Error(`Could not create a model ID for "${relativePath}"`);
  return id;
}

function modelName(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findGlbFiles(directory, relativeDirectory = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findGlbFiles(fullPath, relativePath);
      return entry.isFile() && /\.glb$/i.test(entry.name) ? [relativePath] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

export function buildModelManifest(modelsDirectory = defaultModelsDirectory) {
  const ids = new Set();
  const models = findGlbFiles(modelsDirectory).map((relativePath) => {
    const id = modelId(relativePath);
    if (ids.has(id)) throw new Error(`Duplicate model ID "${id}" from "${relativePath}"`);
    ids.add(id);
    const encodedPath = relativePath.split(path.sep).map(encodeURIComponent).join('/');
    return {
      id,
      name: modelName(relativePath),
      model: `./models/${encodedPath}`
    };
  });
  const manifest = JSON.stringify({ models }, null, 2) + '\n';
  const manifestPath = path.join(modelsDirectory, 'manifest.json');
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifest) {
    fs.writeFileSync(manifestPath, manifest);
  }
  return { models, manifestPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { models, manifestPath } = buildModelManifest();
  console.log(`Wrote ${models.length} model(s) to ${manifestPath}`);
}
