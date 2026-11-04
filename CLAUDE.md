# CLAUDE.md

## Project goal (from the owner)

AdbMime is a **web application to manage many Android devices** (born for the interactive whiteboards of a school,
but generic). Every device ("board" in code comments and identifiers) exposes ADB over TCP on port **5555**; the PC
running the app uses `adb connect IP:5555` and `adb -s IP:5555 shell <command>` to control them.
**UI and README wording is generic: "dispositivi" / "devices" (never "lavagne" / "boards"), no "board management"
tagline.**

Required features:

- Simple authentication: username/password hardcoded in `.env` (`AUTH_USERNAME`/`AUTH_PASSWORD`).
  **By default both are empty and login with empty fields must work.**
- **Automatic discovery** of the devices' IPs on the network (TCP scan of port 5555).
- Connect via ADB to all devices or only the selected ones. The UI must clearly show which devices are
  **switched on** (port reachable) and which are **connected** (ready for adb commands).
- Commands on the selected connected devices:
  - install / uninstall an app (APK upload, package name);
  - delete the content of folders on the device;
  - send popups: text messages and audio messages (TTS or audio file) played by the devices;
  - remotely shut down the device.
- "Premium", clean and professional web UI with light/dark theme and a settings drawer. UI languages, in this
  display order: English, Spanish, French, Italian (default), German, Portuguese, Simplified Chinese.
  **Code comments must be in English**. The owner prefers **switches over checkboxes**.
- Compact vertical device list on the left, wide function area; remote screen (view + tap/swipe/keys/text, keys laid
  out like the original desktop app) and sequences of instructions (save, import/export, run).
- Remote screen *Live*: refresh intervals only 0.5 / 1 (default) / 2 / 5 s. A capture takes 0.3–1.5 s and the next
  one starts only when the previous has arrived, so shorter intervals were removed on purpose: do not add them back.
- Recording: a small switch right next to the Sequences tab (off by default, usable from any tab) records every
  action from every tab into the open sequence. The chip next to the tab always shows the number of actions
  (steps except sleep/comment) of the open sequence (0 for a new one): neutral, red with a breathing dot while
  recording. Empty sequences can be saved (`normalizeSteps(list, { allowEmpty })`) but not run. With no
  connected target, actions are only recorded, not executed.
- Sequences editor: toolbar on top (saved sequences dropdown, new, import, export, save, duplicate, clear, delete);
  a running sequence can be stopped. Shell commands show their output (per device) in the Shell tab, with a
  command history (↑/↓, `localStorage` key `adbmime.shellHistory`).
- Popups: audio is part of the popup block (no separate audio tab); volume 1–15 (never 0); TTS text is prefixed
  with the communication level (info/warning/urgent) in the request language.
- Settings show version and git commit; language (flags) and theme (sun/moon/monitor) are icon dropdowns
  (`public/js/dropdown.js`).
- README.md (in Italian) must contain setup/config instructions and clear instructions to start the server; keep it
  in sync with every user-visible change.

The old hand-written Java/JavaFX code (`demo/`, `utils/`) was used only as inspiration and has been removed.
Untracked leftovers (`composeApp/`, `gradle/`, `.gradle/`, `.idea/`) are not part of the app.

## Working rules

- **Commit only when the owner asks** (they usually commit themselves). Branch `develop`, main branch `main`.
- The owner writes in Italian or English: answer in the same language.
- Never send the owner's personal data (e.g. email) to any external service.
- The owner may have their own server running (`npm start`, port 8080) while you work: **never** `pkill node` /
  `pkill -f server.js`; stop only the test server you started, by PID (`lsof -ti tcp:8099 -sTCP:LISTEN`).
- Server-side changes need a restart of the owner's server (tell them); `public/` changes only need a page reload.
  When the owner reports "no effect", first check whether their server is running old code.
- **Do not send popups, inputs, volume changes or shutdowns to real devices** (USB phone, boards) without asking:
  they may be in use. Once a test popup changed the volume of the owner's phone; test with the fake adb instead.

## Stack & commands

- Node.js ≥ 20.12, ES modules, Express 5, Multer 2. No frontend build step (vanilla JS in `public/`).
- `npm install`, `npm start` (or `npm run dev` with `--watch`). Default port 8080.
- Configuration via `.env` (see `.env.example`), loaded natively with `process.loadEnvFile`.
- No automated tests yet. Syntax check: `node --check <file>`; dictionaries: import each `public/assets/i18n/*.js`
  and compare key sets (plural keys `_one`/`_other` count as one; zh has no `_one` keys, that is fine).

