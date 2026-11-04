// AdbMime dashboard entry point (vanilla ES modules, no build step).
import { hydrateIcons } from '/assets/icons.js';
import { initI18n, t } from '/assets/i18n.js';
import { getPref, setPref } from '/assets/prefs.js';
import { initActions, renderActionsMeta } from './actions.js';
import { $, api, clearLog, setRefreshHook, state, switchTab } from './core.js';
import { initDevices, invalidateDevices, renderDevices, renderScan, setOpenScreenHandler } from './devices.js';
import { initScreen, invalidateScreenDevices, openScreen, renderScreenDevices } from './screen.js';
import { initSequences, renderSequences } from './sequences.js';
import { initSettings, renderServerInfo } from './settings.js';

function renderMeta(data) {
  const pill = $('#adbPill');
  pill.className = `pill ${data.adb.ok ? 'ok' : data.adb.error ? 'err' : ''}`;
  $('.pill-text', pill).textContent = data.adb.ok
    ? t('adb.ok', { v: data.adb.version })
    : data.adb.error
      ? t('adb.missing')
      : t('adb.checking');
  pill.title = data.adb.ok ? t('adb.okTitle') : data.adb.error || '';
  const user = data.user || t('topbar.guest');
  $('#userName').textContent = user;
  $('#avatar').textContent = user.slice(0, 1);
  renderActionsMeta(data);
}

async function refresh() {
  try {
    const data = await api('/api/state');
    state.devices = data.devices;
    state.meta = data;
    renderMeta(data);
    renderScan(data.scan);
    renderDevices();
    renderScreenDevices();
    if ($('#settings').classList.contains('open')) renderServerInfo();
  } catch (err) {
    console.warn(err);
  }
}

let pollTimer;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => !document.hidden && refresh(), getPref('refreshSeconds') * 1000);
}

function applyActivityVisibility() {
  const on = getPref('showActivity');
  $('#workspace').classList.toggle('with-log', on);
  $('#toggleLog').classList.toggle('active', on);
  if (on) $('#logDot').hidden = true;
}

async function boot() {
  hydrateIcons();
  await initI18n();
  setRefreshHook(refresh);

  initSettings();
  initDevices({ refresh });
  initActions();
  initSequences();
  initScreen();
  setOpenScreenHandler(openScreen);
  clearLog();
  applyActivityVisibility();

  $('#tabs').onclick = (e) => {
    const tab = e.target.closest('.tab[data-tab]');
    if (tab) switchTab(tab.dataset.tab);
  };
  $('#toggleLog').onclick = () => setPref('showActivity', !getPref('showActivity'));
  $('#clearLog').onclick = clearLog;
  $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login');
  };

  window.addEventListener('prefchange', (e) => {
    if (e.detail.name === 'refreshSeconds') startPolling();
    if (e.detail.name === 'showActivity') applyActivityVisibility();
  });
  window.addEventListener('langchange', () => {
    // Re-render everything built from JS strings.
    invalidateDevices();
    invalidateScreenDevices();
    renderSequences();
    if (state.meta) {
      renderMeta(state.meta);
      renderScan(state.meta.scan);
    }
    if (!$('#log .log-item')) clearLog();
  });

  switchTab('apps');
  await refresh();
  document.body.classList.remove('booting');
  startPolling();
}

boot();
