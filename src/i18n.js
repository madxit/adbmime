// Server-side translations. The language of the current request is kept in an
// AsyncLocalStorage, so deep helpers (actions, adb wrapper...) can call `t()`
// without receiving the request object.
import { AsyncLocalStorage } from 'node:async_hooks';
import { MESSAGES } from './locales.js';

export const LANGS = ['en', 'es', 'fr', 'it', 'de', 'pt', 'zh'];
export const DEFAULT_LANG = 'it';
export const LANG_COOKIE = 'adbmime_lang';

const store = new AsyncLocalStorage();

const normalize = (value) => {
  const code = String(value ?? '').trim().toLowerCase().slice(0, 2);
  return LANGS.includes(code) ? code : null;
};

/** Language of a request: X-Lang header, then cookie, then Accept-Language. */
export function resolveLang(req) {
  const header = normalize(req.headers['x-lang']);
  if (header) return header;
  const cookie = /(?:^|;\s*)adbmime_lang=([a-z]{2})/i.exec(req.headers.cookie ?? '')?.[1];
  if (normalize(cookie)) return normalize(cookie);
  for (const part of String(req.headers['accept-language'] ?? '').split(',')) {
    const code = normalize(part);
    if (code) return code;
  }
  return DEFAULT_LANG;
}

export const currentLang = () => store.getStore()?.lang ?? DEFAULT_LANG;

/** Translate `key`, replacing {placeholders} with `vars`. Falls back to Italian, then the key. */
export function t(key, vars = {}, lang = currentLang()) {
  const template = MESSAGES[lang]?.[key] ?? MESSAGES[DEFAULT_LANG][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Express middleware: binds the request language for the rest of the request. */
export function i18nMiddleware(req, _res, next) {
  req.lang = resolveLang(req);
  store.run({ lang: req.lang }, next);
}

/**
 * Re-enter the language context. Needed after multer: it calls `next()` from stream
 * events, which run outside the async context created by `i18nMiddleware`.
 */
export function rebindLang(req, _res, next) {
  store.run({ lang: req.lang ?? DEFAULT_LANG }, next);
}
