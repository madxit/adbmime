// Action recorder: while on, every action executed from any tab is appended to the open sequence.
// It only holds state; the Sequences module listens to the `seqrecord` event, stores the steps and
// renders the counter next to the Sequences tab.

const rec = { on: false, pauses: true, count: 0, lastAt: 0 };

export const isRecording = () => rec.on;
export const recordCount = () => rec.count;

export function setRecording(on) {
  rec.on = on;
  if (on) {
    rec.count = 0;
    rec.lastAt = 0;
  }
  window.dispatchEvent(new CustomEvent('recordchange', { detail: on }));
}

export const setRecordPauses = (on) => (rec.pauses = on);

/** Record one or more steps (adds a pause step for the time elapsed since the previous action). */
export function record(steps) {
  if (!rec.on) return false;
  const list = Array.isArray(steps) ? steps : [steps];
  const now = Date.now();
  if (rec.pauses && rec.lastAt) {
    const gap = Math.min(600, Math.round((now - rec.lastAt) / 100) / 10);
    if (gap >= 0.5) list.unshift({ type: 'sleep', seconds: gap });
  }
  rec.lastAt = now;
  rec.count += list.filter((s) => s.type !== 'sleep').length;
  window.dispatchEvent(new CustomEvent('seqrecord', { detail: list }));
  return true;
}

