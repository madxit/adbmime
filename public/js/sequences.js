// Sequences ("macros"): library saved on the server, step editor, import/export, execution.
import { icon } from '/assets/icons.js';
import { locale, t } from '/assets/i18n.js';
import {
  KEYCODES, keyName, normalizeSteps, parseSequenceFile, StepError, STEP_TYPES, toText,
} from '/shared/sequence-format.js';
import { uploadToLibrary } from './actions.js';
import { $, api, confirmDanger, connectedTargets, esc, modal, run, state, switchTab, toast, uid } from './core.js';
import { isRecording, recordCount, setRecording, setRecordPauses } from './recorder.js';

const TYPE_ICON = {
  tap: 'tap', swipe: 'swipe', key: 'key', text: 'text', sleep: 'clock', open: 'open', url: 'globe',
  shell: 'terminal', uninstall: 'trash', hide: 'eyeOff', unhide: 'eye', comment: 'hash',
  install: 'package', clear: 'folder', popup: 'message', power: 'power',
};

const DEFAULTS = {
  tap: { x: 0, y: 0 },
  swipe: { x1: 0, y1: 0, x2: 0, y2: 0, duration: 300 },
  key: { keycode: 3, longpress: false },
  text: { text: '' },
  sleep: { seconds: 1 },
  open: { package: '' },
  url: { url: 'https://' },
  shell: { command: '' },
  uninstall: { package: '' },
  hide: { package: '' },
  unhide: { package: '' },
  comment: { text: '' },
  install: { file: '', name: '', grant: false },
  clear: { paths: ['/sdcard/Download'] },
  popup: { mode: 'screen', level: 'info', title: '', text: '', audio: 'none', volume: null },
  power: { action: 'reboot' },
};

const DRAFT_KEY = 'adbmime.seqDraft';
let library = [];
let files = []; // server file library (APKs, audio) used by install and audio popup steps
let ed = loadDraft() ?? { id: null, name: '', steps: [], dirty: false };
let invalidIndex = -1;
let running = null; // { runId, stopping } while a sequence runs

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    return d && Array.isArray(d.steps) ? d : null;
  } catch {
    return null;
  }
}
const saveDraft = () => localStorage.setItem(DRAFT_KEY, JSON.stringify(ed));

function markDirty(dirty = true) {
  ed.dirty = dirty;
  invalidIndex = -1;
  $('#seqDirty').hidden = !dirty;
  $('#seqDirtyDot').hidden = !dirty || state.tab === 'sequences';
  saveDraft();
  renderMeta();
}

/** Validate the editor steps; highlights the faulty row and returns null on error. */
function validated(opts) {
  try {
    return normalizeSteps(ed.steps, opts);
  } catch (err) {
    if (!(err instanceof StepError)) throw err;
    const reason = t(`seq_${err.code}`, err.params);
    invalidIndex = err.index ?? -1;
    renderSteps();
    toast(err.index === null ? reason : t('seq.invalid', { n: err.index + 1, reason }), 'err');
    return null;
  }
}

// ------------------------------------------------------------------ rendering

const num = (field, value, extra = '') =>
  `<input class="input num" type="number" data-field="${field}" value="${esc(value)}" ${extra}>`;
const txt = (field, value, placeholder, cls = '') =>
  `<input class="input wide ${cls}" data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">`;

function keySelect(code) {
  const known = Object.entries(KEYCODES);
  const isKnown = known.some(([, c]) => c === Number(code));
  return `<select class="input" data-field="keyname">
      ${known.map(([n, c]) => `<option value="${c}" ${c === Number(code) ? 'selected' : ''}>${n}</option>`).join('')}
      <option value="custom" ${isKnown ? '' : 'selected'}>${esc(t('seq.customKey'))}</option>
    </select>${num('keycode', code, 'min="0" max="999" style="width:68px"')}`;
}

const opt = (value, current, text) =>
  `<option value="${esc(value)}" ${String(value) === String(current ?? '') ? 'selected' : ''}>${esc(text)}</option>`;
const select = (field, current, options) =>
  `<select class="input" data-field="${field}">${options.map(([v, label]) => opt(v, current, label)).join('')}</select>`;

