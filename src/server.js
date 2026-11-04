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
import * as sequences from './sequences.js';
import { renderMessagePage } from './views.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SHARED_DIR = path.join(ROOT_DIR, 'src', 'shared');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
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
    version,
    langs: LANGS,
  });
});

app.post('/api/scan', async (_req, res) => {
  res.json(await devices.scan());
});

app.post('/api/refresh', async (_req, res) => {
  await Promise.all([devices.refreshAdb(), devices.probeKnown()]);
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

app.post('/api/actions/message', async (req, res) => {
  const serials = targets(req.body?.serials);
  if (!String(req.body?.text ?? '').trim()) throw new HttpError(400, 'msgTextRequired');
  res.json(summary(await actions.sendMessage(serials, req.body)));
});

app.post('/api/actions/audio', audioUpload.single('audio'), rebindLang, async (req, res) => {
  const serials = targets(req.body.serials);
  const volume = req.body.volume === undefined || req.body.volume === '' ? null : Number(req.body.volume);
  if (!req.file && !String(req.body.text ?? '').trim()) {
    throw new HttpError(400, 'audioRequired');
  }
  res.json(
    summary(await actions.playAudio(serials, { text: req.body.text, audioFile: req.file?.filename, volume })),
  );
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

app.post('/api/actions/sequence', async (req, res) => {
  const serials = targets(req.body?.serials);
  const stopOnError = req.body?.stopOnError !== false;
  res.json(summary(await sequences.run(serials, req.body?.steps, { stopOnError })));
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

app.listen(config.port, config.host, async () => {
  const addrs = localInterfaces().map((i) => `http://${i.address}:${config.port}`);
  console.log('AdbMime web console');
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

// Background housekeeping.
setInterval(() => devices.refreshAdb().catch(() => {}), 4000);
setInterval(() => {
  if (!devices.scanState.running) devices.probeKnown().catch(() => {});
}, 20_000);
setInterval(actions.cleanupMedia, 3600_000);
