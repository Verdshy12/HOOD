/* HOOD Radio — music/radio.js (v1.2.1)
 *
 * Self-contained, silent-by-default music player for HOOD.
 *
 * Integration contract with the game (nothing else is shared):
 *   LISTENS  window  "hood:session-started"   -> radio becomes visible + keys go live
 *   READS    window.__game.sim.speed          -> optional, only for the "slow down" tip
 *   EXPOSES  window.HOODRadio                 -> small public API (see bottom of file)
 *   EMITS    window  "hood:radio-ready" | "hood:radio-state" | "hood:radio-menu"
 *
 * The radio never touches Three.js, the render loop or the engine's Web Audio
 * context. It plays through its own <audio> element.
 */

// ---------- Paths (resolved from this file's own URL, so sub-folder hosting works) ----------
const ROOT = new URL('../', import.meta.url);
const MUSIC_DIR = new URL('Files/Media/music/', ROOT);
const CATALOGUE_SOURCES = [
  new URL('music/playlist.php', ROOT),   // preferred: checks files exist on the server
  new URL('music/playlist.json', ROOT)   // static fallback: same data, no PHP needed
];

// Exact, case-sensitive file names only. No folders, no "..", no odd characters.
const AUDIO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp3|ogg|oga|opus|m4a|aac|wav|flac)$/;
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp|gif|svg)$/;

const VOLUME_KEY = 'hood.radio.volume';
const ROUTE_PLAYBACK_KEY = 'hood.radio.route-playback';
const DEFAULT_VOLUME = 0.6;
const RESTART_THRESHOLD_S = 3;   // "previous" restarts the song if it is past this point
const SLOW_KMH = 30;             // above this the overlay nudges the player to slow down
const STANDALONE = window.HOOD_RADIO_STANDALONE === true;