/** Picker of library files of a kind, plus an upload button. */
function filePicker(s, kind, emptyLabel) {
  const list = files.filter((f) => f.kind === kind);
  const missing = s.file && !list.some((f) => f.file === s.file);
  const options = [['', emptyLabel], ...list.map((f) => [f.file, f.name])];
  if (missing) options.push([s.file, t('seq.missingFile', { name: s.name || s.file })]);
  return `${select('file', s.file, options)}
    <button class="btn sm" data-op="upload" data-kind="${kind}" title="${esc(t('seq.upload'))}">${icon('upload')}</button>
    ${missing ? `<span class="missing">${esc(t('seq.missingHint'))}</span>` : ''}`;
}

function params(s) {
  switch (s.type) {
    case 'install':
      return `${filePicker(s, 'apk', t('seq.pickApk'))}<label class="switch sm"><input type="checkbox" data-field="grant" ${s.grant ? 'checked' : ''}><span class="track"></span>-g</label>`;
    case 'clear':
      return txt('paths', (s.paths ?? []).join(', '), '/sdcard/Download, /sdcard/DCIM', 'mono');
    case 'popup': {
      const kind = s.mode === 'screen' ? (s.audio ?? 'none') : 'none';
      const audioOpts = [['none', t('msg.audioNone')], ['tts', t('msg.audioTts')], ['file', t('msg.audioFile')]];
      return `${select('mode', s.mode, [['screen', t('msg.modeScreen')], ['notification', t('msg.modeNotif')]])}
        ${s.mode === 'screen' ? select('level', s.level, [['info', t('msg.info')], ['warning', t('msg.warning')], ['urgent', t('msg.urgent')]]) : ''}
        <input class="input" style="width:150px" data-field="title" value="${esc(s.title)}" placeholder="${esc(t('msg.titleField'))}">
        ${txt('text', s.text, t('msg.text'))}
        ${s.mode === 'screen' ? `<span class="unit">${icon('volume')}</span>${select('audio', kind, audioOpts)}` : ''}
        ${kind === 'file' ? filePicker(s, 'audio', t('seq.pickAudio')) : ''}
        ${kind === 'none' ? '' : `${num('volume', s.volume ?? '', 'min="1" max="15" style="width:62px"')}<span class="unit">vol</span>`}`;
    }
    case 'power':
      return select('action', s.action, ['shutdown', 'reboot', 'screen'].map((a) => [a, t(`power.${a}`)]));
    case 'tap':
      return `<span class="unit">X</span>${num('x', s.x, 'min="0"')}<span class="unit">Y</span>${num('y', s.y, 'min="0"')}`;
    case 'swipe':
      return `${num('x1', s.x1, 'min="0"')}${num('y1', s.y1, 'min="0"')}<span class="unit">→</span>${num('x2', s.x2, 'min="0"')}${num('y2', s.y2, 'min="0"')}${num('duration', s.duration, 'min="0" max="10000" step="50"')}<span class="unit">ms</span>`;
    case 'key':
      return `${keySelect(s.keycode)}<label class="switch sm"><input type="checkbox" data-field="longpress" ${s.longpress ? 'checked' : ''}><span class="track"></span>${esc(t('seq.longpress'))}</label>`;
    case 'text':
      return txt('text', s.text, t('seq.textPh'));
    case 'sleep':
      return `${num('seconds', s.seconds, 'min="0" max="600" step="0.1"')}<span class="unit">${esc(t('seq.seconds'))}</span>`;
    case 'open':
    case 'hide':
    case 'unhide':
    case 'uninstall':
      return txt('package', s.package, 'com.example.app', 'mono');
    case 'url':
      return txt('url', s.url, 'https://…', 'mono');
    case 'shell':
      return txt('command', s.command, t('seq.commandPh'), 'mono');
    case 'comment':
      return txt('text', s.text, t('seq.commentPh'));
    default:
      return '';
  }
}

