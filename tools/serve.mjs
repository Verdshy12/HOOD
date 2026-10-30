import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelManifest } from './model-manifest.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDirectory = path.join(workspace, 'models');
buildModelManifest(modelsDirectory);

let refreshTimer;
const modelWatcher = watch(modelsDirectory, { recursive: true }, () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    try {
      const { models } = buildModelManifest(modelsDirectory);
      console.log(`[HOOD] Model manifest refreshed (${models.length} models)`);
    } catch (error) {
      console.error('[HOOD] Failed to refresh model manifest:', error);
    }
  }, 300);
});
modelWatcher.on('error', (error) => {
  console.error('[HOOD] Model directory watcher failed:', error);
  process.exitCode = 1;
});

const server = spawn('python3', ['-m', 'http.server', '8080'], {
  cwd: workspace,
  stdio: 'inherit'
});
const shutdown = () => server.kill('SIGINT');
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

server.once('error', (error) => {
  modelWatcher.close();
  console.error('[HOOD] Could not start the static server:', error);
  process.exitCode = 1;
});
server.once('exit', (code, signal) => {
  clearTimeout(refreshTimer);
  modelWatcher.close();
  process.exitCode = signal ? 1 : (code ?? 1);
});
