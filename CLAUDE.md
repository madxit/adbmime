# CLAUDE.md

## Project goal (from the owner)

AdbMime is a **web application to manage many Android interactive whiteboards ("lavagne")** in a school.
Every board exposes ADB over TCP on port **5555**; the PC running the app uses `adb connect IP:5555`
and `adb -s IP:5555 shell <command>` to control them.

Required features:

- Simple authentication: username/password hardcoded in `.env` (`AUTH_USERNAME`/`AUTH_PASSWORD`).
  **By default both are empty and login with empty fields must work.**
- **Automatic discovery** of the boards' IPs on the network (TCP scan of port 5555).
- Connect via ADB to all boards or only the selected ones. The UI must clearly show which boards are
  **switched on** (port reachable) and which are **connected** (ready for adb commands).
- Commands on the selected connected boards:
  - install / uninstall an app (APK upload, package name);
  - delete the content of folders on the board;
  - send popups: text messages and audio messages (TTS or audio file) played by the boards;
  - remotely shut down the board.
- "Premium", clean and professional web UI with light/dark theme and a settings drawer. UI languages, in this
  display order: English, Spanish, French, Italian (default), German, Portuguese, Simplified Chinese.
  **Code comments must be in English**.
- Compact vertical board list on the left, wide function area; remote screen (view + tap/swipe/keys/text, keys laid
  out like the original desktop app) and sequences of instructions (save, import/export, run).
- Recording: a small switch right next to the Sequences tab (off by default, usable from any tab) records every
  action from every tab into the open sequence. The chip next to the tab always shows the number of actions
  (steps except sleep/comment) of the open sequence (0 for a new one): neutral, red with a breathing dot while
  recording. Empty sequences can be saved (`normalizeSteps(list, { allowEmpty })`) but not run. With no
  connected target, actions are only recorded, not executed.
- Sequences editor: toolbar on top (saved sequences dropdown, new, import, export, save, duplicate, clear, delete);
  a running sequence can be stopped. Shell commands show their output (per board) in the Shell tab.
- Settings show version and git commit; language and theme are icon dropdowns (`public/js/dropdown.js`).
- README.md must contain setup/config instructions and clear instructions to start the server.

The old hand-written Java/JavaFX code (`demo/`, `utils/`) was used only as inspiration and has been removed.
Untracked leftovers (`composeApp/`, `gradle/`, `.gradle/`, `.idea/`) are not part of the app.

## Stack & commands

- Node.js ≥ 20.12, ES modules, Express 5, Multer 2. No frontend build step (vanilla JS in `public/`).
- `npm install`, `npm start` (or `npm run dev` with `--watch`). Default port 8080.
- Configuration via `.env` (see `.env.example`), loaded natively with `process.loadEnvFile`.
- No tests yet. To try it without boards, point `ADB_PATH` to a fake adb script.

## Architecture

- `src/server.js`: routes. `/login`, `/api/login`, `/m/:id` (popup page), `GET /m/:id/speech`, `POST /m/:id/play` and `/media/:file` (audio)
  are public, because the boards fetch them; everything else goes through `requireAuth`.
- `src/auth.js`: stateless HMAC-signed session cookie, constant-time credential check.
- `src/adb.js`: `execFile` wrapper around adb (never a host shell). Strings for the device shell
  must be quoted with `shQuote`. `adb connect` exits 0 on failure, so output is parsed.
- `src/network.js`: local interface/subnet detection (auto mode clamps to /24), TCP probe, `mapLimit`,
  and `publicBaseUrlFor(ip)` to compute the URL a board uses to reach this server.
- `src/devices.js`: registry keyed by serial (`ip:port`). `network` = port reachable, `adbState` from
  `adb devices`; derived `status`: connected | unauthorized | online | offline | unknown.
  Known boards and custom names persist in `data/devices.json`. Background loops: adb refresh every 4s,
  reachability probe every 20s.