function stepRow(s, i) {
  return `<div class="step t-${s.type} ${i === invalidIndex ? 'invalid' : ''}" data-i="${i}">
    <span class="step-n">${i + 1}</span>
    <span class="step-type"><span class="ti">${icon(TYPE_ICON[s.type] ?? 'terminal')}</span>${esc(t(`step.${s.type}`))}</span>
    <div class="step-params">${params(s)}</div>
    <div class="step-acts">
      <button class="btn" data-op="up" title="${esc(t('seq.moveUp'))}" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="btn" data-op="down" title="${esc(t('seq.moveDown'))}" ${i === ed.steps.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
      <button class="btn" data-op="dup" title="${esc(t('seq.duplicateStep'))}">${icon('copy')}</button>
      <button class="btn del" data-op="del" title="${esc(t('seq.remove'))}">${icon('x')}</button>
    </div>
  </div>`;
}

/** Old "audio" steps (saved before audio became part of popups) are edited as audio popups. */
function migrateStep(s) {
  if (s.type !== 'audio') return s;
  const audio = s.file ? 'file' : 'tts';
  return { type: 'popup', mode: 'screen', level: 'info', title: '', text: s.text ?? '', audio, file: s.file, name: s.name, volume: s.volume ?? null };
}

function renderSteps() {
  ed.steps = ed.steps.map(migrateStep);
  $('#seqSteps').innerHTML = ed.steps.length
    ? ed.steps.map(stepRow).join('')
    : `<div class="empty"><div class="big">${icon('layers')}</div><div>${esc(t('seq.noSteps'))}</div></div>`;
  renderMeta();
}

function estimateSeconds() {
  return ed.steps.reduce((sum, s) => {
    if (s.type === 'sleep') return sum + (Number(s.seconds) || 0);
    if (s.type === 'comment') return sum;
    return sum + 0.3 + (s.type === 'swipe' ? (Number(s.duration) || 0) / 1000 : 0);
  }, 0);
}

