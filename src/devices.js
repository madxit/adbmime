// In-memory registry of known boards, kept in sync with network scans and `adb devices`.
// Known boards (serial + custom name) are persisted to data/devices.json so that boards
// which are switched off are still listed after a restart.
import fs from 'node:fs';
import path from 'node:path';
import * as adb from './adb.js';
import { config, DATA_DIR } from './config.js';
import { t } from './i18n.js';
import { hostsOf, isIPv4, mapLimit, probe, scanSubnets, cidrContains } from './network.js';

const STORE = path.join(DATA_DIR, 'devices.json');
const devices = new Map(); // serial -> record

export const scanState = {
  running: false,
  scanned: 0,
  total: 0,
  found: 0,
  subnets: [],
  startedAt: null,
  finishedAt: null,
  error: null,
  errorKey: null, // translated when the state is served
};

export let adbStatus = { ok: false, version: null, error: null };

function parseSerial(serial) {
  const m = serial.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  return m ? { ip: m[1], port: Number(m[2]) } : { ip: null, port: null };
}

function ensure(serial) {
  let d = devices.get(serial);
  if (!d) {
    const { ip, port } = parseSerial(serial);
    d = {
      serial,
      ip,
      port,
      name: '',
      transport: ip ? 'tcp' : 'usb',
      network: 'unknown', // online | offline | unknown  (TCP port reachable?)
      adbState: 'disconnected', // device | unauthorized | offline | disconnected | ...
      manufacturer: null,
      model: null,
      android: null,
      lastSeen: null,
    };
    devices.set(serial, d);
  }
  return d;
}

function persist() {
  const data = [...devices.values()]
    .filter((d) => d.transport === 'tcp')
    .map(({ serial, name, manufacturer, model, android }) => ({
      serial,
      name,
      manufacturer,
      model,
      android,
    }));
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

export function load() {
  if (!fs.existsSync(STORE)) return;
  try {
    for (const saved of JSON.parse(fs.readFileSync(STORE, 'utf8'))) {
      if (!adb.isValidSerial(saved.serial)) continue;
      Object.assign(ensure(saved.serial), {
        name: saved.name ?? '',
        manufacturer: saved.manufacturer ?? null,
        model: saved.model ?? null,
        android: saved.android ?? null,
      });
    }
  } catch (err) {
    console.warn(`[devices] Cannot read ${STORE}: ${err.message}`);
  }
}

/** Status as shown to the user. */
function status(d) {
  if (d.adbState === 'device') return 'connected';
  if (d.adbState === 'unauthorized') return 'unauthorized';
  if (d.network === 'online') return 'online';
  if (d.network === 'offline') return 'offline';
  return 'unknown';
}

export function list() {
  return [...devices.values()]
    .map((d) => ({ ...d, status: status(d) }))
    .sort((a, b) => {
      const ka = a.ip ? a.ip.split('.').map((n) => n.padStart(3, '0')).join('.') : a.serial;
      const kb = b.ip ? b.ip.split('.').map((n) => n.padStart(3, '0')).join('.') : b.serial;
      return ka.localeCompare(kb);
    });
}

export const get = (serial) => devices.get(serial);
export const isConnected = (serial) => devices.get(serial)?.adbState === 'device';

export function add(ip) {
  if (!isIPv4(ip)) throw new Error(t('badIp'));
  const d = ensure(`${ip}:${config.adbPort}`);
  persist();
  return d;
}

export function rename(serial, name) {
  const d = devices.get(serial);
  if (!d) throw new Error(t('unknownBoardShort'));
  d.name = String(name ?? '').trim().slice(0, 60);
  persist();
  return d;
}

export function forget(serial) {
  devices.delete(serial);
  persist();
}

/** Fetch model/Android version once a board is connected. */
async function fillInfo(d) {
  if (d.model && d.android) return;
  const info = await adb.deviceInfo(d.serial);
  if (info) {
    Object.assign(d, info);
    persist();
  }
}

/** Sync adb connection states with `adb devices`. */
export async function refreshAdb() {
  const listed = await adb.listDevices();
  // Query the version only at startup or after a failure (it spawns another process).
  if (!listed || !adbStatus.ok) adbStatus = await adb.adbVersion();
  if (!listed) return;
  const seen = new Set();
  for (const item of listed) {
    if (!adb.isValidSerial(item.serial)) continue;
    seen.add(item.serial);
    const d = ensure(item.serial);
    d.adbState = item.state;
    if (item.state === 'device') {
      d.network = 'online';
      d.lastSeen = Date.now();
      if (!d.model && item.model) d.model = item.model.replace(/_/g, ' ');
      fillInfo(d).catch(() => {});
    }
  }
  for (const d of devices.values()) {
    if (!seen.has(d.serial)) d.adbState = 'disconnected';
  }
  // Drop USB devices that disappeared (they are not persisted anyway).
  for (const d of [...devices.values()]) {
    if (d.transport === 'usb' && !seen.has(d.serial)) devices.delete(d.serial);
  }
}

/** Quickly re-check reachability of every known TCP board. */
export async function probeKnown() {
  const tcp = [...devices.values()].filter((d) => d.transport === 'tcp');
  await mapLimit(tcp, config.scanConcurrency, async (d) => {
    const up = await probe(d.ip, d.port);
    d.network = up ? 'online' : 'offline';
    if (up) d.lastSeen = Date.now();
  });
}

/** Scan the configured/auto-detected subnets for hosts with the ADB port open. */
export async function scan() {
  if (scanState.running) return scanState;
  let subnets;
  try {
    subnets = scanSubnets();
  } catch (err) {
    scanState.error = err.message;
    scanState.errorKey = null;
    throw err;
  }
  const hosts = [...new Set(subnets.flatMap(hostsOf))];
  Object.assign(scanState, {
    running: true,
    scanned: 0,
    total: hosts.length,
    found: 0,
    subnets,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    errorKey: subnets.length ? null : 'noNetwork',
  });

  (async () => {
    const found = new Set();
    await mapLimit(hosts, config.scanConcurrency, async (ip) => {
      if (await probe(ip, config.adbPort)) {
        found.add(ip);
        scanState.found++;
        const d = ensure(`${ip}:${config.adbPort}`);
        d.network = 'online';
        d.lastSeen = Date.now();
      }
      scanState.scanned++;
    });
    // Known boards inside the scanned ranges that did not answer are switched off.
    for (const d of devices.values()) {
      if (d.transport !== 'tcp' || found.has(d.ip) || d.adbState === 'device') continue;
      if (subnets.some((c) => cidrContains(c, d.ip))) d.network = 'offline';
    }
    persist();
    await refreshAdb();
  })()
    .catch((err) => {
      scanState.error = err.message;
    })
    .finally(() => {
      scanState.running = false;
      scanState.finishedAt = Date.now();
    });

  return scanState;
}

/** Connect to boards, then refresh their state. */
export async function connect(serials) {
  const results = await mapLimit(serials, config.actionConcurrency, async (serial) => ({
    serial,
    ...(await adb.connect(serial)),
  }));
  await refreshAdb();
  // A board that has never authorised this PC shows a confirmation dialog on screen.
  for (const r of results) {
    if (devices.get(r.serial)?.adbState === 'unauthorized') {
      r.ok = false;
      r.output = `${r.output}\n${t('authRequired')}`;
    }
  }
  return results;
}

export async function disconnect(serials) {
  const results = await mapLimit(serials, config.actionConcurrency, async (serial) => ({
    serial,
    ...(await adb.disconnect(serial)),
  }));
  await refreshAdb();
  return results;
}
