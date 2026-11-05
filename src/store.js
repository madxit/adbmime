// JSON persistence helpers shared by the registries in data/.
import fs from 'node:fs';

/**
 * Write JSON atomically (temp file + rename): a crash or a power loss while saving never
 * leaves a truncated file behind.
 */
export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Read a JSON file; `fallback` when it does not exist. A corrupted file is moved aside
 * (`<file>.corrupt-<timestamp>`) instead of being silently overwritten by the next save.
 */
export function readJson(file, fallback, tag = 'store') {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, backup);
    } catch {
      /* keep going with the fallback */
    }
    console.warn(`[${tag}] Cannot read ${file} (${err.message}); moved to ${backup}`);
    return fallback;
  }
}
