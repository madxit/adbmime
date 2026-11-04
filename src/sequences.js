// Saved sequences (macros) and their execution on the boards.
// Sequences are persisted in data/sequences.json and shared by every user of the console.
import crypto from 'node:crypto';
import path from 'node:path';
import * as adb from './adb.js';
import * as actions from './actions.js';
import { onBoards } from './actions.js';
import { DATA_DIR } from './config.js';
import { t } from './i18n.js';
import * as library from './library.js';
import { readJson, writeJson } from './store.js';
import { deviceCommand, normalizeSteps, StepError, stepLabel } from './shared/sequence-format.js';

const STORE = path.join(DATA_DIR, 'sequences.json');
let sequences = [];

export function load() {
  const data = readJson(STORE, [], 'sequences');
  sequences = Array.isArray(data) ? data.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.steps)) : [];
}

const persist = () => writeJson(STORE, sequences);

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const stepError = (i, reason) => badRequest(t('seqStepInvalid', { n: i + 1, reason }));

/**
 * Validate steps, turning StepError into a translated Error with status 400.
 * With `forRun`, also checks what only matters at execution time (library files, allowed folders).
 */
export function validate(steps, { forRun = false, allowEmpty = false } = {}) {
  let clean;
  try {
    clean = normalizeSteps(steps, { allowEmpty: allowEmpty && !forRun });
  } catch (err) {
    if (!(err instanceof StepError)) throw err;
    const reason = t(`seq_${err.code}`, err.params);
    throw err.index === null ? badRequest(reason) : stepError(err.index, reason);
  }
  if (forRun) {
    clean.forEach((step, i) => {
      if (step.file && !library.resolve(step.file)) throw stepError(i, t('libraryMissing', { name: step.name }));
      if (step.type === 'clear') {
        try {
          step.paths.forEach(actions.validateFolder);
        } catch (err) {
          throw stepError(i, err.message);
        }
      }
    });
  }
  return clean;
}

const cleanName = (name) => String(name ?? '').trim().slice(0, 80);

export const list = () => sequences;

export function save({ id, name, steps }) {
  const clean = { name: cleanName(name) || 'Sequenza', steps: validate(steps, { allowEmpty: true }), updatedAt: Date.now() };
  let seq = id ? sequences.find((s) => s.id === id) : null;
  if (id && !seq) {
    const e = new Error(t('seqNotFound'));
    e.status = 404;
    throw e;
  }
  if (seq) Object.assign(seq, clean);
  else {
    seq = { id: crypto.randomUUID(), ...clean };
    sequences.push(seq);
  }
  persist();
  return seq;
}

export function remove(id) {
  const before = sequences.length;
  sequences = sequences.filter((s) => s.id !== id);
  if (sequences.length !== before) persist();
}

const pad = (n) => String(n).padStart(2, '0');

/** Sleep that ends early when `signal` is aborted. */
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

/**
 * Prepare audio files once for every board: library files are copied
 * to the public media folder. Returns a map step index -> media file name.
 */
async function prepareAudio(steps) {
  const media = new Map();
  for (const [i, step] of steps.entries()) {
    // Spoken text needs nothing here: the board's browser reads it aloud.
    if (step.type !== 'popup' || step.mode !== 'screen' || step.audio !== 'file') continue;
    media.set(i, actions.mediaFromLibrary(library.resolve(step.file)));
  }
  return media;
}

/** Execute one step on one board: { ok, output }. Long adb commands are killed by `signal`. */
async function runStep(serial, step, mediaFile, signal) {
  const first = async (promise) => (await promise)[0] ?? { ok: false, output: '' };
  switch (step.type) {
    case 'install':
      return adb.install(serial, library.resolve(step.file), { grantPermissions: step.grant, signal });
    case 'clear':
      return first(actions.clearFolders([serial], step.paths));
    case 'popup':
      return first(actions.sendMessage([serial], { ...step, audioFile: mediaFile }));
    case 'power':
      return first(actions.power([serial], step.action));
    default: {
      const r = await adb.shell(serial, deviceCommand(step), { timeout: 60_000, signal });
      // `pm`/`am` report most failures on stdout with a zero exit code.
      return { ok: r.ok && !/^(Error|Failure|Exception)\b|\bException:/m.test(r.output), output: r.output };
    }
  }
}

// Running sequences that can be stopped: runId -> AbortController.
const runs = new Map();
export const RUN_ID_RE = /^[\w-]{8,64}$/;

/** Stop a running sequence; false when no run has that id. */
export function stop(runId) {
  const ctrl = runs.get(runId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * Run the steps, in order, on every board (boards run in parallel).
 * The per-board output lists each executed step. With a `runId` the run can be stopped
 * (see stop): pauses end at once and the adb command in progress is killed.
 * Returns { results, stopped }.
 */
export async function run(serials, rawSteps, { stopOnError = true, runId = null } = {}) {
  const steps = validate(rawSteps, { forRun: true });
  if (runId && runs.has(runId)) throw badRequest(t('seqAlreadyRunning'));
  const ctrl = new AbortController();
  const { signal } = ctrl;
  if (runId) runs.set(runId, ctrl);
  try {
    const media = await prepareAudio(steps);
    const results = await onBoards(
      serials,
      async (serial) => {
        const lines = [];
        let ok = true;
        for (const [i, step] of steps.entries()) {
          if (signal.aborted) break;
          if (step.type === 'comment') continue;
          if (step.type === 'sleep') {
            await sleep(step.seconds * 1000, signal);
            if (!signal.aborted) lines.push(`· ${pad(i + 1)}  sleep ${step.seconds}`);
            continue;
          }
          const r = await runStep(serial, step, media.get(i), signal);
          if (signal.aborted && !r.ok) break; // killed by the stop request: not a failure
          const failed = !r.ok;
          lines.push(`${failed ? '✗' : '✓'} ${pad(i + 1)}  ${stepLabel(step)}${r.output ? `\n      ${r.output.replace(/\n/g, '\n      ')}` : ''}`);
          if (failed) {
            ok = false;
            if (stopOnError) {
              lines.push(t('seqAborted'));
              break;
            }
          }
        }
        if (signal.aborted) lines.push(`■ ${t('seqStopped')}`);
        return { ok, output: lines.join('\n'), stopped: signal.aborted };
      },
      32,
    );
    return { results, stopped: signal.aborted };
  } finally {
    if (runId) runs.delete(runId);
  }
}
