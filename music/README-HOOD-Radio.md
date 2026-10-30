# HOOD Radio — v1.2.1 integration guide

HOOD Radio is a separate, silent-by-default music player. It has its own files and talks to the game through one event (`hood:session-started`). It does not touch the Three.js code, the render loop, or the engine's Web Audio.

Tested in headless Chromium against your v1.2 files with the edits below applied: silent start, R / Esc, music continuing after the menu closes, driving while the menu is open, track skipping, missing-file handling, and Space/arrow keys not being captured by the radio.

---

## 1. New files (add these)

    music/radio.js        player logic, keyboard shortcuts; builds its own widget + playlist overlay
    music/radio.css       styling (all classes prefixed .hood-radio / .hr-)
    music/playlist.json   the song list (this is the one you edit)
    music/playlist.php    serves that list and checks the files exist (optional, needs PHP)
    music/radio.php       standalone test page (optional, needs PHP)

Create the audio folder yourself (git does not keep empty folders):

    Files/Media/music/nightcall-overdrive.mp3
    Files/Media/music/song-two.mp3
    ...

---

## 2. Edits to existing files

### index.html — 3 changes

**a)** In `<head>`, right after the `style.css` link:

    <link rel="stylesheet" href="music/radio.css">

**b)** Delete the whole old block from `<!-- Radio / Music Panel -->` through the closing `</div>` of `#radio-panel` (the one containing `playBtn`, `prevBtn`, `nextBtn`, `volumeSlider`) and put this in its place:

    <!-- HOOD Radio mounts here (music/radio.js) -->
    <div id="hood-radio"></div>

**c)** Directly after the existing `src/main.js` script line:

    <script src="src/main.js" type="module"></script>
    <script src="music/radio.js" type="module"></script>

### src/main.js — 3 changes

**a)** Replace the audio import:

    // before
    import {
      startAudio, updateAudio, toggleRadio, changeTrack
    } from './audio/audio.js';

    // after
    import { startAudio, updateAudio } from './audio/audio.js';

**b)** In `createInput({ onKey })`, delete these three lines (keep `startAudio()` and the `c` line):

    if (k === 'r') toggleRadio();
    if (k === '[') changeTrack(-1);
    if (k === ']') changeTrack(1);

**c)** Delete the three click listeners for `playBtn`, `prevBtn` and `nextBtn`:

    $('playBtn')?.addEventListener('click', () => { ... });
    $('prevBtn')?.addEventListener('click', () => { ... });
    $('nextBtn')?.addEventListener('click', () => { ... });

(Keep the `camBtn` listener.)

### src/audio/audio.js — 1 change

Delete everything from the line `// ---------- Radio / Music ----------` to the end of the file. That removes the old synth tracks, `toggleRadio`, `changeTrack` and the old button/slider listeners. The engine sound above it is untouched.

Optional: change the first comment line to `// src/audio/audio.js — engine sound only (music lives in /music/radio.js)`.

Side effect worth knowing: the old code registered the play button's click handler in both `main.js` and `audio.js`, so one click toggled twice. Removing both fixes that.

### style.css — optional clean-up

Delete the `/* ---------- Radio / Music Panel ---------- */` block (`#radio-panel`, `.radio-header`, `.radio-play-btn`, `.radio-info`, `.track-title`, `.track-artist`, `.radio-controls`, `.radio-nav-btn`, `.volume-slider`) and the `#radio-panel { ... }` rule inside the `@media (max-width: 600px)` block. Leaving them does no harm; nothing uses them any more.

### README.md / package.json — optional

Controls line: `R = radio playlist · [ ] = previous / next track`. Layout list: add `music/  HOOD Radio (radio.js, radio.css, playlist.json/.php)`. Set `"version"` to `1.2.1`.

---

## 3. Adding songs

