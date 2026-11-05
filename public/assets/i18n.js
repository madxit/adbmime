// Client-side translations. Dictionaries live in /assets/i18n/<code>.js and are loaded on demand.
// Markup hooks: data-i18n (text), data-i18n-html (trusted HTML from the dictionary),
// data-i18n-placeholder and data-i18n-title (also sets aria-label).

export const LANGUAGES = [
  { code: 'en', name: 'English', en: 'English', locale: 'en-GB' },
  { code: 'es', name: 'Español', en: 'Spanish', locale: 'es-ES' },
  { code: 'fr', name: 'Français', en: 'French', locale: 'fr-FR' },
  { code: 'it', name: 'Italiano', en: 'Italian', locale: 'it-IT' },
  { code: 'de', name: 'Deutsch', en: 'German', locale: 'de-DE' },
  { code: 'pt', name: 'Português', en: 'Portuguese', locale: 'pt-PT' },
  { code: 'zh', name: '简体中文', en: 'Chinese (Simplified)', locale: 'zh-CN' },
];

const FALLBACK = 'it';
const STORAGE_KEY = 'adbmime.lang';
const dicts = {};
let lang = detect();
let plural = new Intl.PluralRules(locale());

export const flagUrl = (code) => `/assets/flags/${code}.svg`;

function detect() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (LANGUAGES.some((l) => l.code === saved)) return saved;
  for (const pref of navigator.languages ?? [navigator.language]) {
    const code = String(pref).slice(0, 2).toLowerCase();
    if (LANGUAGES.some((l) => l.code === code)) return code;
  }
  return FALLBACK;
}

export const getLang = () => lang;
export function locale() {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'it-IT';
}

async function load(code) {
  if (!dicts[code]) dicts[code] = (await import(`/assets/i18n/${code}.js`)).default;
  return dicts[code];
}

/**
 * Translate a key. When `vars.n` is a number, the plural form `key_one` / `key_other`
 * (Intl.PluralRules categories) is preferred if present.
 */
export function t(key, vars = {}) {
  const d = dicts[lang] ?? {};
  const f = dicts[FALLBACK] ?? {};
  let k = key;
  if (typeof vars.n === 'number') {
    const p = `${key}_${plural.select(vars.n)}`;
    if (p in d || p in f) k = p;
    else if (`${key}_other` in d || `${key}_other` in f) k = `${key}_other`;
  }
  const template = d[k] ?? f[k] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  });
}

function syncDocument() {
  document.documentElement.lang = lang;
  // The server reads this cookie for API messages, popups shown on the boards and TTS.
  document.cookie = `adbmime_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export async function initI18n() {
  await Promise.all([load(FALLBACK), load(lang)]);
  syncDocument();
  applyI18n();
}

export async function setLang(code) {
  if (!LANGUAGES.some((l) => l.code === code)) return;
  await load(code);
  lang = code;
  plural = new Intl.PluralRules(locale());
  localStorage.setItem(STORAGE_KEY, code);
  syncDocument();
  applyI18n();
  window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
}
