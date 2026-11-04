// Saved sequences (macros) and their execution on the boards.
// Sequences are persisted in data/sequences.json and shared by every user of the console.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as adb from './adb.js';
import { onBoards } from './actions.js';
import { DATA_DIR } from './config.js';
import { t } from './i18n.js';
import { deviceCommand, normalizeSteps, StepError } from './shared/sequence-format.js';

const STORE = path.join(DATA_DIR, 'sequences.json');
let sequences = [];

export function load() {
  if (!fs.existsSync(STORE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    sequences = Array.isArray(data) ? data.filter((s) => s && typeof s.id === 'string') : [];
  } catch (err) {
    console.warn(`[sequences] Cannot read ${STORE}: ${err.message}`);
  }
}

const persist = () => fs.writeFileSync(STORE, JSON.stringify(sequences, null, 2));

/** Validate steps, turning StepError into a translated Error with status 400. */
export function validate(steps) {
  try {
    return normalizeSteps(steps);
  } catch (err) {
    if (!(err instanceof StepError)) throw err;
    const reason = t(`seq_${err.code}`, err.params);
    const e = new Error(err.index === null ? reason : t('seqStepInvalid', { n: err.index + 1, reason }));
    e.status = 400;
    throw e;
  }
}

const cleanName = (name) => String(name ?? '').trim().slice(0, 80);

export const list = () => sequences;

export function save({ id, name, steps }) {
  const clean = { name: cleanName(name) || 'Sequenza', steps: validate(steps), updatedAt: Date.now() };
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

/**
 * Run the steps, in order, on every board (boards run in parallel).
 * The per-board output lists each executed step.
 */
export function run(serials, rawSteps, { stopOnError = true } = {}) {
  const steps = validate(rawSteps);
  return onBoards(
    serials,
    async (serial) => {
      const lines = [];
      let ok = true;
      for (const [i, step] of steps.entries()) {
        if (step.type === 'comment') continue;
        if (step.type === 'sleep') {
          await delay(step.seconds * 1000);
          lines.push(`· ${pad(i + 1)}  sleep ${step.seconds}`);
          continue;
        }
        const cmd = deviceCommand(step);
        const r = await adb.shell(serial, cmd, { timeout: 60_000 });
        // `pm`/`am` report most failures on stdout with a zero exit code.
        const failed = !r.ok || /^(Error|Failure|Exception)\b|\bException:/m.test(r.output);
        lines.push(`${failed ? '✗' : '✓'} ${pad(i + 1)}  ${cmd}${r.output ? `\n      ${r.output.replace(/\n/g, '\n      ')}` : ''}`);
        if (failed) {
          ok = false;
          if (stopOnError) {
            lines.push(t('seqAborted'));
            break;
          }
        }
      }
      return { ok, output: lines.join('\n') };
    },
    32,
  );
}
