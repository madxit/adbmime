// File library: APKs and audio files referenced by sequences.
// Files are content-addressed (`<sha256 prefix>.<ext>`), so the same file uploaded twice is stored once.
// An index keeps the original file names for the UI.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR } from './config.js';
import { LIBRARY_FILE_RE } from './shared/sequence-format.js';
import { readJson, writeJson } from './store.js';

const INDEX = path.join(LIBRARY_DIR, 'index.json');
let index = {}; // file -> { name, size, kind, addedAt }

export function load() {
  const data = readJson(INDEX, {}, 'library');
  index = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

const persist = () => writeJson(INDEX, index);

const hashFile = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });

/** Move an uploaded temp file into the library. Returns { file, name, size, kind }. */
export async function store(tmpPath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const file = `${(await hashFile(tmpPath)).slice(0, 20)}${ext}`;
  const target = path.join(LIBRARY_DIR, file);
  if (fs.existsSync(target)) fs.rmSync(tmpPath, { force: true });
  else fs.renameSync(tmpPath, target);
  index[file] ??= {
    name: path.basename(originalName).slice(0, 200),
    size: fs.statSync(target).size,
    kind: ext === '.apk' ? 'apk' : 'audio',
    addedAt: Date.now(),
  };
  persist();
  return { file, ...index[file] };
}

/** Absolute path of a library file, or null if invalid/missing. */
export function resolve(file) {
  if (!LIBRARY_FILE_RE.test(String(file ?? ''))) return null;
  const full = path.join(LIBRARY_DIR, file);
  return fs.existsSync(full) ? full : null;
}

export const list = () =>
  Object.entries(index)
    .filter(([file]) => resolve(file))
    .map(([file, meta]) => ({ file, ...meta }))
    .sort((a, b) => a.name.localeCompare(b.name));
