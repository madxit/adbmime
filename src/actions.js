// Remote actions executed on one or more connected boards.
// Every action returns an array of per-board results: [{ serial, ok, output }].
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as adb from './adb.js';
import { config, MEDIA_DIR } from './config.js';
import * as devices from './devices.js';
import { mapLimit, publicBaseUrlFor } from './network.js';
import { currentLang, t } from './i18n.js';
import { deviceCommand, normalizeStep, StepError } from './shared/sequence-format.js';
import { synthesize } from './tts.js';

const MEDIA_TTL_MS = 24 * 3600 * 1000;

/** Run `fn(serial, device)` on each board, in parallel, skipping boards not connected. */
export async function onBoards(serials, fn, concurrency = config.actionConcurrency) {
  return mapLimit(serials, concurrency, async (serial) => {
    const device = devices.get(serial);
    if (!device || device.adbState !== 'device') {
      return { serial, ok: false, output: t('notConnectedAdb') };
    }
    try {
      return { serial, ...(await fn(serial, device)) };
    } catch (err) {
      return { serial, ok: false, output: err.message };
    }
  });
}

// ---------------------------------------------------------------- Apps

export const PACKAGE_RE = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;

export const installApk = (serials, apkPath, opts) =>
  onBoards(serials, (serial) => adb.install(serial, apkPath, opts));

export function uninstallApp(serials, packageName) {
  if (!PACKAGE_RE.test(packageName)) throw new Error(t('badPackage'));
  return onBoards(serials, (serial) => adb.uninstall(serial, packageName));
}

/** Third-party packages installed on a board (to help choosing what to uninstall). */
export async function listPackages(serial) {
  const r = await adb.shell(serial, 'pm list packages -3', { timeout: 20_000 });
  if (!r.ok) throw new Error(r.output || t('pkgReadFail'));
  return r.output
    .split(/\r?\n/)
    .map((l) => l.replace(/^package:/, '').trim())
    .filter(Boolean)
    .sort();
}

// ---------------------------------------------------------------- Folders

/** Normalize and validate a folder path against the allowed roots. */
export function validateFolder(raw) {
  const p = path.posix.normalize(String(raw ?? '').trim()).replace(/\/+$/, '');
  if (!p.startsWith('/') || p.includes('..')) throw new Error(t('badPath', { path: raw }));
  const allowed = config.clearAllowedRoots.some((root) => p === root || p.startsWith(`${root}/`));
  if (!allowed) {
    throw new Error(t('pathNotAllowed', { path: p, roots: config.clearAllowedRoots.join(', ') }));
  }
  return p;
}

export function clearFolders(serials, rawPaths) {
  const folders = [...new Set(rawPaths.map(validateFolder))];
  if (!folders.length) throw new Error(t('folderRequired'));
  // Deletes the *content* (including hidden files) but keeps the folder itself.
  // Plain globs are used because they work on every Android shell (toolbox and toybox).
  const script = folders
    .map((f) => {
      const q = adb.shQuote(f); // the path is always quoted for the device shell
      return `if [ -d ${q} ]; then rm -rf ${q}/* ${q}/.[!.]* ${q}/..?* 2>/dev/null; echo @OK ${q}; else echo @MISSING ${q}; fi`;
    })
    .join('; ');
  return onBoards(serials, async (serial) => {
    const r = await adb.shell(serial, script, { timeout: 120_000 });
    // Translate the markers printed by the script.
    const output = r.output
      .replace(/^@OK (.*)$/gm, (_, p) => t('folderCleared', { path: p }))
      .replace(/^@MISSING (.*)$/gm, (_, p) => t('folderMissing', { path: p }));
    return { ok: r.ok && !/^@MISSING/m.test(r.output), output };
  });
}

// ---------------------------------------------------------------- Popups (text and audio)

// id -> { title, text, level, lang, createdAt, audioFile, speech, speechFile, boards: Map(token -> { serial, taps, openedAt }) }
const messages = new Map();

export const getMessage = (id) => messages.get(id);

const openUrl = (serial, url) =>
  adb.shell(serial, `am start -a android.intent.action.VIEW -d ${adb.shQuote(url)}`, { timeout: 15_000 });

/**
 * Base URL the board uses to reach this server. USB devices (no IP) may not share the
 * PC's network, so they go through an `adb reverse` tunnel to their own localhost.
 */
async function baseUrlFor(serial, device) {
  if (!config.publicBaseUrl && !device.ip) {
    const r = await adb.reverse(serial, config.port);
    if (r.ok) return `http://127.0.0.1:${config.port}`;
  }
  return publicBaseUrlFor(device.ip);
}

const amOk = (r) => r.ok && !/Error|Exception/i.test(r.output);

/**
 * Media volume, as a level 1-15 scaled to the board's own range (e.g. 0..15 or 0..25).
 * `cmd media_session volume --set` is silently ignored on recent Android versions, so the
 * value is read back and corrected with volume key presses (the first press may only show the
 * volume panel, hence the loop). Runs as a single device shell script.
 */
