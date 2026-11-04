// Thin async wrapper around the `adb` command line tool.
// Commands are always spawned with execFile (no host shell), so arguments cannot inject
// host commands. Strings sent to the *device* shell must be quoted with `shQuote`.
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { t } from './i18n.js';

/** Quote a value for the Android (mksh/toybox) shell. */
export const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** A serial is either `ip:port` (TCP) or a USB serial: never let it look like a flag. */
export const isValidSerial = (serial) =>
  typeof serial === 'string' && /^[A-Za-z0-9][\w.:\-]*$/.test(serial) && serial.length < 128;

/**
 * Run adb with the given arguments.
 * Resolves (never rejects) with { ok, code, stdout, stderr, timedOut, aborted }.
 * `signal` (AbortSignal) kills the adb process, e.g. when a sequence is stopped.
 */
export function adb(args, { timeout = config.commandTimeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    execFile(
      config.adbPath,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, signal },
      (err, stdout = '', stderr = '') => {
        if (err?.code === 'ENOENT') {
          resolve({
            ok: false,
            code: -1,
            stdout: '',
            stderr: t('adbNotFound', { path: config.adbPath }),
            timedOut: false,
          });
          return;
        }
        const aborted = err?.name === 'AbortError';
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: Boolean(err?.killed) && !aborted,
          aborted,
        });
      },
    );
  });
}

export async function adbVersion() {
  const r = await adb(['version'], { timeout: 5000 });
  const match = r.stdout.match(/Android Debug Bridge version ([\d.]+)/);
  return { ok: r.ok, version: match?.[1] ?? null, error: r.ok ? null : r.stderr.trim() };
}

export const startServer = () => adb(['start-server'], { timeout: 15_000 });

/** Parse `adb devices -l` into [{ serial, state, model, product, device }]. */
export async function listDevices() {
  const r = await adb(['devices', '-l'], { timeout: 10_000 });
  if (!r.ok) return null;
  return r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const extra = Object.fromEntries(
        rest.filter((kv) => kv.includes(':')).map((kv) => kv.split(/:(.*)/s).slice(0, 2)),
      );
      return { serial, state, model: extra.model ?? null, product: extra.product ?? null };
    });
}

/** `adb connect` exits with 0 even on failure: inspect the output instead. */
export async function connect(serial) {
  const r = await adb(['connect', serial], { timeout: 12_000 });
  const out = `${r.stdout}${r.stderr}`.trim();
  const ok = /connected to/i.test(out) && !/fail|unable|cannot/i.test(out);
  return { ok, output: out || (r.timedOut ? t('connectTimeout') : '') };
}

export async function disconnect(serial) {
  const r = await adb(['disconnect', serial], { timeout: 8000 });
  const out = `${r.stdout}${r.stderr}`.trim();
  return { ok: r.ok && !/error/i.test(out), output: out };
}

/** Run a command in the device shell. `code` is the remote exit status (adb shell protocol v2). */
export async function shell(serial, command, opts) {
  const r = await adb(['-s', serial, 'shell', command], opts);
  return {
    ok: r.ok,
    output: `${r.stdout}${r.stderr}`.trim() || (r.timedOut ? 'Timeout' : ''),
    code: r.code,
    timedOut: r.timedOut,
    aborted: r.aborted,
  };
}

/**
 * Tunnel `localhost:port` on the device to `localhost:port` on this PC (`adb reverse`).
 * Lets USB devices reach this server even when they are not on the PC's network.
 */
export async function reverse(serial, port) {
  const r = await adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], { timeout: 10_000 });
  return { ok: r.ok, output: `${r.stdout}${r.stderr}`.trim() };
}

export async function install(serial, apkPath, { grantPermissions = false, signal } = {}) {
  const args = ['-s', serial, 'install', '-r'];
  if (grantPermissions) args.push('-g');
  args.push(apkPath);
  const r = await adb(args, { timeout: config.installTimeoutMs, signal });
  const out = `${r.stdout}${r.stderr}`.trim();
  return { ok: /\bSuccess\b/.test(out), output: out || (r.timedOut ? 'Timeout' : ''), aborted: r.aborted };
}

export async function uninstall(serial, packageName) {
  const r = await adb(['-s', serial, 'uninstall', packageName], { timeout: 60_000 });
  const out = `${r.stdout}${r.stderr}`.trim();
  return { ok: /\bSuccess\b/.test(out), output: out };
}

export async function reboot(serial) {
  const r = await adb(['-s', serial, 'reboot'], { timeout: 10_000 });
  // The connection drops while rebooting: a timeout is expected and fine.
  return { ok: r.ok || r.timedOut, output: `${r.stdout}${r.stderr}`.trim() || t('rebootSent') };
}

/** Read a few identifying properties of a connected device. */
export async function deviceInfo(serial) {
  const props = ['ro.product.manufacturer', 'ro.product.model', 'ro.build.version.release'];
  const r = await shell(serial, props.map((p) => `getprop ${p}`).join('; echo "|"; '), {
    timeout: 8000,
  });
  if (!r.ok) return null;
  const [manufacturer, model, android] = r.output.split('|').map((s) => s.trim());
  return { manufacturer: manufacturer || null, model: model || null, android: android || null };
}

/** Run adb and capture stdout as a Buffer (for binary output such as screenshots). */
function adbBinary(args, timeout) {
  return new Promise((resolve) => {
    execFile(
      config.adbPath,
      args,
      { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
      (err, stdout) => resolve({ ok: !err, stdout: stdout ?? Buffer.alloc(0) }),
    );
  });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (buf) => buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC);

/** PNG screenshot of the device, or null. */
export async function screencap(serial) {
  const r = await adbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 20_000);
  if (isPng(r.stdout)) return r.stdout;
  // Very old devices have no `exec-out`: fall back to `shell`, which may turn \n into \r\n.
  const legacy = await adbBinary(['-s', serial, 'shell', 'screencap', '-p'], 20_000);
  if (isPng(legacy.stdout)) return legacy.stdout;
  const fixed = Buffer.from(legacy.stdout.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return isPng(fixed) ? fixed : null;
}
