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

// ---------------------------------------------------------------- Messages & audio

const messages = new Map(); // id -> { title, text, level, lang, createdAt }

export const getMessage = (id) => messages.get(id);

const openUrl = (serial, url, mime) =>
  adb.shell(
    serial,
    `am start -a android.intent.action.VIEW -d ${adb.shQuote(url)}${mime ? ` -t ${adb.shQuote(mime)}` : ''}`,
    { timeout: 15_000 },
  );

const amOk = (r) => r.ok && !/Error|Exception/i.test(r.output);

/**
 * Show a text message on the boards.
 *  - mode "screen": opens a full screen page served by this app in the board browser;
 *  - mode "notification": posts an Android notification (Android 9+).
 */
export function sendMessage(serials, { title, text, level = 'info', mode = 'screen' }) {
  title = String(title ?? '').trim().slice(0, 120);
  text = String(text ?? '').trim().slice(0, 2000);
  if (!text) throw new Error(t('msgTextRequired'));
  if (!['info', 'warning', 'urgent'].includes(level)) level = 'info';

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

  const id = crypto.randomBytes(16).toString('hex');
  messages.set(id, { title, text, level, lang: currentLang(), createdAt: Date.now() });
  return onBoards(serials, async (serial, device) => {
    const url = `${publicBaseUrlFor(device.ip)}/m/${id}`;
    const r = await openUrl(serial, url);
    return { ok: amOk(r), output: amOk(r) ? t('messageOpened', { url }) : r.output };
  });
}

/** Best-effort media volume (0-15) using the command available on the board. */
const setVolume = (serial, level) =>
  adb.shell(
    serial,
    `cmd media_session volume --stream 3 --set ${level} >/dev/null 2>&1 || media volume --stream 3 --set ${level} >/dev/null 2>&1; true`,
    { timeout: 10_000 },
  );

const AUDIO_MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

/**
 * Play an audio announcement: either text synthesised on the server (TTS)
 * or an uploaded audio file. The board downloads it from this server.
 */
export async function playAudio(serials, { text, audioFile, volume }) {
  let file = audioFile;
  if (!file) {
    text = String(text ?? '').trim().slice(0, 1000);
    if (!text) throw new Error(t('audioRequired'));
    file = await synthesize(text, currentLang());
  }
  const mime = AUDIO_MIME[path.extname(file).toLowerCase()] ?? 'audio/*';
  const vol = Number.isInteger(volume) && volume >= 0 && volume <= 15 ? volume : null;

  return onBoards(serials, async (serial, device) => {
    if (vol !== null) await setVolume(serial, vol);
    const url = `${publicBaseUrlFor(device.ip)}/media/${file}`;
    const r = await openUrl(serial, url, mime);
    return { ok: amOk(r), output: amOk(r) ? t('playbackStarted', { url }) : r.output };
  });
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

export function runShell(serials, command) {
  command = String(command ?? '').trim();
  if (!command) throw new Error(t('emptyCommand'));
  return onBoards(serials, (serial) => adb.shell(serial, command, { timeout: 60_000 }));
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
