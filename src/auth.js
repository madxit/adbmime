// Minimal stateless authentication: credentials from .env, session kept in an HMAC-signed cookie.
import crypto from 'node:crypto';
import { config } from './config.js';
import { t } from './i18n.js';

const COOKIE = 'adbmime_session';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
// Constant-time comparison that also works for strings of different length.
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

const sign = (payload) =>
  crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function checkCredentials(username, password) {
  // Evaluate both comparisons to avoid leaking which one failed.
  const userOk = safeEqual(username ?? '', config.authUsername);
  const passOk = safeEqual(password ?? '', config.authPassword);
  return userOk && passOk;
}

function createToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + config.sessionTtlMs }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSession(req) {
  return readToken(parseCookies(req.headers.cookie)[COOKIE]);
}

export function setSessionCookie(res, username) {
  res.cookie(COOKIE, createToken(username), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionTtlMs,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Protects API routes (401) and pages (redirect to the login page). */
export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (session) {
    req.user = session.u;
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: t('unauthenticated') });
  return res.redirect('/login');
}
