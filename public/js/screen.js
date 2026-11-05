// Remote screen: shows the screenshot of one board and forwards taps, swipes, keys and text.
// Inputs are recorded into the open sequence when recording is on (see recorder.js).
import { icon } from '/assets/icons.js';
import { t } from '/assets/i18n.js';
import { KEYCODES } from '/shared/sequence-format.js';
import { $, $$, api, deviceName, esc, findDevice, state, switchTab, toast } from './core.js';
import { record } from './recorder.js';

const scr = {
  serial: '',
  loading: false,
  timer: null,
  url: null, // object URL of the current frame
  size: null, // { w, h } of the device screen (= screenshot size)
  failures: 0,
  textBuffer: '',
  textTimer: null,
};

const BROWSER_KEYS = {
  Enter: KEYCODES.ENTER,
  Backspace: KEYCODES.DEL,
  Delete: KEYCODES.FORWARD_DEL,
  Tab: KEYCODES.TAB,
  Escape: KEYCODES.BACK,
  ArrowUp: KEYCODES.DPAD_UP,
  ArrowDown: KEYCODES.DPAD_DOWN,
  ArrowLeft: KEYCODES.DPAD_LEFT,
  ArrowRight: KEYCODES.DPAD_RIGHT,
  Home: KEYCODES.MOVE_HOME,
  End: KEYCODES.MOVE_END,
  PageUp: KEYCODES.PAGE_UP,
  PageDown: KEYCODES.PAGE_DOWN,
};

const active = () => state.tab === 'screen' && !document.hidden;
const live = () => $('#scrLive').checked;

// ------------------------------------------------------------------ device picker

let lastOptions = '';

export function renderScreenDevices() {
  const connected = state.devices.filter((d) => d.status === 'connected');
  if (scr.serial && !connected.some((d) => d.serial === scr.serial)) setDevice('');
  if (!scr.serial && connected.length) {
    // Prefer a selected board, then the first connected one.
    const pick = connected.find((d) => state.selected.has(d.serial)) ?? connected[0];
    setDevice(pick.serial, false);
  }
  const html = connected.length
    ? connected
        .map((d) => `<option value="${esc(d.serial)}" ${d.serial === scr.serial ? 'selected' : ''}>${esc(deviceName(d))} · ${esc(d.ip ?? d.serial)}</option>`)
        .join('')
    : `<option value="">${esc(t('screen.noDevice'))}</option>`;
  if (html !== lastOptions) {
    $('#scrDevice').innerHTML = html;
    lastOptions = html;
  }
  $('#scrDevice').value = scr.serial;
  const disabled = !scr.serial;
  for (const id of ['#scrRefresh', '#scrDownload', '#scrLive']) $(id).disabled = disabled;
  $$('#scrKeys .btn, .navbar .btn').forEach((b) => (b.disabled = disabled));
}

export const invalidateScreenDevices = () => {
  lastOptions = '';
  renderScreenDevices();
};

function setDevice(serial, load = true) {
  if (serial === scr.serial) return;
  scr.serial = serial;
  scr.size = null;
  scr.failures = 0;
  clearTimeout(scr.timer);
  if (scr.url) URL.revokeObjectURL(scr.url);
  scr.url = null;
  $('#scrImg').removeAttribute('src');
  $('#scrFrame').hidden = true;
  $('#scrEmpty').hidden = false;
  $('#scrInfo').textContent = '';
  if (serial && load && active()) loadFrame();
}

/** Open the screen tab on a specific board (from the boards list). */
export function openScreen(serial) {
  switchTab('screen');
  setDevice(serial);
  invalidateScreenDevices();
  if (!scr.loading) loadFrame();
  $('#scrStage').focus();
}

// ------------------------------------------------------------------ frames

function schedule(ms) {
  clearTimeout(scr.timer);
  scr.timer = setTimeout(loadFrame, ms);
}