function renderMeta() {
  renderChip();
  const secs = Math.round(estimateSeconds());
  $('#seqMeta').textContent = ed.steps.length
    ? `${t('seq.steps', { n: ed.steps.length })} · ${t('seq.duration', { s: secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s` })}`
    : '';
  const targets = connectedTargets().length;
  $('#seqRunLabel').textContent = t('seq.run', { n: targets });
  $('#seqRun').disabled = targets === 0 || !ed.steps.length;
  $('#seqRun').hidden = Boolean(running);
  $('#seqStop').hidden = !running;
  $('#seqStop').disabled = Boolean(running?.stopping);
  $('#seqStopLabel').textContent = t(running?.stopping ? 'seq.stopping' : 'seq.stop');
  $('#seqDelete').disabled = !ed.id;
  $('#seqClear').disabled = !ed.steps.length;
  $('#seqExport').disabled = !ed.steps.length;
  $('#seqDuplicate').disabled = !ed.steps.length;
}

/** Actions in the open sequence (pauses and comments are not actions). */
const actionCount = () => ed.steps.filter((s) => s.type !== 'sleep' && s.type !== 'comment').length;

/**
 * Counter next to the Sequences tab: actions of the open sequence (0 for a new one).
 * Red with a breathing dot while recording, neutral otherwise.
 */
function renderChip() {
  const n = actionCount();
  const on = isRecording();
  $('#recCount').textContent = n;
  $('#recChip').classList.toggle('rec', on);
  $('#recChip').title = `${t('seq.chip', { n })}${on ? ` · ${t('rec.active')}` : ''}`;
}

/** Recording strip above the steps (the switch itself is next to the Sequences tab). */
function renderRecBar() {
  const on = isRecording();
  $('#recBar').classList.toggle('on', on);
  $('#recState').textContent = on ? `${t('rec.active')} · ${t('rec.chip', { n: recordCount() })}` : t('rec.off');
  $('#recHint').textContent = t(on ? 'rec.hint' : 'rec.offHint');
}

/** Saved sequences, listed in the dropdown of the toolbar. */
function renderLibrary() {
  $('#seqLibCount').textContent = library.length;
  $('#seqLibMenu').innerHTML = library.length
    ? library
        .map(
          (s) => `<button class="seq-item ${s.id === ed.id ? 'active' : ''}" data-id="${esc(s.id)}">
            <b>${esc(s.name)}</b>
            <span>${esc(t('seq.steps', { n: s.steps.length }))} · ${esc(new Date(s.updatedAt).toLocaleDateString(locale()))}</span>
          </button>`,
        )
        .join('')
    : `<div class="empty-small">${esc(t('seq.emptyLib'))}</div>`;
}

function renderEditor() {
  $('#seqName').value = ed.name;
  $('#seqDirty').hidden = !ed.dirty;
  $('#seqDirtyDot').hidden = !ed.dirty || state.tab === 'sequences';
  renderSteps();
  renderLibrary();
  renderRecBar();
}

export function renderSequences() {
  renderEditor();
  $('#seqAddMenu').innerHTML = STEP_TYPES.map(
    (type) => `<button data-type="${type}">${icon(TYPE_ICON[type])}${esc(t(`step.${type}`))}</button>`,
  ).join('');
}

// ------------------------------------------------------------------ public API (recorder)

/** Append steps (e.g. recorded on the remote screen) to the open sequence. */
export function appendSteps(steps) {
  ed.steps.push(...steps.map((s) => ({ ...s })));
  if (!ed.name) ed.name = t('seq.untitled');
  markDirty();
  renderEditor();
  const rows = $('#seqSteps').children;
  rows[rows.length - 1]?.classList.add('flash');
  $('#seqSteps').scrollTop = $('#seqSteps').scrollHeight;
}

export const openSequencesTab = () => switchTab('sequences');

// ------------------------------------------------------------------ actions

async function canDiscard() {
  if (!ed.dirty || !ed.steps.length) return true;
  return Boolean(
    await modal({ title: t('seq.discardTitle'), text: t('seq.discardText'), okText: t('seq.discardOk'), danger: true }),
  );
}

function open(seq) {
  ed = seq
    ? { id: seq.id, name: seq.name, steps: structuredClone(seq.steps), dirty: false }
    : { id: null, name: '', steps: [], dirty: false };
  invalidIndex = -1;
  saveDraft();
  renderEditor();
}

async function loadFiles() {
  try {
    files = (await api('/api/library')).files;
  } catch {
    files = [];
  }
}

async function loadLibrary() {
  try {
    library = (await api('/api/sequences')).sequences;
    library.sort((a, b) => a.name.localeCompare(b.name, locale()));
  } catch (err) {
    toast(err.message, 'err');
  }
  renderLibrary();
}

async function save() {
  const steps = validated({ allowEmpty: true });
  if (!steps) return;
  const name = ed.name.trim() || t('seq.untitled');
  try {
    const body = { name, steps };
    const saved = ed.id
      ? await api(`/api/sequences/${encodeURIComponent(ed.id)}`, { method: 'PUT', body })
      : await api('/api/sequences', { method: 'POST', body });
    ed = { id: saved.id, name: saved.name, steps: saved.steps, dirty: false };
    markDirty(false);
    toast(t('seq.saved'), 'ok');
    await loadLibrary();
    renderEditor();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function download(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCurrent() {
  const steps = validated();
  if (!steps) return;
  const name = ed.name.trim() || t('seq.untitled');
  const slug = name.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sequence';
  download(`${slug}.txt`, toText(steps, name));
}

async function importFile(file) {
  if (!(await canDiscard())) return;
  let parsed;
  try {
    parsed = parseSequenceFile(await file.text());
  } catch {
    return toast(t('seq.importFail'), 'err');
  }
  if (!parsed.steps.length) return toast(t('seq.importFail'), 'err');
  ed = { id: null, name: parsed.name || file.name.replace(/\.[^.]+$/, ''), steps: parsed.steps, dirty: true };
  markDirty();
  renderEditor();
  toast(t('seq.imported', { n: parsed.steps.length }), 'ok');
  if (parsed.errors.length) {
    const linesList = parsed.errors.slice(0, 6).map((e) => e.line).join(', ');
    toast(t('seq.importErrors', { n: parsed.errors.length, lines: linesList }), 'err');
  }
}

/** Coerce an edited input value to the step field type. */
function setField(step, field, el) {
  if (el.type === 'checkbox') step[field] = el.checked;
  else if (el.type === 'number') step[field] = el.value === '' ? '' : Number(el.value);
  else step[field] = el.value;
}

export function initSequences() {
  renderSequences();
  loadLibrary();
  loadFiles().then(renderSteps);

  // Recording (off at every page load): the switch sits next to the Sequences tab, so it can be
  // turned on from any tab.
  $('#seqRecord').checked = false;
  $('#seqRecord').onchange = (e) => {
    setRecording(e.target.checked);
    $('#seqTabGroup').classList.toggle('recording', e.target.checked);
    if (e.target.checked && !ed.name) {
      ed.name = t('seq.untitled');
      $('#seqName').value = ed.name;
    }
    toast(t(e.target.checked ? 'rec.started' : 'rec.stopped'), 'info');
    renderRecBar();
  };
  $('#seqRecordPauses').onchange = (e) => setRecordPauses(e.target.checked);
  window.addEventListener('seqrecord', (e) => {
    appendSteps(e.detail);
    renderRecBar();
  });

  // Upload of a file into the library for the step being edited.
  let uploadIndex = -1;
  $('#libUpload').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    const step = ed.steps[uploadIndex];
    if (!file || !step) return;
    try {
      const stored = await uploadToLibrary(file);
      Object.assign(step, { file: stored.file, name: stored.name });
      await loadFiles();
      markDirty();
      renderSteps();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#seqSteps').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-op="upload"]');
    if (!btn) return;
    uploadIndex = Number(btn.closest('.step').dataset.i);
    $('#libUpload').accept = btn.dataset.kind === 'apk' ? '.apk' : '.mp3,.wav,.ogg,.m4a';
    $('#libUpload').click();
  });

  $('#seqName').oninput = (e) => {
    ed.name = e.target.value;
    markDirty();
  };

  $('#seqSteps').addEventListener('input', (e) => {
    const rowEl = e.target.closest('.step');
    const field = e.target.dataset.field;
    if (!rowEl || !field) return;
    const step = ed.steps[Number(rowEl.dataset.i)];
    if (field === 'file') {
      // Library file picked: keep its original name; an empty value means "no file yet".
      const f = files.find((x) => x.file === e.target.value);
      if (f) Object.assign(step, { file: f.file, name: f.name });
      else if (!e.target.value) {
        delete step.file;
        delete step.name;
      }
      markDirty();
      return renderSteps();
    } else if (field === 'paths') {
      step.paths = e.target.value.split(/[\s,;]+/).filter(Boolean);
    } else if (field === 'volume') {
      step.volume = e.target.value === '' ? null : Number(e.target.value);
    } else if (field === 'mode' || field === 'audio') {
      // These change which popup fields are shown.
      setField(step, field, e.target);
      markDirty();
      return renderSteps();
    } else if (field === 'keyname') {
      if (e.target.value !== 'custom') {
        step.keycode = Number(e.target.value);
        rowEl.querySelector('[data-field="keycode"]').value = step.keycode;
      }
    } else {
      setField(step, field, e.target);
      if (field === 'keycode') {
        const sel = rowEl.querySelector('[data-field="keyname"]');
        sel.value = keyName(step.keycode) in KEYCODES ? String(step.keycode) : 'custom';
      }
    }
    rowEl.classList.remove('invalid');
    markDirty();
  });

  $('#seqSteps').onclick = (e) => {
    const btn = e.target.closest('[data-op]');
    if (!btn || btn.dataset.op === 'upload') return;
    const i = Number(btn.closest('.step').dataset.i);
    const op = btn.dataset.op;
    const s = ed.steps;
    if (op === 'up' && i > 0) [s[i - 1], s[i]] = [s[i], s[i - 1]];
    if (op === 'down' && i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]];
    if (op === 'dup') s.splice(i + 1, 0, structuredClone(s[i]));
    if (op === 'del') s.splice(i, 1);
    markDirty();
    renderSteps();
  };

  // "Add step" menu.
  const menu = $('#seqAddMenu');
  $('#seqAddBtn').onclick = (e) => {
    e.stopPropagation();
    $('#seqLibMenu').hidden = true;
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#seqAddMenu')) menu.hidden = true;
  });
  menu.onclick = (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    menu.hidden = true;
    ed.steps.push({ type: b.dataset.type, ...structuredClone(DEFAULTS[b.dataset.type]) });
    if (!ed.name) ed.name = t('seq.untitled');
    markDirty();
    renderEditor();
    const last = $('#seqSteps').lastElementChild;
    last?.classList.add('flash');
    last?.querySelector('input, select')?.focus();
  };

  // Saved sequences dropdown.
  const libMenu = $('#seqLibMenu');
  $('#seqLibBtn').onclick = (e) => {
    e.stopPropagation();
    menu.hidden = true;
    libMenu.hidden = !libMenu.hidden;
  };
  document.addEventListener('click', (e) => {
    if (!libMenu.hidden && !e.target.closest('#seqLibMenu')) libMenu.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') libMenu.hidden = menu.hidden = true;
  });
  libMenu.onclick = async (e) => {
    const item = e.target.closest('.seq-item');
    if (!item) return;
    libMenu.hidden = true;
    if (item.dataset.id === ed.id || !(await canDiscard())) return;
    open(library.find((s) => s.id === item.dataset.id));
  };

  $('#seqClear').onclick = async () => {
    if (!ed.steps.length) return;
    const ok = await modal({ title: t('seq.clearTitle'), text: t('seq.clearText', { n: ed.steps.length }), okText: t('seq.clearOk'), danger: true });
    if (!ok) return;
    ed.steps = [];
    markDirty();
    renderEditor();
  };

  $('#seqNew').onclick = async () => {
    if (await canDiscard()) open(null);
    $('#seqName').focus();
  };

  $('#seqSave').onclick = save;
  $('#seqExport').onclick = exportCurrent;

  $('#seqDuplicate').onclick = () => {
    if (!ed.steps.length) return;
    ed = { id: null, name: `${ed.name || t('seq.untitled')} ${t('seq.copySuffix')}`, steps: structuredClone(ed.steps), dirty: true };
    markDirty();
    renderEditor();
  };

  $('#seqDelete').onclick = async () => {
    if (!ed.id) return;
    const ok = await confirmDanger({ title: t('seq.deleteTitle'), text: t('seq.deleteText', { name: ed.name }), okText: t('seq.delete') });
    if (!ok) return;
    try {
      await api(`/api/sequences/${encodeURIComponent(ed.id)}`, { method: 'DELETE' });
      open(null);
      await loadLibrary();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('#seqImport').onclick = () => $('#seqImportFile').click();
  $('#seqImportFile').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importFile(file);
  };

  // Run, and stop while running: the run id lets the server interrupt pauses and adb commands.
  $('#seqRun').onclick = async () => {
    const steps = validated();
    if (!steps || running) return;
    const serials = connectedTargets();
    const runId = uid();
    const body = { serials, steps, stopOnError: $('#seqStopOnError').checked, runId };
    running = { runId, stopping: false };
    renderMeta();
    try {
      await run(null, t('seq.runLog', { name: ed.name || t('seq.untitled') }), () =>
        api('/api/actions/sequence', { method: 'POST', body }),
      );
    } finally {
      running = null;
      renderMeta();
    }
  };
  $('#seqStop').onclick = async () => {
    if (!running || running.stopping) return;
    running.stopping = true;
    renderMeta();
    try {
      await api(`/api/actions/sequence/${encodeURIComponent(running.runId)}/stop`, { method: 'POST' });
    } catch (err) {
      // Already finished in the meantime: nothing to stop.
      if (running) running.stopping = false;
      toast(err.message, 'err');
      renderMeta();
    }
  };

  // Ctrl/Cmd+S saves while the sequences tab is open.
  document.addEventListener('keydown', (e) => {
    if (state.tab === 'sequences' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  window.addEventListener('targetschange', renderMeta);
  window.addEventListener('recordchange', () => {
    renderRecBar();
    renderChip();
  });
  window.addEventListener('langchange', () => {
    renderRecBar();
    renderChip();
  });
  window.addEventListener('tabchange', (e) => {
    if (e.detail === 'sequences') $('#seqDirtyDot').hidden = true;
  });
}
