/* HOOD Radio — music/preload.js (v1.2.2)
 *
 * Downloads every playable track once while the splash is showing, so the radio starts instantly later.
 * Publishes window.HOODMusicCache.urlFor(file) -> blob: URL (or null). radio.js uses it when present and
 * falls back to the normal network URL otherwise, so a failed preload never breaks the radio.
 */
const ROOT = new URL('../', import.meta.url);
const MUSIC_DIR = new URL('Files/Media/music/', ROOT);
const SOURCES = [new URL('music/playlist.php', ROOT), new URL('music/playlist.json', ROOT)];
const AUDIO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp3|ogg|oga|opus|m4a|aac|wav|flac)$/;

const cache = new Map();
if (typeof window !== 'undefined') {
  window.HOODMusicCache = Object.freeze({
    urlFor: (file) => cache.get(file) || null,
                                        size: () => cache.size
  });
}

async function catalogue() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) continue;
      const data = await res.json();
      const list = (Array.isArray(data) ? data : data?.tracks || [])
        .filter((t) => t && typeof t.file === 'string' && AUDIO_FILE.test(t.file) && t.available !== false);
      if (list.length) return list;
    } catch { /* try the next source */ }
  }
  return [];
}

/** onProgress(p 0..1, label). Never rejects: missing music just means the radio streams normally. */
export async function preloadMusic(onProgress = () => {}) {
  const tracks = await catalogue();
  if (!tracks.length) { onProgress(1, 'No music found'); return; }
  const total = new Map(), got = new Map();
  const report = (label) => {
    let t = 0, g = 0; for (const [k, v] of total) { t += v; g += got.get(k) || 0; }
    onProgress(t ? Math.min(1, g / t) : 0, label);
  };
  const queue = tracks.slice();
  const worker = async () => {
    while (queue.length) {
      const track = queue.shift(), label = `Loading ${track.title || track.file}`;
      try {
        const res = await fetch(new URL(track.file, MUSIC_DIR));
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const len = Number(res.headers.get('content-length')) || 4e6;
        total.set(track.file, len); got.set(track.file, 0);
        const reader = res.body.getReader(), chunks = []; let n = 0;
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          chunks.push(value); n += value.length; got.set(track.file, Math.min(n, len)); report(label);
        }
        cache.set(track.file, URL.createObjectURL(new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' })));
        got.set(track.file, len);
      } catch (e) {
        console.warn('[HOOD Radio] preload failed, will stream instead:', track.file, e.message);
        total.set(track.file, 1); got.set(track.file, 1);
      }
      report(label);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  onProgress(1, 'Music ready');
}
