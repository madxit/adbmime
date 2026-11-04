// Centralised configuration, loaded from `.env` (if present) and the process environment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  // Native .env loader (Node >= 20.12). Values already in the environment win.
  process.loadEnvFile(envFile);
}

const env = process.env;

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);
const list = (value) =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
// Files referenced by sequences (APKs, audio): kept until removed, unlike uploads/media.
export const LIBRARY_DIR = path.join(DATA_DIR, 'library');
for (const dir of [DATA_DIR, UPLOAD_DIR, MEDIA_DIR, LIBRARY_DIR]) fs.mkdirSync(dir, { recursive: true });

export const config = {
  port: int(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',

  authUsername: env.AUTH_USERNAME ?? '',
  authPassword: env.AUTH_PASSWORD ?? '',
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionTtlMs: int(env.SESSION_TTL_HOURS, 12) * 3600 * 1000,

  adbPath: env.ADB_PATH || 'adb',
  adbPort: int(env.ADB_PORT, 5555),
  commandTimeoutMs: 30_000,
  installTimeoutMs: 5 * 60_000,
  // Max number of boards processed in parallel for a single action.
  actionConcurrency: 16,

  scanSubnets: list(env.SCAN_SUBNETS),
  scanTimeoutMs: int(env.SCAN_TIMEOUT_MS, 700),
  scanConcurrency: int(env.SCAN_CONCURRENCY, 128),
  autoScanOnStart: bool(env.AUTO_SCAN_ON_START, true),

  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  clearAllowedRoots: list(
    env.CLEAR_ALLOWED_ROOTS || '/sdcard,/storage/emulated/0,/storage,/mnt/sdcard,/data/local/tmp',
  ),

  ttsVoice: env.TTS_VOICE || '',
};