// ---------- Icons ----------
const ICON = {
  play:  '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  prev:  '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next:  '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z"/></svg>',
  vol:   '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute:  '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  list:  '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

const TEMPLATE = `
  <section class="hr-widget" aria-label="HOOD Radio" hidden>
    <div class="hr-top">
      <div class="hr-art" aria-hidden="true">
        <span>♪</span><img alt="" hidden>
      </div>
      <div class="hr-meta">
        <div class="hr-label"><span>HOOD RADIO</span>
          <span class="hr-viz" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="hr-title">Radio off</div>
        <div class="hr-artist">Press R to choose a track</div>
      </div>
      <button type="button" class="hr-btn hr-list" title="Playlist (R)" aria-label="Open playlist">${ICON.list}</button>
    </div>
    <div class="hr-progress">
      <span class="hr-time hr-cur">0:00</span>
      <input class="hr-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek" disabled>
      <span class="hr-time hr-dur">0:00</span>
    </div>
    <div class="hr-controls">
      <button type="button" class="hr-btn hr-prev" title="Previous ( [ )" aria-label="Previous track">${ICON.prev}</button>
      <button type="button" class="hr-btn hr-play" title="Play / Pause" aria-label="Play">${ICON.play}</button>
      <button type="button" class="hr-btn hr-next" title="Next ( ] )" aria-label="Next track">${ICON.next}</button>
      <button type="button" class="hr-btn hr-mute" title="Mute" aria-label="Mute">${ICON.vol}</button>
      <input class="hr-volume" type="range" min="0" max="100" step="1" value="60" aria-label="Volume">
    </div>
  </section>

  <div class="hr-overlay" role="dialog" aria-modal="false" aria-label="HOOD Radio playlist" hidden>
    <div class="hr-panel">
      <header class="hr-panel-head">
        <div><h2>HOOD RADIO</h2><p class="hr-count"></p></div>
        <button type="button" class="hr-btn hr-close" title="Close (R / Esc)" aria-label="Close playlist">${ICON.close}</button>
      </header>
      <p class="hr-hint"></p>
      <ul class="hr-tracks"></ul>
      <footer class="hr-panel-foot">
        <kbd>R</kbd> / <kbd>Esc</kbd> close · <kbd>[</kbd> <kbd>]</kbd> prev / next · music keeps playing
      </footer>
    </div>
  </div>`;

// ---------- State ----------
const state = {
  tracks: [],
  loaded: false,
  index: -1,          // -1 = nothing chosen yet
  wantPlay: false,    // the player's intention: should audio be playing?
  enabled: false,     // becomes true when the driving session starts
  menuOpen: false,
  volume: readVolume(),
  muted: false,
  status: ''          // short transient message (missing file, etc.)
};

const audio = new Audio();
audio.preload = 'none';           // nothing is downloaded until a song is chosen
audio.volume = state.volume;

// ---------- DOM ----------
const mount = document.getElementById('hood-radio') || document.body;
const root = document.createElement('div');
root.className = 'hood-radio';
root.innerHTML = TEMPLATE;
mount.appendChild(root);

const q = (selector) => root.querySelector(selector);
const el = {
  widget: q('.hr-widget'),
  artBox: q('.hr-art'),
  artImg: q('.hr-art img'),
  artIcon: q('.hr-art span'),
  title: q('.hr-title'),
  artist: q('.hr-artist'),
  cur: q('.hr-cur'),
  dur: q('.hr-dur'),
  seek: q('.hr-seek'),
  play: q('.hr-play'),
  prev: q('.hr-prev'),
  next: q('.hr-next'),
  mute: q('.hr-mute'),
  volume: q('.hr-volume'),
  listBtn: q('.hr-list'),
  overlay: q('.hr-overlay'),
  count: q('.hr-count'),
  hint: q('.hr-hint'),
  tracks: q('.hr-tracks'),
  close: q('.hr-close')
};

// ---------- Helpers ----------
function readVolume() {
  try {
    const saved = parseFloat(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  } catch { /* storage blocked: fall through */ }
  return DEFAULT_VOLUME;
}

function saveVolume() {
  try { localStorage.setItem(VOLUME_KEY, String(state.volume)); } catch { /* ignore */ }
}

function fmt(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const trackUrl = (track) => (window.HOODMusicCache && window.HOODMusicCache.urlFor(track.file)) || new URL(track.file, MUSIC_DIR).href;   // v1.2.2: preloaded blob first
const artUrl = (track) => (track.art ? new URL(track.art, MUSIC_DIR).href : null);
const isPlayable = (track) => track.available && !track.failed;
const current = () => state.tracks[state.index] || null;

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

let statusTimer = 0;
function flash(message, ms = 3500) {
  state.status = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { state.status = ''; renderWidget(); }, ms);
  renderWidget();
}

/** Next playable index from `from` in direction `dir` (wraps). -1 if none. */
function findPlayable(from, dir) {
  const n = state.tracks.length;
  if (!n) return -1;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (isPlayable(state.tracks[i])) return i;
  }
  return -1;
}

// ---------- Catalogue ----------
function normalise(data) {
  const raw = Array.isArray(data) ? data : data && data.tracks;
  if (!Array.isArray(raw)) return [];

  const out = [];
  for (const r of raw) {
    if (!r || typeof r.file !== 'string' || !AUDIO_FILE.test(r.file)) {
      console.warn('[HOOD Radio] Skipping invalid playlist entry:', r);
      continue;
    }
    out.push({
      title: String(r.title || r.file).slice(0, 80),
      artist: String(r.artist || 'Unknown artist').slice(0, 80),
      file: r.file,
      art: typeof r.art === 'string' && IMAGE_FILE.test(r.art) ? r.art : null,
      duration: Number.isFinite(r.duration) && r.duration > 0 ? r.duration : null,
      available: r.available !== false,   // PHP reports false for files missing on disk
      failed: false                       // set at runtime if the browser can't load it
    });
  }
  return out;
}

let cataloguePromise = null;
function ensureCatalogue() {
  if (cataloguePromise) return cataloguePromise;

  cataloguePromise = (async () => {
    for (const url of CATALOGUE_SOURCES) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) continue;
        // A static host may return PHP source as text: .json() throws, we move on.
        const tracks = normalise(await res.json());
        if (tracks.length) {
          state.tracks = tracks;
          break;
        }
      } catch { /* try next source */ }
    }
    state.loaded = true;
    renderWidget();
    renderList();
  })();

  return cataloguePromise;
}