- `src/i18n.js` + `src/locales.js`: server messages in 7 languages (it, en, fr, es, de, pt, zh). The request
  language (X-Lang header > `adbmime_lang` cookie > Accept-Language) lives in an AsyncLocalStorage, so helpers
  just call `t(key)`. After multer, routes must use `rebindLang` (stream callbacks lose the async context).
- `src/shared/sequence-format.js`: dependency-free module served to the browser at `/shared/`: step validation,
  `deviceCommand(step)` and the text import/export format (compatible with the original desktop app files).
- `src/sequences.js`: saved sequences (`data/sequences.json`) and execution (steps in order per board, boards in
  parallel). Runs carry a client `runId`; `POST /api/actions/sequence/:runId/stop` aborts them (AbortController:
  pauses end, the running adb child is killed via `execFile({ signal })`). Step types also cover install/clear/popup/power (exported as `#@type {json}` lines); a popup step carries
  `audio: none|tts|file` (legacy `#@audio` lines are converted to audio popups).
- `src/store.js`: every JSON file in `data/` is written atomically (temp + rename); a corrupted file is moved to
  `<file>.corrupt-<ts>` instead of being overwritten. `src/version.js`: version + git commit (git CLI, `.git` files,
  or `ADBMIME_COMMIT`), exposed in `/api/state`.
- Stability rules: `server.requestTimeout = 0` (actions may last long); background loops use single-flight wrappers
  (`refreshAdb`, `probeKnown`; `.fresh()` when the result must include a change just made); never write
  `el.onclick = (e) => cond && fn()` (returning false cancels the click; it broke the modal OK button).
- `src/library.js`: content-addressed file library in `data/library/` (APKs/audio referenced by sequences);
  `GET/POST /api/library`; install/message routes accept `libraryFile`.
- Remote screen: `GET /api/devices/:serial/screen` (PNG via `exec-out screencap -p`, deduplicated per board) and
  `POST /api/devices/:serial/input` (tap/swipe/key/text only).
- `src/actions.js`: per-board actions, always returning `[{ serial, ok, output }]` and run only on
  boards with `adbState === 'device'`. Folder clearing is restricted to `CLEAR_ALLOWED_ROOTS`.
  Popups open a server-hosted page via `am start -a android.intent.action.VIEW`. Audio popups play inside that page
  (no app chooser): TTS (spoken text = level label + title + text, see `spokenText`) uses the board browser's Web
  Speech API (replayable offline); only as a fallback the page
  fetches `GET /m/:id/speech`, synthesised on the server by `src/tts.js` (say / espeak-ng / SAPI). Audio files are
  fetched into a Blob (offline replay);
  when autoplay is blocked the page calls `POST /m/:id/play?b=<board token>` and the server sends `input tap`.
  USB devices (no IP) get an `adb reverse tcp:PORT` tunnel and open `http://127.0.0.1:PORT` (unless `PUBLIC_BASE_URL`).
  Popup volume (1-15) is scaled to the board's range and verified; `media_session --set` is ignored on recent
  Android, so VOLUME_SCRIPT falls back to volume key presses.
  Shutdown: `svc power shutdown || reboot -p`.
- `public/`: `login.html`, `index.html`; `js/` ES modules (`main.js` entry, `core.js` shared helpers/state,
  `devices.js`, `actions.js`, `screen.js`, `sequences.js`, `settings.js`, `recorder.js` (recording state; emits
  `seqrecord`/`recordchange` events)); `assets/styles.css` (light/dark tokens
  via `[data-theme]`), `assets/icons.js`, `assets/i18n.js` + `assets/i18n/<lang>.js` (Italian is the fallback;
  plurals via `key_one`/`key_other`), `assets/prefs.js` (theme & prefs in localStorage),
  `assets/theme-boot.js` (applies the theme before paint), `assets/flags/` (Twemoji SVGs, CC-BY 4.0).
- Every UI string must go through i18n (`data-i18n*` attributes or `t()`) and exist in all 7 dictionaries.
- `data/` (gitignored): `devices.json`, `sequences.json`, `library/`, `uploads/` (APK, deleted after install), `media/` (TTL 24h).
