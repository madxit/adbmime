// Sequences ("macros"): library saved on the server, step editor, import/export, execution.
import { icon } from '/assets/icons.js';
import { locale, t } from '/assets/i18n.js';
import {
  KEYCODES, keyName, normalizeSteps, parseSequenceFile, StepError, STEP_TYPES, toText,
} from '/shared/sequence-format.js';
import { $, api, confirmDanger, connectedTargets, esc, modal, run, state, switchTab, toast } from './core.js';

const TYPE_ICON = {
  tap: 'tap', swipe: 'swipe', key: 'key', text: 'text', sleep: 'clock', open: 'open', url: 'globe',
  shell: 'terminal', uninstall: 'trash', hide: 'eyeOff', unhide: 'eye', comment: 'hash',
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
};

const DRAFT_KEY = 'adbmime.seqDraft';
let library = [];
let ed = loadDraft() ?? { id: null, name: '', steps: [], dirty: false };
let invalidIndex = -1;

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
function validated() {
  try {
    return normalizeSteps(ed.steps);
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

function params(s) {
  switch (s.type) {
    case 'tap':
      return `<span class="unit">X</span>${num('x', s.x, 'min="0"')}<span class="unit">Y</span>${num('y', s.y, 'min="0"')}`;
    case 'swipe':
      return `${num('x1', s.x1, 'min="0"')}${num('y1', s.y1, 'min="0"')}<span class="unit">→</span>${num('x2', s.x2, 'min="0"')}${num('y2', s.y2, 'min="0"')}${num('duration', s.duration, 'min="0" max="10000" step="50"')}<span class="unit">ms</span>`;
    case 'key':
      return `${keySelect(s.keycode)}<label class="check"><input type="checkbox" data-field="longpress" ${s.longpress ? 'checked' : ''}>${esc(t('seq.longpress'))}</label>`;
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

function renderSteps() {
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
  const secs = Math.round(estimateSeconds());
  $('#seqMeta').textContent = ed.steps.length
    ? `${t('seq.steps', { n: ed.steps.length })} · ${t('seq.duration', { s: secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s` })}`
    : '';
  $('#seqRunLabel').textContent = t('seq.run', { n: connectedTargets().length });
  $('#seqDelete').disabled = !ed.id;
}

function renderLibrary() {
  $('#seqList').innerHTML = library.length
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
  const steps = validated();
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

  $('#seqName').oninput = (e) => {
    ed.name = e.target.value;
    markDirty();
  };

  $('#seqSteps').addEventListener('input', (e) => {
    const rowEl = e.target.closest('.step');
    const field = e.target.dataset.field;
    if (!rowEl || !field) return;
    const step = ed.steps[Number(rowEl.dataset.i)];
    if (field === 'keyname') {
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
    if (!btn) return;
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

  $('#seqList').onclick = async (e) => {
    const item = e.target.closest('.seq-item');
    if (!item || item.dataset.id === ed.id) return;
    if (!(await canDiscard())) return;
    open(library.find((s) => s.id === item.dataset.id));
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

  $('#seqRun').onclick = (e) => {
    const steps = validated();
    if (!steps) return;
    const serials = connectedTargets();
    const body = { serials, steps, stopOnError: $('#seqStopOnError').checked };
    run(e.currentTarget, t('seq.runLog', { name: ed.name || t('seq.untitled') }), () =>
      api('/api/actions/sequence', { method: 'POST', body }),
    );
  };

  // Ctrl/Cmd+S saves while the sequences tab is open.
  document.addEventListener('keydown', (e) => {
    if (state.tab === 'sequences' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  window.addEventListener('targetschange', renderMeta);
  window.addEventListener('tabchange', (e) => {
    if (e.detail === 'sequences') $('#seqDirtyDot').hidden = true;
  });
}