// ---------- Rendering ----------
function renderWidget() {
  const track = current();
  const hasTracks = state.tracks.length > 0;

  let title = 'Radio off';
  let sub = 'Press R to choose a track';

  if (track) {
    title = track.title;
    sub = track.artist;
  } else if (state.loaded && !hasTracks) {
    title = 'No music found';
    sub = 'Add songs to /Files/Media/music/';
  }
  if (state.status) sub = state.status;

  el.title.textContent = title;
  el.title.title = title;
  el.artist.textContent = sub;
  el.artist.classList.toggle('is-status', Boolean(state.status));

  const playing = state.wantPlay;
  root.classList.toggle('is-playing', playing);
  el.play.innerHTML = playing ? ICON.pause : ICON.play;
  el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.play.disabled = state.loaded && !hasTracks;

  el.mute.innerHTML = state.muted || state.volume === 0 ? ICON.mute : ICON.vol;
  el.mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');

  const shown = state.muted ? 0 : Math.round(state.volume * 100);
  el.volume.value = String(shown);
  el.volume.style.setProperty('--p', shown + '%');

  // Artwork (optional). Falls back to the gradient + note.
  const art = track && artUrl(track);
  if (art) {
    if (el.artImg.getAttribute('src') !== art) el.artImg.src = art;
    el.artImg.hidden = false;
  } else {
    el.artImg.hidden = true;
    el.artImg.removeAttribute('src');
  }

  root.classList.toggle('is-menu-open', state.menuOpen);
  el.listBtn.setAttribute('aria-label', state.menuOpen ? 'Close playlist' : 'Open playlist');

  syncMediaSession(track);
  emit('hood:radio-state', publicState());
}

function renderList() {
  const n = state.tracks.length;
  el.count.textContent = !state.loaded
    ? 'Loading…'
    : n === 1 ? '1 track' : `${n} tracks`;

  el.tracks.textContent = '';

  if (state.loaded && !n) {
    const li = document.createElement('li');
    li.className = 'hr-empty';
    li.textContent = 'No music found. Put audio files in /Files/Media/music/ and list them in /music/playlist.json.';
    el.tracks.appendChild(li);
    return;
  }

  state.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hr-track';
    btn.dataset.index = String(i);

    const missing = !track.available || track.failed;
    const isCurrent = i === state.index;
    btn.classList.toggle('is-current', isCurrent);
    btn.classList.toggle('is-missing', missing);
    if (isCurrent) btn.setAttribute('aria-current', 'true');

    const num = document.createElement('span');
    num.className = 'hr-num';
    num.textContent = isCurrent && state.wantPlay ? '▶' : String(i + 1);

    const text = document.createElement('span');
    text.className = 'hr-track-text';
    const t = document.createElement('div');
    t.className = 'hr-track-title';
    t.textContent = track.title;
    const a = document.createElement('div');
    a.className = 'hr-track-artist';
    a.textContent = track.artist;
    text.append(t, a);

    const tag = document.createElement('span');
    tag.className = 'hr-track-tag';
    tag.textContent = missing ? 'Missing file' : track.duration ? fmt(track.duration) : '';

    btn.append(num, text, tag);
    li.appendChild(btn);
    el.tracks.appendChild(li);
  });
}

