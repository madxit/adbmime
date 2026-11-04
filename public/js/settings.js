// Settings drawer: language, theme, interface preferences and server information.
import { icon } from '/assets/icons.js';
import { flagUrl, getLang, LANGUAGES, setLang, t } from '/assets/i18n.js';
import { getPref, getTheme, resolvedTheme, setPref, setTheme, toggleTheme } from '/assets/prefs.js';
import { $, esc, state } from './core.js';
import { dropdown } from './dropdown.js';

const THEMES = [
  { value: 'light', key: 'settings.themeLight', icon: 'sun' },
  { value: 'dark', key: 'settings.themeDark', icon: 'moon' },
  { value: 'system', key: 'settings.themeSystem', icon: 'monitor' },
];

let langDd;
let themeDd;

/** Dropdowns of the drawer: language (flags) and theme (symbols). */
function initDropdowns() {
  langDd = dropdown($('#langDd'), {
    options: () =>
      LANGUAGES.map((l) => ({
        value: l.code,
        label: l.name,
        sub: l.en !== l.name ? l.en : '', // no repetition for English
        icon: `<img src="${flagUrl(l.code)}" alt="" width="20" height="20">`,
      })),
    value: getLang,
    onChange: async (code) => {
      await setLang(code);
      renderServerInfo();
    },
  });
  themeDd = dropdown($('#themeDd'), {
    options: () => THEMES.map((th) => ({ value: th.value, label: t(th.key), icon: icon(th.icon) })),
    value: getTheme,
    onChange: (v) => setTheme(v),
  });
  window.addEventListener('langchange', () => {
    langDd.render();
    themeDd.render();
  });
}

function renderThemes() {
  themeDd?.render();
  const dark = resolvedTheme() === 'dark';
  $('#themeToggle').innerHTML = icon(dark ? 'sun' : 'moon');
}

export function renderServerInfo() {
  const m = state.meta;
  if (!m) return;
  const rows = [
    ['settings.version', m.version],
    ['settings.commit', m.commit ? `${m.commit}${m.dirty ? ` (${t('settings.dirty')})` : ''}` : '—'],
    ['settings.adb', m.adb.ok ? `v${m.adb.version}` : m.adb.error || '—'],
    ['settings.adbPort', m.adbPort],
    ['settings.networks', m.scan.subnets?.join(', ') || '—'],
    ['settings.interfaces', m.interfaces.map((i) => `${i.address}/${i.prefix} (${i.name})`).join(', ') || '—'],
    ['settings.roots', m.clearAllowedRoots.join(', ')],
  ];
  $('#serverInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>`).join('');
}

export function openSettings() {
  langDd.render();
  renderThemes();
  renderServerInfo();
  $('#settings').classList.add('open');
  $('#closeSettings').focus();
}

const closeSettings = () => $('#settings').classList.remove('open');

export function initSettings() {
  initDropdowns();
  renderThemes();
  $('#openSettings').onclick = openSettings;
  $('#closeSettings').onclick = closeSettings;
  // Block body: returning false from onclick would cancel every click inside the drawer.
  $('#settings').onclick = (e) => {
    if (e.target.id === 'settings') closeSettings();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#settings').classList.contains('open') && !$('#modal').classList.contains('open')) closeSettings();
  });

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