1. Put the file in `Files/Media/music/`.
2. Add an entry to `music/playlist.json`:

        { "title": "Song Name", "artist": "Artist", "file": "exact-file-name.mp3" }

   Optional fields: `"art": "cover.jpg"` (also in `Files/Media/music/`) and `"duration": 215` (seconds, shown in the list before the song has loaded).

Rules: use the **exact** file name including capitalization (case-sensitive hosts such as Linux treat `Song.mp3` and `song.mp3` as different files). Only letters, numbers, `.`, `_`, `-` are allowed, and no folders. Entries that break this are skipped with a console warning. Only add music you have permission to distribute.

The three entries now in `playlist.json` are placeholders from the spec. Songs whose files are missing show "Missing file" in the list and are skipped by next/previous.

---

## 4. How it behaves

- **Start Driving:** nothing plays. The widget stays hidden and the radio's keys do nothing until the session starts. No autoplay.
- **Widget (bottom-left, same slot as the old panel):** artwork, title, artist, progress/seek, times, previous / play-pause / next, mute, volume, playlist button, and small animated bars while playing.
- **R** opens the playlist overlay; **R** again or **Esc** closes it. The overlay does not pause the game, and it only captures the mouse inside its own panel. Music keeps playing when it closes.
- **[ and ]** previous / next. "Previous" restarts the song if it is more than 3 seconds in.
- **Slow-down tip:** while the overlay is open it reads `window.__game.sim.speed` (read-only) and warns above 30 km/h. If that object is missing, the tip stays on its default text.
- **Driving keys are never captured:** only R, Esc, `[` and `]`. Ctrl/Cmd+R still reloads the page. Radio buttons release keyboard focus after use, so Space (handbrake) and the arrow keys keep driving instead of pressing a button or moving a slider.
- There is no arrow-key navigation inside the playlist, because the arrows steer. Use the mouse or touch. The widget's list button covers phones with no R key.
- Volume is remembered in `localStorage`.

---

## 5. Integration point (for future work)

Listens on `window`: `hood:session-started`.

Emits on `window`: `hood:radio-ready`, `hood:radio-state` (detail = current state), `hood:radio-menu` (`{ open }`).

API (also usable from the console): `HOODRadio.open() close() toggleMenu() play() pause() togglePlay() next() prev() select(i) setVolume(0..1) getState()`.

---

## 6. Hosting and PHP (please read)

- **The radio works without PHP.** `radio.js` asks for `music/playlist.php` first. If the response is not valid JSON (a static host returns a 404 or the raw PHP source), it falls back to `music/playlist.json`. Both give the same list; PHP additionally checks that each file exists on the server.
- To my knowledge a standard static Vercel deployment does not run PHP; it needs a community PHP runtime or a different host. Please verify that against your current Vercel setup before relying on `playlist.php` or `radio.php`. The game does not need either.
- `radio.php` is a standalone test page. Open `/music/radio.php` on a PHP host to try the player without the game. I could not run PHP in my environment, so `playlist.php` and `radio.php` are written carefully but **untested**; the JSON fallback path is the one I tested.
- Local testing still needs a web server (`python3 -m http.server 8080`). Audio will not load from `file://`.

## 7. Known limits

- The visualizer is a CSS animation that runs while playing; it does not read the actual audio. A real analyser can be added later.
- iOS Safari ignores `audio.volume`; there the device volume buttons control loudness.
- No music files are included. The ones I used for testing were generated tones and are not part of this delivery.

## 8. Test checklist

1. Load, press Start Driving: silent, widget shows "Radio off".
2. Press R, pick a song: it plays. Press R / Esc: the menu closes, music continues, the car is still drivable.
3. Pause, volume, mute, seek, `[` `]`, and a song ending (should advance).
4. Temporarily rename an mp3: "Missing file" tag, skipped, no crash.
5. Press Space and arrows after clicking radio buttons: the car still handbrakes and steers.
6. On the deploy preview, confirm file names match capitalization exactly.