### Testing locally (without devices)

- Run a second instance: `PORT=8099 ADB_PATH=<fake adb> node src/server.js`, open `http://localhost:8099`.
- The fake adb is a bash script (keep it outside the repo, e.g. the scratchpad) that logs calls and answers:
  `version`, `start-server`, `devices` (from a state file), `connect`/`disconnect` (update the state file,
  print `connected to X`), `-s X exec-out` (cat a PNG), `-s X shell` with `wm size`
  (`Physical size: 1080x1920`), `getprop…` (`Acme | IFP 65 | 11`), `pm list packages -3`, `slow*` (sleep 8),
  `exit3` (exit code 3), anything else → `ok: <cmd>`; `install`/`uninstall` → `Success`.
- `data/` is the owner's real data: back up `devices.json`/`sequences.json` before testing, restore them afterwards
  and delete media files you created. Leave the owner's own media/library files alone.

## Architecture

- `src/server.js`: routes. `/login`, `/api/login`, `/m/:id` (popup page), `GET /m/:id/speech`, `POST /m/:id/play` and
  `/media/:file` (audio) are public, because the devices fetch them; everything else goes through `requireAuth`.
  `/favicon.ico` redirects to `/assets/favicon.svg`. Startup cleans `data/media` and `data/uploads`; clear message on
  `EADDRINUSE`; graceful shutdown on SIGINT/SIGTERM; `unhandledRejection` is logged, not fatal.
- `src/auth.js`: stateless HMAC-signed session cookie, constant-time credential check.
- `src/adb.js`: `execFile` wrapper around adb (never a host shell). Strings for the device shell
  must be quoted with `shQuote`. `adb connect` exits 0 on failure, so output is parsed. `adb(args, { timeout, signal })`
  returns `{ ok, output, code, timedOut, aborted }`; `reverse(serial, port)` for USB tunnels.
- `src/network.js`: local interface/subnet detection (auto mode clamps to /24), TCP probe, `mapLimit`,
  and `publicBaseUrlFor(ip)` to compute the URL a device uses to reach this server.
- `src/devices.js`: registry keyed by serial (`ip:port`, or the USB serial). `network` = port reachable, `adbState`
  from `adb devices`; derived `status`: connected | unauthorized | online | offline | unknown.
  Known devices and custom names persist in `data/devices.json`. Background loops: adb refresh every 4s,
  reachability probe every 20s; device info (`getprop`) retried at most once a minute.
- `src/i18n.js` + `src/locales.js`: server messages in 7 languages (it, en, fr, es, de, pt, zh). The request
  language (X-Lang header > `adbmime_lang` cookie > Accept-Language) lives in an AsyncLocalStorage, so helpers
  just call `t(key)`. After multer, routes must use `rebindLang` (stream callbacks lose the async context).
- `src/shared/sequence-format.js`: dependency-free module served to the browser at `/shared/`: step validation
  (`normalizeStep`, `normalizeSteps`, `STEP_TYPES`, `POPUP_AUDIO`), `deviceCommand(step)` and the text
  import/export format (compatible with the original desktop app files: plain lines are shell commands, extra step
  types are `#@type {json}` lines).
- `src/sequences.js`: saved sequences (`data/sequences.json`) and execution (steps in order per device, devices in
  parallel). Runs carry a client `runId` (`RUN_ID_RE`); `POST /api/actions/sequence/:runId/stop` aborts them
  (AbortController: pauses end, the running adb child is killed via `execFile({ signal })`); results carry
  `stopped`. Step types also cover install/clear/popup/power; a popup step carries `audio: none|tts|file` (+ `volume`);
  legacy `#@audio` lines / `audio` steps are converted to audio popups.
- `src/store.js`: every JSON file in `data/` is written atomically (temp + rename); a corrupted file is moved to
  `<file>.corrupt-<ts>` instead of being overwritten. `src/version.js`: version + git commit (git CLI, `.git` files,
  or `ADBMIME_COMMIT`) and dirty flag, exposed in `/api/state` and printed at startup.
- `src/library.js`: content-addressed file library in `data/library/` (APKs/audio referenced by sequences);
  `GET/POST /api/library`; install/message routes accept `libraryFile`.
- Remote screen: `GET /api/devices/:serial/screen` (PNG via `exec-out screencap -p`, deduplicated per device) and
  `POST /api/devices/:serial/input` (tap/swipe/key/text only).
- `src/actions.js`: per-device actions, always returning `[{ serial, ok, output }]` and run only on
  devices with `adbState === 'device'`. Folder clearing is restricted to `CLEAR_ALLOWED_ROOTS`.
  Shell: output capped at 256 KB per device, 60 s timeout, returns `code` and `ms`.
  Shutdown: `svc power shutdown || reboot -p` (a dropped connection counts as success).