function renderProgress() {
  const dur = audio.duration;
  const cur = audio.currentTime;
  const known = Number.isFinite(dur) && dur > 0;

  el.seek.disabled = !known;
  el.cur.textContent = fmt(cur);
  el.dur.textContent = known ? fmt(dur) : (current()?.duration ? fmt(current().duration) : '0:00');

  if (!seeking) {
    const pct = known ? (cur / dur) * 1000 : 0;
    el.seek.value = String(pct);
    el.seek.style.setProperty('--p', pct / 10 + '%');
  }
}

function syncMediaSession(track) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    const art = track && artUrl(track);
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: 'HOOD Radio',
          artwork: art ? [{ src: art }] : []
        })
      : null;
  } catch { /* unsupported: ignore */ }
}

// ---------- Playback ----------
function loadTrack(i, play) {
  const track = state.tracks[i];
  if (!track) return;

  state.index = i;
  state.status = '';
  audio.src = trackUrl(track);
  audio.preload = 'metadata';
  state.wantPlay = false;
  renderProgress();

  if (play) startPlayback();
  else renderWidget();
  renderList();
}

async function startPlayback() {
  if (!state.enabled) return false;
  await ensureCatalogue();

  if (state.index < 0) {
    const first = findPlayable(-1, 1);
    if (first < 0) {
      flash(state.tracks.length ? 'No playable songs found' : 'No music found');
      return false;
    }
    loadTrack(first, false);
  }

  state.wantPlay = true;
  renderWidget();
  renderList();

  try {
    await audio.play();
  } catch (err) {
    if (err && err.name === 'AbortError') return true;        // superseded by another load
    if (err && err.name === 'NotAllowedError') {
      state.wantPlay = false;
      flash('Browser blocked audio — press play again');
      return false;
    }
    // NotSupportedError / load failures are handled by the "error" listener.
  }
  renderWidget();
  renderList();
  return true;
}

function pausePlayback() {
  state.wantPlay = false;
  audio.pause();
  renderWidget();
  renderList();
}

function saveRoutePlayback() {
  const track = current();
  if (!state.enabled || !track) return;
  try {
    sessionStorage.setItem(ROUTE_PLAYBACK_KEY, JSON.stringify({
      file: track.file,
      time: audio.currentTime || 0,
      playing: state.wantPlay,
      savedAt: Date.now()
    }));
  } catch (error) {
    console.warn('[HOOD Radio] Could not preserve playback across route selection:', error);
  }
}

function restoreRoutePlayback() {
  let saved;
  try {
    const raw = sessionStorage.getItem(ROUTE_PLAYBACK_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(ROUTE_PLAYBACK_KEY);
    saved = JSON.parse(raw);
  } catch (error) {
    console.warn('[HOOD Radio] Could not restore playback after route selection:', error);
    return false;
  }

  if (!saved || typeof saved.file !== 'string' || !Number.isFinite(saved.time) ||
      typeof saved.playing !== 'boolean' || !Number.isFinite(saved.savedAt)) return false;
  const index = state.tracks.findIndex((track) => track.file === saved.file && isPlayable(track));
  if (index < 0) return false;

  const elapsed = saved.playing ? Math.max(0, (Date.now() - saved.savedAt) / 1000) : 0;
  const seekAndResume = () => {
    const duration = audio.duration;
    const targetTime = saved.time + elapsed;
    audio.currentTime = Number.isFinite(duration) && duration > 0
      ? targetTime % duration
      : targetTime;
    if (saved.playing) startPlayback();
  };

  if (audio.readyState >= 1) {
    loadTrack(index, false);
    seekAndResume();
  } else {
    const onLoadedMetadata = () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      seekAndResume();
    };
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    loadTrack(index, false);
  }
  return true;
}

function togglePlay() {
  if (!state.enabled) return;
  if (state.wantPlay) pausePlayback();
  else startPlayback();
}

