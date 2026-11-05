// AdbMime web console - HTTP entry point.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import * as actions from './actions.js';
import * as adb from './adb.js';
import { checkCredentials, clearSessionCookie, getSession, requireAuth, setSessionCookie } from './auth.js';
import { config, MEDIA_DIR, ROOT_DIR, UPLOAD_DIR } from './config.js';
import * as devices from './devices.js';
import { i18nMiddleware, LANGS, rebindLang, t } from './i18n.js';
import { localInterfaces } from './network.js';
import * as library from './library.js';
import * as sequences from './sequences.js';
import { build } from './version.js';
import { renderMessagePage } from './views.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SHARED_DIR = path.join(ROOT_DIR, 'src', 'shared');
const app = express();
app.disable('x-powered-by');
app.use(i18nMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ------------------------------------------------------------------ helpers

/** Error with an HTTP status and a translated message (`key` from src/locales.js). */
class HttpError extends Error {
  constructor(status, key, vars = {}, lang = undefined) {
    super(t(key, vars, lang));
    this.status = status;
  }
}

// ------------------------------------------------------------------ uploads

const apkUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // adb requires the ".apk" extension.
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.apk`),
  }),
  limits: { fileSize: 2 * 1024 ** 3 },
  fileFilter: (req, file, cb) =>
    cb(/\.apk$/i.test(file.originalname) ? null : new HttpError(400, 'apkOnly', {}, req.lang), true),
});

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a'];
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 50 * 1024 ** 2 },
  fileFilter: (req, file, cb) => {
    const ok = AUDIO_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'audioFormats', { list: AUDIO_EXT.join(', ') }, req.lang), ok);
  },
});

// Files kept in the library (referenced by sequences): APKs and audio.
const libraryUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 ** 3 },
  fileFilter: (req, file, cb) => {
    const ok = ['.apk', ...AUDIO_EXT].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'libraryFormats', { list: ['.apk', ...AUDIO_EXT].join(', ') }, req.lang), ok);
  },
});

/** Path of a library file sent by the client, or a 400 error. */
function libraryPath(file) {
  const full = library.resolve(file);
  if (!full) throw new HttpError(400, 'libraryMissing', { name: String(file ?? '') });
  return full;
}


/** Validate the list of target boards sent by the client. */
function targets(raw) {
  let serials = raw;
  if (typeof serials === 'string') {
    try {
      serials = JSON.parse(serials);
    } catch {
      serials = [serials];
    }
  }
  if (!Array.isArray(serials) || !serials.length) throw new HttpError(400, 'selectBoard');
  const unique = [...new Set(serials)];
  for (const s of unique) {
    if (!adb.isValidSerial(s) || !devices.get(s)) throw new HttpError(400, 'unknownBoard', { serial: s });
  }
  return unique;
}

const summary = (results) => ({
  results,
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
});

// ------------------------------------------------------------------ public routes
// These are reached by the boards themselves (no login): IDs are unguessable.

app.get('/m/:id', (req, res) => {
  const msg = actions.getMessage(req.params.id);
  if (!msg) return res.status(404).send(t('msgExpired'));
  res.type('html').send(renderMessagePage(msg));
});

// Speech of a "tts" popup synthesised on this PC: fallback for boards that cannot speak themselves.
app.get('/m/:id/speech', async (req, res) => {
  const file = await actions.speechFile(req.params.id);
  if (!file) return res.sendStatus(404);
  res.sendFile(path.join(MEDIA_DIR, file));
});

// Called by an audio popup when the browser blocked autoplay: the server taps the board.
app.post('/m/:id/play', async (req, res) => {
  res.status((await actions.tapToPlay(req.params.id, req.query.b)) ? 204 : 404).end();
});

app.get('/media/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(MEDIA_DIR, file);
  if (!/^[\w-]+\.(wav|mp3|ogg|m4a)$/.test(file) || !fs.existsSync(full)) return res.sendStatus(404);
  res.sendFile(full);
});

// ------------------------------------------------------------------ auth

app.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const { username = '', password = '' } = req.body ?? {};
  if (!checkCredentials(username, password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down brute force attempts
    return res.status(401).json({ error: t('badCredentials') });
  }
  setSessionCookie(res, username);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/favicon.ico', (_req, res) => res.redirect(301, '/assets/favicon.svg'));

// Static assets needed by the login page are public; everything else requires a session.
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use(requireAuth);
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
// Modules shared between server and browser (e.g. the sequence format).
app.use('/shared', express.static(SHARED_DIR));

// ------------------------------------------------------------------ API

app.get('/api/state', (req, res) => {
  res.json({
    user: req.user,
    adb: devices.adbStatus,
    scan: {
      ...devices.scanState,
      error: devices.scanState.errorKey ? t(devices.scanState.errorKey) : devices.scanState.error,
    },
    devices: devices.list(),
    interfaces: localInterfaces(),
    adbPort: config.adbPort,
    clearAllowedRoots: config.clearAllowedRoots,
    version: build.version,
    commit: build.commit,
    dirty: build.dirty,
    langs: LANGS,
  });
});

app.post('/api/scan', async (_req, res) => {
  res.json(await devices.scan());
});

app.post('/api/refresh', async (_req, res) => {
  await Promise.all([devices.refreshAdb.fresh(), devices.probeKnown.fresh()]);
  res.json({ devices: devices.list() });
});

app.post('/api/devices', (req, res) => {
  const ips = String(req.body?.ip ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!ips.length) throw new HttpError(400, 'ipRequired');
  try {
    ips.forEach((ip) => devices.add(ip));
  } catch (err) {
    err.status = 400;
    throw err;
  }
  devices.probeKnown().catch(() => {});
  res.json({ ok: true });
});

app.patch('/api/devices/:serial', (req, res) => {
  const [serial] = targets([req.params.serial]);
  res.json(devices.rename(serial, req.body?.name));
});

app.delete('/api/devices/:serial', async (req, res) => {
  const [serial] = targets([req.params.serial]);
  if (devices.isConnected(serial)) await adb.disconnect(serial);
  devices.forget(serial);
  res.json({ ok: true });
});

/** A single board, which must be connected (used by per-board routes). */
function connectedTarget(raw) {
  const [serial] = targets([raw]);
  if (!devices.isConnected(serial)) throw new HttpError(400, 'notConnected');
  return serial;
}

app.get('/api/devices/:serial/packages', async (req, res) => {
  res.json({ packages: await actions.listPackages(connectedTarget(req.params.serial)) });
});

// Remote screen: PNG screenshot and input events.
app.get('/api/devices/:serial/screen', async (req, res) => {
  const png = await actions.screenshot(connectedTarget(req.params.serial));
  if (!png) throw new HttpError(502, 'screenFail');
  res.set('Cache-Control', 'no-store').type('png').send(png);
});

app.post('/api/devices/:serial/input', async (req, res) => {
  res.json(await actions.sendInput(connectedTarget(req.params.serial), req.body));
});

app.post('/api/connect', async (req, res) => {
  res.json(summary(await devices.connect(targets(req.body?.serials))));
});

app.post('/api/disconnect', async (req, res) => {
  res.json(summary(await devices.disconnect(targets(req.body?.serials))));
});

app.post('/api/actions/install', apkUpload.single('apk'), rebindLang, async (req, res) => {
  if (!req.file && req.body.libraryFile) {
    // APK already stored in the library (e.g. recorded into a sequence): never deleted here.
    const serials = targets(req.body.serials);
    const grantPermissions = req.body.grantPermissions === 'true';
    return res.json(summary(await actions.installApk(serials, libraryPath(req.body.libraryFile), { grantPermissions })));
  }
  if (!req.file) throw new HttpError(400, 'uploadApk');
  try {
    const serials = targets(req.body.serials);
    const grantPermissions = req.body.grantPermissions === 'true';
    res.json(summary(await actions.installApk(serials, req.file.path, { grantPermissions })));
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

app.post('/api/actions/uninstall', async (req, res) => {
  const serials = targets(req.body?.serials);
  const pkg = String(req.body?.packageName ?? '').trim();
  if (!actions.PACKAGE_RE.test(pkg)) throw new HttpError(400, 'badPackage');
  res.json(summary(await actions.uninstallApp(serials, pkg)));
});

app.post('/api/actions/clear', async (req, res) => {
  const serials = targets(req.body?.serials);
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  try {
    paths.forEach(actions.validateFolder);
  } catch (err) {
    err.status = 400;
    throw err;
  }
  if (!paths.length) throw new HttpError(400, 'folderRequired');
  res.json(summary(await actions.clearFolders(serials, paths)));
});

// Popup: JSON or multipart (optional uploaded `audio` file, or `libraryFile`).
app.post('/api/actions/message', audioUpload.single('audio'), rebindLang, async (req, res) => {
  const serials = targets(req.body.serials);
  const { mode = 'screen', audio = 'none' } = req.body;
  const volume = req.body.volume === undefined || req.body.volume === '' || req.body.volume === null ? null : Number(req.body.volume);
  let audioFile = null;
  if (mode === 'screen' && audio === 'file') {
    audioFile = req.file?.filename;
    if (!audioFile && req.body.libraryFile) audioFile = actions.mediaFromLibrary(libraryPath(req.body.libraryFile));
    if (!audioFile) throw new HttpError(400, 'audioRequired');
  } else if (!String(req.body.text ?? '').trim()) {
    throw new HttpError(400, 'msgTextRequired');
  }
  const { title, text, level } = req.body;
  res.json(summary(await actions.sendMessage(serials, { title, text, level, mode, audio, audioFile, volume })));
});

app.post('/api/actions/power', async (req, res) => {
  const serials = targets(req.body?.serials);
  const action = req.body?.action;
  if (!['shutdown', 'reboot', 'screen'].includes(action)) throw new HttpError(400, 'badAction');
  res.json(summary(await actions.power(serials, action)));
});

app.post('/api/actions/shell', async (req, res) => {
  const serials = targets(req.body?.serials);
  if (!String(req.body?.command ?? '').trim()) throw new HttpError(400, 'emptyCommand');
  res.json(summary(await actions.runShell(serials, req.body.command)));
});

// A sequence runs for as long as its steps take; `runId` (chosen by the client) lets it be stopped.
app.post('/api/actions/sequence', async (req, res) => {
  const serials = targets(req.body?.serials);
  const stopOnError = req.body?.stopOnError !== false;
  const runId = req.body?.runId ?? null;
  if (runId !== null && !sequences.RUN_ID_RE.test(String(runId))) throw new HttpError(400, 'badRunId');
  const { results, stopped } = await sequences.run(serials, req.body?.steps, { stopOnError, runId });
  res.json({ ...summary(results), stopped });
});

app.post('/api/actions/sequence/:runId/stop', (req, res) => {
  if (!sequences.stop(req.params.runId)) throw new HttpError(404, 'runNotFound');
  res.json({ ok: true });
});

// File library (APKs and audio referenced by sequences).
app.get('/api/library', (_req, res) => res.json({ files: library.list() }));

app.post('/api/library', libraryUpload.single('file'), rebindLang, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'libraryFormats', { list: ['.apk', ...AUDIO_EXT].join(', ') });
  try {
    res.json(await library.store(req.file.path, req.file.originalname));
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

// Saved sequences library.
app.get('/api/sequences', (_req, res) => res.json({ sequences: sequences.list() }));

app.post('/api/sequences', (req, res) => {
  res.json(sequences.save({ name: req.body?.name, steps: req.body?.steps }));
});

app.put('/api/sequences/:id', (req, res) => {
  res.json(sequences.save({ id: req.params.id, name: req.body?.name, steps: req.body?.steps }));
});

app.delete('/api/sequences/:id', (req, res) => {
  sequences.remove(req.params.id);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: t('notFound') }));

// Express 5 forwards rejected promises here as well.
app.use((err, req, res, _next) => {
  const status = err.status ?? (err instanceof multer.MulterError || err instanceof SyntaxError ? 400 : 500);
  if (status >= 500 && status !== 502) console.error(err);
  res.status(status).json({ error: err.message || t('internal', {}, req.lang) });
});

// ------------------------------------------------------------------ start

devices.load();
sequences.load();
library.load();
actions.cleanupMedia();
cleanupUploads();

/** Remove temporary uploads left behind by a crash (they are normally deleted right away). */
function cleanupUploads() {
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    try {
      if (Date.now() - fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs > 3600_000) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

// A stray rejected promise must never take the whole console down.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const server = app.listen(config.port, config.host, async () => {
  const addrs = localInterfaces().map((i) => `http://${i.address}:${config.port}`);
  console.log(`AdbMime web console v${build.version}${build.commit ? ` (${build.commit}${build.dirty ? '+' : ''})` : ''}`);
  console.log(`  local:   http://localhost:${config.port}`);
  for (const a of addrs) console.log(`  network: ${a}`);
  if (!config.authUsername && !config.authPassword) {
    console.log('  auth:    empty username/password (set AUTH_USERNAME/AUTH_PASSWORD in .env)');
  }

  const started = await adb.startServer();
  if (!started.ok) console.warn(`  adb:     ${started.stderr.trim() || 'cannot start adb server'}`);
  await Promise.all([devices.refreshAdb(), devices.probeKnown()]);
  console.log(`  adb:     ${devices.adbStatus.ok ? `v${devices.adbStatus.version}` : devices.adbStatus.error}`);
  if (config.autoScanOnStart) devices.scan().catch((err) => console.warn(`  scan:    ${err.message}`));
});

// Actions can legitimately take long (sequences with pauses, installs on many boards): Node's
// default 5 minute request timeout would cut them off.
server.requestTimeout = 0;
server.on('error', (err) => {
  const reason = err.code === 'EADDRINUSE' ? `port ${config.port} is already in use (set PORT in .env)` : err.message;
  console.error(`AdbMime cannot start: ${reason}`);
  process.exit(1);
});

function shutdown(sig) {
  console.log(`\n${sig}: closing AdbMime…`);
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Background housekeeping.
setInterval(() => devices.refreshAdb().catch(() => {}), 4000);
setInterval(() => {
  if (!devices.scanState.running) devices.probeKnown().catch(() => {});
}, 20_000);
setInterval(actions.cleanupMedia, 3600_000);
