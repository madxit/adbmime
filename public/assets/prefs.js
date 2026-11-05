// User preferences stored in the browser (theme, refresh interval, confirmations).
const KEY = 'adbmime.';
const media = matchMedia('(prefers-color-scheme: dark)');

export const THEMES = ['light', 'dark', 'system'];

export const getTheme = () => localStorage.getItem(`${KEY}theme`) || 'system';
export const resolvedTheme = () => document.documentElement.dataset.theme;

function applyTheme() {
  const pref = getTheme();
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
  window.dispatchEvent(new CustomEvent('themechange'));
}

export function setTheme(pref) {
  localStorage.setItem(`${KEY}theme`, THEMES.includes(pref) ? pref : 'system');
  applyTheme();
}

/** Flip between light and dark (leaves "system" mode). */
export const toggleTheme = () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');

media.addEventListener('change', () => getTheme() === 'system' && applyTheme());

/** Generic typed preferences with defaults. */
const DEFAULTS = { refreshSeconds: 3, confirmDestructive: true, showActivity: true };

export function getPref(name) {
  const raw = localStorage.getItem(KEY + name);
  if (raw === null) return DEFAULTS[name];
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULTS[name];
  }
}

export function setPref(name, value) {
  localStorage.setItem(KEY + name, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('prefchange', { detail: { name, value } }));
}