const VOLUME_SCRIPT = `
g() { (cmd media_session volume --stream 3 --get 2>/dev/null || media volume --stream 3 --get 2>/dev/null) | sed -n 's/.*volume is \\([0-9]*\\) in range \\[[0-9]*\\.\\.\\([0-9]*\\)\\].*/\\1 \\2/p'; }
set -- $(g)
if [ -z "$2" ]; then media volume --stream 3 --set $V >/dev/null 2>&1; echo "volume ?"; exit 0; fi
c=$1; max=$2; t=$(( (V * max * 2 + 15) / 30 )); [ $t -lt 1 ] && t=1
[ "$c" != "$t" ] && cmd media_session volume --stream 3 --set $t >/dev/null 2>&1
n=0
while [ $n -lt 5 ]; do
  set -- $(g); c=$1
  [ "$c" = "$t" ] && break
  if [ $c -lt $t ]; then k=24; d=$((t - c)); else k=25; d=$((c - t)); fi
  keys=""; i=0; while [ $i -lt $d ]; do keys="$keys $k"; i=$((i + 1)); done
  input keyevent $keys; sleep 0.4
  n=$((n + 1))
done
echo "volume $c/$max"`;

const setVolume = (serial, level) => adb.shell(serial, `V=${level};${VOLUME_SCRIPT}`, { timeout: 30_000 });

const LEVEL_LABEL = { info: 'popupInfo', warning: 'popupWarning', urgent: 'popupUrgent' };

/**
 * Text read aloud by an audio popup with `audio: "tts"`: the kind of communication first
 * (e.g. "Urgent."), in the request language, then title and text.
 */
export function spokenText({ title, text, level }) {
  const zh = currentLang() === 'zh';
  const parts = [t(LEVEL_LABEL[level] ?? LEVEL_LABEL.info), title].filter(Boolean);
  // Each part ends with a full stop (unless it already has one), so the voice pauses after it.
  const ended = parts.map((p) => (/[.!?。！？:：]$/.test(p) ? p : `${p}${zh ? '。' : '.'}`));
  return [...ended, text].filter(Boolean).join(zh ? '' : ' ');
}

/**
 * Show a popup on the boards.
 *  - mode "screen": opens a full screen page served by this app in the board browser. With `audio`
 *    "tts" the board browser reads the text aloud with its own speech engine (server synthesis only
 *    as a fallback, see speechFile); with "file" (`audioFile`, a name in the media folder) the page
 *    plays the file. The board never asks which app should open the audio;
 *  - mode "notification": posts an Android notification (Android 9+), text only.
 */
export async function sendMessage(serials, { title, text, level = 'info', mode = 'screen', audio = 'none', audioFile, volume }) {
  title = String(title ?? '').trim().slice(0, 120);
  text = String(text ?? '').trim().slice(0, 2000);
  if (!['info', 'warning', 'urgent'].includes(level)) level = 'info';
  if (mode !== 'screen') audio = 'none';
  if (audio === 'file' && !audioFile) throw new Error(t('audioRequired'));
  if (!text && audio !== 'file') throw new Error(t('msgTextRequired'));

  if (mode === 'notification') {
    return onBoards(serials, async (serial) => {
      const cmd = `cmd notification post -S bigtext -t ${adb.shQuote(title || t('notifTitle'))} adbmime ${adb.shQuote(text)}`;
      const r = await adb.shell(serial, cmd, { timeout: 15_000 });
      const ok = r.ok && !/Unknown command|Error|Exception/i.test(r.output);
      return {
        ok,
        output: ok ? t('notifSent') : `${r.output}\n${t('notifNeeds9')}`,
      };
    });
  }

  if (audio !== 'file') audioFile = null;
  const speech = audio === 'tts' ? spokenText({ title, text, level }) : null;
  const hasAudio = Boolean(audioFile || speech);
  const vol = hasAudio && Number.isInteger(volume) && volume >= 1 && volume <= 15 ? volume : null;

  const id = crypto.randomBytes(16).toString('hex');
  const msg = { title, text, level, lang: currentLang(), createdAt: Date.now(), audioFile, speech, boards: new Map() };
  messages.set(id, msg);
  return onBoards(serials, async (serial, device) => {
    const volOut = vol === null ? '' : `${(await setVolume(serial, vol)).output.split('\n').at(-1)} · `;
    // Per-board token: lets the page ask this server to "tap" its own board (see tapToPlay).
    const token = crypto.randomBytes(8).toString('hex');
    msg.boards.set(token, { serial, taps: 0, openedAt: Date.now() });
    const url = `${await baseUrlFor(serial, device)}/m/${id}${hasAudio ? `?b=${token}` : ''}`;
    const r = await openUrl(serial, url);
    return { ok: amOk(r), output: amOk(r) ? `${volOut}${t('messageOpened', { url })}` : r.output };
  });
}

/**
 * Fallback for boards whose browser cannot speak (no Web Speech engine or no voice for the
 * language): the text is synthesised on this PC once per popup, on first request.
 * Returns the media file name, or null for unknown popups.
 */
