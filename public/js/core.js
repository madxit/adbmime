// Shared helpers and state for the dashboard modules.
import { icon } from '/assets/icons.js';
import { getLang, locale, t } from '/assets/i18n.js';
import { getPref } from '/assets/prefs.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const ONLINE = ['online', 'connected', 'unauthorized'];

export const state = {
  devices: [],
  selected: new Set(),
  filter: '',
  statusFilter: 'all',
  scan: {},
  meta: null, // last /api/state payload (server info)
  tab: 'apps',
};

export const findDevice = (serial) => state.devices.find((d) => d.serial === serial);

export const deviceName = (d) => d?.name || d?.model || t('device.defaultName');

/** Human label of a board, e.g. "Aula 3B (192.168.1.50)". */
export const label = (serial) => {
  const d = findDevice(serial);
  return d?.name ? `${d.name} (${d.ip ?? serial})` : (d?.ip ?? serial);
};

/** Selected boards that are connected via ADB: the targets of every action. */
export const connectedTargets = () => [...state.selected].filter((s) => findDevice(s)?.status === 'connected');

// ------------------------------------------------------------------ API

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-Lang': getLang() } };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    location.replace('/login');
    throw new Error(t('common.sessionExpired'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || t('common.error', { status: res.status }));
  return data;
}

// ------------------------------------------------------------------ feedback

export function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info')}<div>${esc(message)}</div>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

/**
 * Generic modal. `fields` = [{ id, label, value, placeholder }]. Resolves the values
 * (an empty object when there are no fields) or null when cancelled.
 */
export function modal({ title, text = '', fields = [], okText = t('modal.confirm'), danger = false }) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    $('#modalText').style.display = text ? '' : 'none';
    $('#modalBody').innerHTML = fields
      .map(
        (f) => `<div class="field"><label for="mf_${f.id}">${esc(f.label)}</label>
        <input class="input" id="mf_${f.id}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}" autocomplete="off"></div>`,
      )
      .join('');
    const ok = $('#modalOk');
    ok.textContent = okText;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    const bg = $('#modal');
    bg.classList.add('open');
    (fields.length ? $(`#mf_${fields[0].id}`) : ok).focus();

    const onKey = (e) => e.key === 'Escape' && close(null);
    const close = (result) => {
      bg.classList.remove('open');
      $('#modalForm').onsubmit = null;
      $('#modalCancel').onclick = null;
      bg.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    $('#modalForm').onsubmit = (e) => {
      e.preventDefault();
      close(Object.fromEntries(fields.map((f) => [f.id, $(`#mf_${f.id}`).value])));
    };
    $('#modalCancel').onclick = () => close(null);
    bg.onclick = (e) => e.target === bg && close(null);
    document.addEventListener('keydown', onKey);
  });
}

/** Ask confirmation for destructive actions, unless disabled in the settings. */
export const confirmDanger = (opts) =>
  getPref('confirmDestructive') ? modal({ ...opts, danger: true }) : Promise.resolve({});

// ------------------------------------------------------------------ activity log

function renderEmptyLog() {
  $('#log').innerHTML = `<div class="empty"><div class="big">${icon('activity')}</div><div>${esc(t('log.empty'))}</div></div>`;
}

export function clearLog() {
  renderEmptyLog();
}

export function addLog(title, data) {
  $('#log .empty')?.remove();
  const item = document.createElement('div');
  item.className = 'log-item';
  const time = new Date().toLocaleTimeString(locale());
  const kind = data.error || (!data.ok && data.failed) ? 'ko' : data.failed ? 'mixed' : 'ok';
  const rows = (data.results ?? [])
    .map(
      (r) => `<div class="res"><b><i class="sdot" style="background:var(--${r.ok ? 'green' : 'red'})"></i>${esc(label(r.serial))}</b>
      <pre>${esc(r.output || (r.ok ? t('log.okDefault') : t('log.errDefault')))}</pre></div>`,
    )
    .join('');
  item.innerHTML = `<div class="log-head">
      <span class="log-icon ${kind}">${icon(kind === 'ok' ? 'check' : kind === 'ko' ? 'x' : 'alert')}</span>
      <span class="log-title"><span class="t">${esc(title)}</span>
        <span class="meta">
          <span>${time}</span>
          ${data.ok ? `<span class="ok">${esc(t('log.ok', { n: data.ok }))}</span>` : ''}
          ${data.failed ? `<span class="ko">${esc(t('log.failed', { n: data.failed }))}</span>` : ''}
          ${data.error ? `<span class="ko">${esc(data.error)}</span>` : ''}
        </span>
      </span>
    </div><div class="log-body">${rows}</div>`;
  if (data.failed) item.classList.add('open');
  item.querySelector('.log-head').onclick = () => item.classList.toggle('open');
  $('#log').prepend(item);
  if (!$('#workspace').classList.contains('with-log')) $('#logDot').hidden = false;
}

// ------------------------------------------------------------------ actions runner

let refreshHook = async () => {};
export const setRefreshHook = (fn) => (refreshHook = fn);
export const refresh = () => refreshHook();

/** Run an action with a busy button, log its per-board results and refresh the state. */
export async function run(button, title, fn) {
  const original = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(t('run.busy'))}`;
  }
  try {
    const data = await fn();
    addLog(title, data);
    if (data.failed) toast(t('run.partial', { title, ok: data.ok, failed: data.failed }), data.ok ? 'info' : 'err');
    else toast(t('run.done', { title, n: data.ok }), 'ok');
    return data;
  } catch (err) {
    addLog(title, { error: err.message });
    toast(err.message, 'err');
    return null;
  } finally {
    if (button) {
      button.innerHTML = original;
      button.disabled = false;
    }
    await refresh();
  }
}

/** Busy state for a button around an async function (no logging). */
export async function busy(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
}

export function switchTab(name) {
  state.tab = name;
  $$('.tab[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  $('#targetBar').hidden = name === 'screen';
  window.dispatchEvent(new CustomEvent('tabchange', { detail: name }));
}