function step(dir) {
  if (!state.enabled) return;
  ensureCatalogue().then(() => {
    // "Previous" restarts the current song first, like most players.
    if (dir < 0 && state.index >= 0 && audio.currentTime > RESTART_THRESHOLD_S) {
      audio.currentTime = 0;
      return;
    }
    const from = state.index < 0 ? (dir > 0 ? -1 : 0) : state.index;
    const target = findPlayable(from, dir);
    if (target < 0) { flash('No playable songs found'); return; }
    loadTrack(target, state.wantPlay);
  });
}

function selectTrack(i) {
  if (!state.enabled) return;
  const track = state.tracks[i];
  if (!track) return;

  if (i === state.index) { togglePlay(); return; }

  if (!track.available) {
    flash(`“${track.title}” — file missing on server`);
    return;
  }
  track.failed = false;            // let the player retry a song that failed earlier
  loadTrack(i, true);
}

function setVolume(value) {
  state.volume = Math.min(1, Math.max(0, value));
  if (state.volume > 0) state.muted = false;
  audio.muted = state.muted;
  audio.volume = state.volume;
  saveVolume();
  renderWidget();
}

function toggleMute() {
  state.muted = !state.muted;
  audio.muted = state.muted;
  renderWidget();
}

// ---------- Playlist overlay ----------
let hintTimer = 0;

function updateHint() {
  const sim = window.__game && window.__game.sim;
  const kmh = sim && Number.isFinite(sim.speed) ? Math.abs(sim.speed) * 3.6 : 0;
  const fast = kmh > SLOW_KMH;
  el.hint.classList.toggle('is-warn', fast);
  el.hint.textContent = fast
    ? `You're doing ${Math.round(kmh)} km/h — slow down before browsing. The road won't wait.`
    : 'Tip: slow down while browsing — the game keeps running.';
}

function openMenu() {
  if (!state.enabled || state.menuOpen) return;
  state.menuOpen = true;
  el.overlay.hidden = false;
  ensureCatalogue();
  renderList();
  renderWidget();
  updateHint();
  hintTimer = setInterval(updateHint, 500);

  const currentRow = el.tracks.querySelector('.is-current');
  if (currentRow && currentRow.scrollIntoView) currentRow.scrollIntoView({ block: 'nearest' });
  emit('hood:radio-menu', { open: true });
}

function closeMenu() {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  el.overlay.hidden = true;
  clearInterval(hintTimer);
  renderWidget();
  emit('hood:radio-menu', { open: false });   // audio is NOT touched: music keeps playing
}

function toggleMenu() {
  if (state.menuOpen) closeMenu();
  else openMenu();
}

// ---------- Events ----------
// Audio element
audio.addEventListener('timeupdate', renderProgress);
audio.addEventListener('loadedmetadata', () => {
  const track = current();
  if (track && Number.isFinite(audio.duration)) track.duration = audio.duration;
  renderProgress();
  if (state.menuOpen) renderList();
});
audio.addEventListener('durationchange', renderProgress);

