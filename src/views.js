// Server-rendered page displayed full screen on the boards for "screen" messages.
import { t } from './i18n.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const THEMES = {
  info: { from: '#1e3a8a', to: '#2563eb', accent: '#bfdbfe', label: 'popupInfo' },
  warning: { from: '#78350f', to: '#d97706', accent: '#fde68a', label: 'popupWarning' },
  urgent: { from: '#7f1d1d', to: '#dc2626', accent: '#fecaca', label: 'popupUrgent' },
};

export function renderMessagePage({ title, text, level, lang = 'it', createdAt }) {
  const theme = THEMES[level] ?? THEMES.info;
  const label = t(theme.label, {}, lang);
  const time = new Date(createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #fff; display: grid; place-items: center; padding: 4vmin;
    background: radial-gradient(1200px 800px at 15% 10%, ${theme.to}, transparent 60%),
                linear-gradient(135deg, ${theme.from}, #0b1020);
  }
  .card {
    width: min(1400px, 100%); padding: 6vmin 7vmin; border-radius: 4vmin;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.18);
    box-shadow: 0 30px 80px rgba(0,0,0,.35); backdrop-filter: blur(20px);
    animation: pop .6s cubic-bezier(.2,.9,.3,1.2);
  }
  .tag { display: inline-flex; gap: 1.2vmin; align-items: center; font-weight: 700; letter-spacing: .12em;
         text-transform: uppercase; font-size: 2.2vmin; color: ${theme.accent}; }
  .dot { width: 1.6vmin; height: 1.6vmin; border-radius: 50%; background: ${theme.accent};
         box-shadow: 0 0 0 0 ${theme.accent}; animation: pulse 1.8s infinite; }
  h1 { font-size: clamp(32px, 7vmin, 120px); line-height: 1.05; margin: 2.5vmin 0 3vmin; font-weight: 800; }
  p { font-size: clamp(24px, 4.6vmin, 80px); line-height: 1.3; white-space: pre-wrap; opacity: .95; }
  footer { margin-top: 5vmin; font-size: 2vmin; opacity: .6; }
  @keyframes pop { from { transform: scale(.92); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes pulse { 70% { box-shadow: 0 0 0 2.4vmin transparent } 100% { box-shadow: 0 0 0 0 transparent } }
</style>
</head>
<body>
  <main class="card">
    <span class="tag"><span class="dot"></span>${escapeHtml(label)}</span>
    ${title ? `<h1>${escapeHtml(title)}</h1>` : '<div style="height:3vmin"></div>'}
    <p>${escapeHtml(text)}</p>
    <footer>${escapeHtml(t('popupSentAt', { time }, lang))}</footer>
  </main>
</body>
</html>`;
}