- Popups (`src/actions.js` + `src/views.js`):
  - The device opens a server-hosted page via `am start -a android.intent.action.VIEW`; notification mode is text
    only (Android 9+). USB devices (no IP) get an `adb reverse tcp:PORT` tunnel and open `http://127.0.0.1:PORT`
    (unless `PUBLIC_BASE_URL`). The page config is embedded as JSON with `<` escaped.
  - Audio plays inside the page (no app chooser). TTS: spoken text = level label + title + text (`spokenText`,
    language-aware punctuation, zh uses `。`) via the device browser's Web Speech API (sentence chunks, voice
    picked by `SPEECH_LANG`, replayable offline). Fallback only when the browser has no engine/voice: the page
    fetches `GET /m/:id/speech`, synthesised on the server by `src/tts.js` (say / espeak-ng / SAPI). Audio files are
    fetched into a Blob (offline replay). Media expire after 24 h.
  - Autoplay blocked → the page shows an overlay and calls `POST /m/:id/play?b=<per-device token>`; the server sends
    `input tap` in the middle of the screen. Safeguards: only while the page is visible and focused, only within
    `TAP_WINDOW_MS` (30 s) from opening, at most 2 taps per device.
  - Volume 1–15 is scaled to the device range and verified by `VOLUME_SCRIPT` (output `volume c/max`).
- `public/`: `login.html`, `index.html`; `js/` ES modules (`main.js` entry with single-flight refresh and a
  "server unreachable" pill, `core.js` shared helpers/state/modal/log, `devices.js`, `actions.js`, `screen.js`,
  `sequences.js`, `settings.js`, `dropdown.js`, `recorder.js` (recording state only; emits
  `seqrecord`/`recordchange` events)); `assets/styles.css` (light/dark tokens via `[data-theme]`; `.switch`,
  `.switch.sm`, `.switch.xs`), `assets/icons.js`, `assets/i18n.js` + `assets/i18n/<lang>.js` (Italian is the
  fallback; plurals via `key_one`/`key_other`), `assets/prefs.js` (theme & prefs in localStorage, prefix `adbmime.`),
  `assets/theme-boot.js` (applies the theme before paint), `assets/flags/` (Twemoji SVGs, CC-BY 4.0),
  `assets/favicon.svg`.
- `data/` (gitignored): `devices.json`, `sequences.json`, `library/`, `uploads/` (APK, deleted after install), `media/` (TTL 24h).

## Rules & gotchas (learned the hard way)

- Every UI string goes through i18n (`data-i18n*` attributes or `t()`) and must exist in all 7 dictionaries; same for
  server strings in `src/locales.js`. Translations must agree in gender with "dispositivo/dispositivi" (it/es/pt
  masculine), "appareil" (fr, `l'appareil`), "Gerät/Geräte/Geräten" (de, neuter), "设备" with measure word `台` (zh).
  Values containing `'` use double quotes.
- `server.requestTimeout = 0`: Node's default 300 s cut long sequences. Background loops use single-flight wrappers
  (`refreshAdb`, `probeKnown`); call `.fresh()` when the result must include a change just made (e.g. after connect).
- Never write `el.onclick = (e) => cond && fn()`: returning `false` cancels the click (it broke the modal OK button
  and the settings switches). Use a block body.
- `crypto.randomUUID` is unavailable on plain-http LAN origins (not a secure context): use `uid()` from `core.js`.
- `api()` maps fetch network errors to `common.network`; keep that so a stopped server gives a readable message.
- Dropdown Esc must `stopPropagation()` so it closes only the list, not the settings drawer.
- Android volume: on recent Android (seen on 17) `cmd media_session volume --set` is ignored and the music range may
  be 0–25. `VOLUME_SCRIPT` reads `--get`, then corrects with `input keyevent 24/25` batches; the first key press
  only opens the volume panel, and each batch needs `sleep 0.4` or it overshoots.
- Chrome fires the speech `not-allowed` error synchronously inside `speak()`: the watchdog/fallback logic uses a
  `blocked` flag set before speaking, otherwise it falls back to server audio by mistake.
- macOS `say` produces silence when the text contains `<...>`: `src/tts.js` strips angle brackets.
- A device that shows "site cannot be reached" for a popup: Wi-Fi off / other network (USB devices use the reverse
  tunnel), PC firewall, or wrong auto-detected base URL (`PUBLIC_BASE_URL`).
