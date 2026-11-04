// Settings drawer: language, theme, interface preferences and server information.
import { icon } from '/assets/icons.js';
import { flagUrl, getLang, LANGUAGES, setLang, t } from '/assets/i18n.js';
import { getPref, getTheme, resolvedTheme, setPref, setTheme, toggleTheme } from '/assets/prefs.js';
import { $, $$, esc, state } from './core.js';

function renderLangs() {
  $('#langGrid').innerHTML = LANGUAGES.map(
    (l) => `<button class="lang-btn ${l.code === getLang() ? 'active' : ''}" data-lang="${l.code}" lang="${l.code}">
      <img src="${flagUrl(l.code)}" alt="" width="22" height="22">
      <span><b>${esc(l.name)}</b><small>${esc(l.en)}</small></span>
    </button>`,
  ).join('');
}

function renderThemes() {
  $$('[data-theme-pick]').forEach((b) => b.classList.toggle('active', b.dataset.themePick === getTheme()));
  const dark = resolvedTheme() === 'dark';
  $('#themeToggle').innerHTML = icon(dark ? 'sun' : 'moon');
}

export function renderServerInfo() {
  const m = state.meta;
  if (!m) return;
  const rows = [
    ['settings.version', m.version],
    ['settings.adb', m.adb.ok ? `v${m.adb.version}` : m.adb.error || '—'],
    ['settings.adbPort', m.adbPort],
    ['settings.networks', m.scan.subnets?.join(', ') || '—'],
    ['settings.interfaces', m.interfaces.map((i) => `${i.address}/${i.prefix} (${i.name})`).join(', ') || '—'],
    ['settings.roots', m.clearAllowedRoots.join(', ')],
  ];
  $('#serverInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>`).join('');
}

export function openSettings() {
  renderLangs();
  renderThemes();
  renderServerInfo();
  $('#settings').classList.add('open');
  $('#closeSettings').focus();
}

const closeSettings = () => $('#settings').classList.remove('open');

export function initSettings() {
  renderThemes();
  $('#openSettings').onclick = openSettings;
  $('#closeSettings').onclick = closeSettings;
  $('#settings').onclick = (e) => e.target.id === 'settings' && closeSettings();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#settings').classList.contains('open') && !$('#modal').classList.contains('open')) closeSettings();
  });

  $('#langGrid').onclick = async (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    await setLang(b.dataset.lang);
    renderLangs();
    renderServerInfo();
  };

  $('#themeGrid').onclick = (e) => {
    const b = e.target.closest('[data-theme-pick]');
    if (b) setTheme(b.dataset.themePick);
  };
  $('#themeToggle').onclick = toggleTheme;
  window.addEventListener('themechange', renderThemes);

  const refreshSel = $('#setRefresh');
  refreshSel.value = String(getPref('refreshSeconds'));
  refreshSel.onchange = () => setPref('refreshSeconds', Number(refreshSel.value));

  const confirm = $('#setConfirm');
  confirm.checked = getPref('confirmDestructive');
  confirm.onchange = () => setPref('confirmDestructive', confirm.checked);

  const activity = $('#setActivity');
  activity.checked = getPref('showActivity');
  activity.onchange = () => setPref('showActivity', activity.checked);
  window.addEventListener('prefchange', (e) => {
    if (e.detail.name === 'showActivity') activity.checked = e.detail.value;
  });
}