export function speechFile(id) {
  const msg = messages.get(id);
  if (!msg?.speech) return null;
  msg.speechFile ??= synthesize(msg.speech, msg.lang).catch((err) => {
    msg.speechFile = null; // allow a retry
    throw err;
  });
  return msg.speechFile;
}

const TAP_WINDOW_MS = 30_000;

/**
 * Browsers block audio that starts without a user gesture. When that happens the popup page calls
 * this (POST /m/:id/play?b=<token>) and the server taps the middle of the board's screen through
 * adb: a real touch the page uses to start playback. At most twice per board and popup, and only
 * within TAP_WINDOW_MS of opening it; the page asks only while it is visible and focused.
 */
export async function tapToPlay(id, token) {
  const board = messages.get(id)?.boards.get(String(token ?? ''));
  // Only right after the popup was opened: later the board may be showing something else.
  if (!board || board.taps >= 2 || Date.now() - board.openedAt > TAP_WINDOW_MS) return false;
  board.taps++;
  const size = await adb.shell(board.serial, 'wm size', { timeout: 5_000 });
  // "Physical size: 1920x1080" and, when set, "Override size: ..." (the last one wins). The size is
  // in the natural orientation: (s/2, s/2) with s = shorter side is on screen in any rotation and
  // below the browser address bar. The page reacts to a touch anywhere.
  const [, w, h] = [...size.output.matchAll(/(\d+)x(\d+)/g)].at(-1) ?? [null, 1080, 1080];
  const c = Math.round(Math.min(Number(w), Number(h)) / 2);
  await adb.shell(board.serial, `input tap ${c} ${c}`, { timeout: 5_000 });
  return true;
}

/** Copy a library audio file into the (public, expiring) media folder; returns the media file name. */
export function mediaFromLibrary(fullPath) {
  const file = `${crypto.randomUUID()}${path.extname(fullPath).toLowerCase()}`;
  fs.copyFileSync(fullPath, path.join(MEDIA_DIR, file));
  return file;
}

/** Remove expired messages and media files. */
export function cleanupMedia() {
  const now = Date.now();
  for (const [id, m] of messages) if (now - m.createdAt > MEDIA_TTL_MS) messages.delete(id);
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    const p = path.join(MEDIA_DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > MEDIA_TTL_MS) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- Power

export function power(serials, action) {
  if (action === 'reboot') return onBoards(serials, (serial) => adb.reboot(serial));
  if (action === 'screen') {
    // Toggle the display (standby) with the POWER key.
    return onBoards(serials, async (serial) => {
      const r = await adb.shell(serial, 'input keyevent 26', { timeout: 10_000 });
      return { ok: r.ok, output: r.output || t('powerKeySent') };
    });
  }
  if (action !== 'shutdown') throw new Error(t('badAction'));
  return onBoards(serials, async (serial) => {
    // `svc power shutdown` works without root on most boards, `reboot -p` is the fallback.
    const r = await adb.shell(serial, 'svc power shutdown 2>/dev/null || reboot -p', { timeout: 15_000 });
    // The connection drops while the board powers off: a timeout means success here.
    const ok = r.ok || r.timedOut;
    return { ok, output: ok ? t('shutdownSent') : r.output };
  });
}

// ---------------------------------------------------------------- Custom shell

const MAX_SHELL_OUTPUT = 256 * 1024; // characters sent back to the browser per board

export function runShell(serials, command) {
  command = String(command ?? '').trim();
  if (!command) throw new Error(t('emptyCommand'));
  return onBoards(serials, async (serial) => {
    const started = Date.now();
    const r = await adb.shell(serial, command, { timeout: 60_000 });
    let output = r.output;
    if (output.length > MAX_SHELL_OUTPUT) output = `${output.slice(0, MAX_SHELL_OUTPUT)}\n… ${t('outputTruncated')}`;
    if (r.timedOut) output = `${output}\n${t('shellTimeout', { s: 60 })}`.trim();
    return { ok: r.ok, output, code: r.code, ms: Date.now() - started };
  });
}

// ---------------------------------------------------------------- Remote screen

const captures = new Map(); // serial -> pending capture (concurrent viewers share it)

/** PNG screenshot of a board (null on failure). */
export function screenshot(serial) {
  if (!captures.has(serial)) {
    captures.set(serial, adb.screencap(serial).finally(() => captures.delete(serial)));
  }
  return captures.get(serial);
}

const INPUT_TYPES = ['tap', 'swipe', 'key', 'text'];

/** Send a single input event (tap, swipe, key, text) to one board. */
export async function sendInput(serial, raw) {
  let step;
  try {
    if (!INPUT_TYPES.includes(raw?.type)) throw new StepError('type');
    step = normalizeStep(raw);
  } catch (err) {
    const e = new Error(err instanceof StepError ? t(`seq_${err.code}`) : err.message);
    e.status = 400;
    throw e;
  }
  const r = await adb.shell(serial, deviceCommand(step), { timeout: 15_000 });
  return { ok: r.ok, output: r.output, step };
}