async function loadFrame() {
  clearTimeout(scr.timer);
  const serial = scr.serial;
  if (!serial || scr.loading || !active()) return;
  scr.loading = true;
  $('#scrFrame').classList.add('loading');
  const started = performance.now();
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(serial)}/screen?ts=${Date.now()}`);
    if (res.status === 401) return location.replace('/login');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('screen.error'));
    const blob = await res.blob();
    if (serial !== scr.serial) return;
    const url = URL.createObjectURL(blob);
    const img = $('#scrImg');
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    if (scr.url) URL.revokeObjectURL(scr.url);
    scr.url = url;
    scr.size = { w: img.naturalWidth, h: img.naturalHeight };
    scr.failures = 0;
    $('#scrFx').setAttribute('viewBox', `0 0 ${scr.size.w} ${scr.size.h}`);
    $('#scrFrame').hidden = false;
    $('#scrEmpty').hidden = true;
    $('#scrInfo').textContent = `${scr.size.w}×${scr.size.h} · ${Math.round(performance.now() - started)} ms`;
  } catch (err) {
    scr.failures++;
    // Avoid flooding the user with toasts while in live mode.
    if (scr.failures === 1) toast(err.message || t('screen.error'), 'err');
    if (scr.failures >= 3) $('#scrLive').checked = false;
  } finally {
    scr.loading = false;
    $('#scrFrame').classList.remove('loading');
    if (serial !== scr.serial) loadFrame(); // the board changed meanwhile
    else if (live()) schedule(Number($('#scrInterval').value));
  }
}

/** Refresh soon after an input, so the user sees its effect. */
function refreshAfterInput() {
  if (live()) return;
  setTimeout(loadFrame, 350);
  setTimeout(loadFrame, 1300);
}

// ------------------------------------------------------------------ input

function fx(step) {
  const svg = $('#scrFx');
  if (!scr.size) return;
  const r = Math.max(scr.size.w, scr.size.h) * 0.018;
  let el;
  if (step.type === 'tap' || (step.type === 'swipe' && step.x1 === step.x2 && step.y1 === step.y2)) {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    Object.entries({ cx: step.x ?? step.x1, cy: step.y ?? step.y1, r: step.type === 'tap' ? r : r * 1.6, class: 'ripple' }).forEach(([k, v]) => el.setAttribute(k, v));
  } else if (step.type === 'swipe') {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    Object.entries({ x1: step.x1, y1: step.y1, x2: step.x2, y2: step.y2, class: 'trail' }).forEach(([k, v]) => el.setAttribute(k, v));
    el.style.strokeWidth = r / 2;
  }
  if (el) {
    svg.append(el);
    setTimeout(() => el.remove(), 700);
  }
}

async function send(step) {
  if (!scr.serial) return;
  fx(step);
  record(step);
  try {
    await api(`/api/devices/${encodeURIComponent(scr.serial)}/input`, { method: 'POST', body: step });
  } catch (err) {
    toast(err.message, 'err');
  }
  refreshAfterInput();
}

/** Convert a pointer position to device coordinates. */
function toDevice(e) {
  const rect = $('#scrImg').getBoundingClientRect();
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v)));
  return {
    x: clamp(((e.clientX - rect.left) / rect.width) * scr.size.w, scr.size.w),
    y: clamp(((e.clientY - rect.top) / rect.height) * scr.size.h, scr.size.h),
  };
}

function flushText() {
  clearTimeout(scr.textTimer);
  if (!scr.textBuffer) return;
  const text = scr.textBuffer;
  scr.textBuffer = '';
  send({ type: 'text', text });
}

function initPointer() {
  const img = $('#scrImg');
  let start = null;
  img.addEventListener('pointerdown', (e) => {
    if (!scr.size || e.button !== 0) return;
    e.preventDefault();
    img.setPointerCapture(e.pointerId);
    $('#scrStage').focus({ preventScroll: true });
    start = { ...toDevice(e), cx: e.clientX, cy: e.clientY, t: performance.now() };
  });
  img.addEventListener('pointerup', (e) => {
    if (!start) return;
    flushText();
    const end = toDevice(e);
    const held = Math.round(performance.now() - start.t);
    const moved = Math.hypot(e.clientX - start.cx, e.clientY - start.cy);
    if (moved < 8) {
      // A long hold becomes a "swipe" on the same point, i.e. a long press.
      if (held >= 500) send({ type: 'swipe', x1: start.x, y1: start.y, x2: start.x, y2: start.y, duration: Math.min(held, 3000) });
      else send({ type: 'tap', x: start.x, y: start.y });
    } else {
      send({ type: 'swipe', x1: start.x, y1: start.y, x2: end.x, y2: end.y, duration: Math.max(80, Math.min(held, 3000)) });
    }
    start = null;
  });
  img.addEventListener('pointercancel', () => (start = null));
  img.addEventListener('contextmenu', (e) => e.preventDefault());
}

function initKeyboard() {
  $('#scrStage').addEventListener('keydown', (e) => {
    if (!scr.serial || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = BROWSER_KEYS[e.key];
    if (code !== undefined) {
      e.preventDefault();
      flushText();
      send({ type: 'key', keycode: code, longpress: false });
    } else if (e.key.length === 1) {
      e.preventDefault();
      if (!/^[\x20-\x7e]$/.test(e.key)) return toast(t('seq_ascii'), 'err');
      // Characters are batched into a single `input text` call.
      scr.textBuffer += e.key;
      clearTimeout(scr.textTimer);
      scr.textTimer = setTimeout(flushText, 400);
    }
  });
  $('#scrStage').addEventListener('blur', flushText);
}

// ------------------------------------------------------------------ init

export function initScreen() {
  initPointer();
  initKeyboard();

  $('#scrDevice').onchange = (e) => setDevice(e.target.value);
  $('#scrRefresh').onclick = () => loadFrame();
  $('#scrLive').onchange = () => {
    if (live()) loadFrame();
  };
  $('#scrInterval').onchange = () => {
    if (live()) schedule(Number($('#scrInterval').value));
  };

  const onKey = (e) => {
    const b = e.target.closest('[data-key]');
    if (b) send({ type: 'key', keycode: Number(b.dataset.key), longpress: false });
  };
  $('#scrKeys').addEventListener('click', onKey);
  $('.navbar').addEventListener('click', onKey);

  $('#scrTextForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#scrText').value;
    if (!text) return;
    if (!/^[\x20-\x7e]+$/.test(text)) return toast(t('seq_ascii'), 'err');
    send({ type: 'text', text });
    $('#scrText').value = '';
  };

  $('#scrDownload').onclick = () => {
    if (!scr.url) return;
    const d = findDevice(scr.serial);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const a = Object.assign(document.createElement('a'), {
      href: scr.url,
      download: `screen-${(d?.name || d?.ip || 'device').replace(/[^\w.-]+/g, '_')}-${stamp}.png`,
    });
    a.click();
  };

  const setExpandIcon = () => {
    const on = document.body.classList.contains('screen-focus');
    const btn = $('#scrExpand');
    btn.innerHTML = icon(on ? 'minimize' : 'maximize');
    btn.title = t(on ? 'screen.collapse' : 'screen.expand');
  };
  $('#scrExpand').onclick = () => {
    document.body.classList.toggle('screen-focus');
    setExpandIcon();
  };

  window.addEventListener('tabchange', (e) => {
    if (e.detail === 'screen') {
      renderScreenDevices();
      loadFrame();
    } else {
      clearTimeout(scr.timer);
      document.body.classList.remove('screen-focus');
      setExpandIcon();
    }
  });
  document.addEventListener('visibilitychange', () => !document.hidden && live() && loadFrame());
  window.addEventListener('langchange', () => {
    setExpandIcon();
    invalidateScreenDevices();
  });
}