audio.addEventListener('ended', () => {
  const next = findPlayable(state.index, 1);
  if (next < 0) { state.wantPlay = false; renderWidget(); renderList(); return; }
  if (next === state.index) {                 // only one playable song: repeat it
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  loadTrack(next, true);
});

audio.addEventListener('error', () => {
  const track = current();
  if (!track || !audio.getAttribute('src')) return;

  track.failed = true;

  if (state.wantPlay) {
    const next = findPlayable(state.index, 1);   // failed tracks are skipped, so this terminates
    if (next >= 0) loadTrack(next, true);
    else { state.wantPlay = false; renderWidget(); }
  }
  // Flash after loadTrack(), which clears any earlier status message.
  flash(`Can't play “${track.title}” — file missing, skipped`);
  renderList();
});

// Seek bar
let seeking = false;
el.seek.addEventListener('input', () => {
  seeking = true;
  const dur = audio.duration;
  el.seek.style.setProperty('--p', el.seek.value / 10 + '%');
  if (Number.isFinite(dur)) el.cur.textContent = fmt((el.seek.value / 1000) * dur);
});
el.seek.addEventListener('change', () => {
  const dur = audio.duration;
  if (Number.isFinite(dur)) audio.currentTime = (el.seek.value / 1000) * dur;
  seeking = false;
});

// Widget buttons
el.play.addEventListener('click', togglePlay);
el.prev.addEventListener('click', () => step(-1));
el.next.addEventListener('click', () => step(1));
el.mute.addEventListener('click', toggleMute);
el.listBtn.addEventListener('click', toggleMenu);
el.close.addEventListener('click', closeMenu);
el.volume.addEventListener('input', () => setVolume(Number(el.volume.value) / 100));
el.tracks.addEventListener('click', (event) => {
  const row = event.target.closest('.hr-track');
  if (row) selectTrack(Number(row.dataset.index));
});

// Never keep keyboard focus on a radio control: otherwise Space (handbrake) would
// "click" the last-pressed button and the arrow keys would move the volume slider
// instead of steering.
root.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) button.blur();
});
root.addEventListener('change', (event) => event.target.blur && event.target.blur());
root.addEventListener('pointerup', (event) => {
  const range = event.target.closest('input[type="range"]');
  if (range) setTimeout(() => range.blur(), 0);
});

// Keyboard shortcuts (R, Esc, [ and ]). Everything else is left to the game.
window.addEventListener('keydown', (event) => {
  if (!state.enabled) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;      // keep Ctrl/Cmd+R = reload

  const target = event.target;
  if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) ||
      (target.tagName === 'INPUT' && target.type !== 'range' && target.type !== 'checkbox'))) return;

  const key = event.key.toLowerCase();

  if (key === 'r') {
    if (!event.repeat) toggleMenu();
  } else if (key === 'escape') {
    if (state.menuOpen) { closeMenu(); event.preventDefault(); }
  } else if (key === '[') {
    if (!event.repeat) step(-1);
  } else if (key === ']') {
    if (!event.repeat) step(1);
  }
});

// Hardware media keys / lock-screen controls
if ('mediaSession' in navigator) {
  const handlers = {
    play: () => { if (!state.wantPlay) togglePlay(); },
    pause: () => { if (state.wantPlay) togglePlay(); },
    previoustrack: () => step(-1),
    nexttrack: () => step(1)
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
  }
}

// ---------- Enable when driving starts ----------
function enable() {
  if (state.enabled) return;
  state.enabled = true;
  el.widget.hidden = false;
  ensureCatalogue().then(() => {
    if (restoreRoutePlayback()) return;
    if (state.index < 0) {
      const first = findPlayable(-1, 1);
      if (first >= 0) loadTrack(first, false);
      else renderWidget();
    } else {
      renderWidget();
    }
  });
}

window.addEventListener('hood:session-started', enable);
window.addEventListener('hood:route-switching', saveRoutePlayback);
if (STANDALONE || (window.__game && window.__game.started)) enable();

// ---------- Public API ----------
function publicState() {
  const track = current();
  return {
    enabled: state.enabled,
    menuOpen: state.menuOpen,
    playing: state.wantPlay,
    volume: state.volume,
    muted: state.muted,
    index: state.index,
    trackCount: state.tracks.length,
    track: track ? { title: track.title, artist: track.artist, file: track.file } : null,
    currentTime: audio.currentTime || 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0
  };
}

window.HOODRadio = Object.freeze({
  open: openMenu,
  close: closeMenu,
  toggleMenu,
  play: () => { if (!state.wantPlay) return startPlayback(); },
  pause: pausePlayback,
  togglePlay,
  next: () => step(1),
  prev: () => step(-1),
  select: (i) => selectTrack(i),
  setVolume,
  getState: publicState
});

renderWidget();
renderList();
emit('hood:radio-ready', publicState());
