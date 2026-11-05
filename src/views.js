// Server-rendered page displayed full screen on the boards for "screen" popups. Audio popups play
// in the page itself (no "open with" app chooser on the board): see audioScript.
import { t } from './i18n.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const THEMES = {
  info: { from: '#1e3a8a', to: '#2563eb', accent: '#bfdbfe', label: 'popupInfo' },
  warning: { from: '#78350f', to: '#d97706', accent: '#fde68a', label: 'popupWarning' },
  urgent: { from: '#7f1d1d', to: '#dc2626', accent: '#fecaca', label: 'popupUrgent' },
};

// Equalizer + replay button shown in audio popups.
const audioBlock = (lang) => `
    <div class="audio">
      <span class="eq"><i></i><i></i><i></i><i></i><i></i></span>
      <span>${escapeHtml(t('popupAudio', {}, lang))}</span>
      <button id="again" type="button" hidden>&#8635; ${escapeHtml(t('popupReplay', {}, lang))}</button>
    </div>
    <audio id="au" preload="auto"></audio>`;

// BCP 47 tags for the browser speech engine.
const SPEECH_LANG = { it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', zh: 'zh-CN' };

/**
 * Audio player of the popup page (kept ES5 for old board browsers).
 *  - speech: the text is spoken by the board browser itself (Web Speech API), so it can be replayed
 *    even when this server is no longer reachable. If the browser has no speech engine or no voice
 *    for the language, it falls back to audio synthesised by the server (`/m/:id/speech`);
 *  - files are downloaded once into a Blob, so replays also work offline.
 * Browsers block sound that starts without a user gesture: the page then shows a "tap to listen"
 * overlay and asks the server to tap the board (POST /m/:id/play); any touch starts playback.
 */
const audioScript = (cfg) => `
<script id="cfg" type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var au = document.getElementById('au'), tap = document.getElementById('tap'), again = document.getElementById('again');
  var synth = window.speechSynthesis, Utt = window.SpeechSynthesisUtterance;
  var mode = cfg.speech && synth && Utt ? 'speech' : 'audio';
  var started = false, blocked = false, asks = 0, watchdog = null, keep = [], loaded = false;

  // The server taps blindly: only ask while this page is really in front of the user, otherwise
  // the tap could land in another app. Hidden pages ask again when they become visible.
  function inFront() { return document.visibilityState !== 'hidden' && (!document.hasFocus || document.hasFocus()); }
  function ask() {
    if (started) return;
    tap.hidden = false;
    if (asks >= 2 || !inFront()) return;
    asks++;
    if (window.fetch) fetch(location.pathname + '/play' + location.search, { method: 'POST' }).catch(function () {});
    setTimeout(ask, 5000);
  }
  document.addEventListener('visibilitychange', function () { if (!started && !tap.hidden && inFront()) ask(); });
  function onStart() { clearTimeout(watchdog); started = true; tap.hidden = true; again.hidden = true; document.body.classList.add('playing'); }
  function onEnd() { document.body.classList.remove('playing'); again.hidden = false; }

  // ---- browser speech engine
  function chunks(text) {
    // Some engines stop on long utterances: speak sentence by sentence (max ~200 chars).
    var parts = text.match(/[^.!?\u3002\uff01\uff1f\\n]+[.!?\u3002\uff01\uff1f]*/g) || [text], out = [], cur = '';
    parts.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      if ((cur + ' ' + p).length > 200 && cur) { out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p;
    });
    if (cur) out.push(cur);
    return out;
  }
  function voice() {
    var list = synth.getVoices() || [], base = cfg.lang.split('-')[0], best = null;
    for (var i = 0; i < list.length; i++) {
      var l = (list[i].lang || '').replace('_', '-');
      if (l === cfg.lang) return list[i];
      if (!best && l.split('-')[0] === base) best = list[i];
    }
    if (!best && list.length) return false; // voices known, none for this language
    return best;
  }
  function speak() {
    var v = voice();
    if (v === false) return fallback();
    synth.cancel();
    blocked = false;
    // No start and no error: the engine is missing or broken. (Errors may fire synchronously.)
    clearTimeout(watchdog);
    watchdog = setTimeout(function () { if (!started && !blocked) fallback(); }, 6000);
    keep = chunks(cfg.speech).map(function (part, i, all) {
      var u = new Utt(part);
      u.lang = cfg.lang;
      if (v) u.voice = v;
      if (i === 0) u.onstart = onStart;
      if (i === all.length - 1) u.onend = onEnd;
      u.onerror = function (e) {
        if (e.error === 'not-allowed') { blocked = true; clearTimeout(watchdog); ask(); }
        else if (e.error !== 'interrupted' && e.error !== 'canceled') fallback();
      };
      return u;
    });
    keep.forEach(function (u) { synth.speak(u); });
  }
  function fallback() {
    if (mode === 'audio') return;
    clearTimeout(watchdog);
    if (synth) synth.cancel();
    mode = 'audio';
    load(play);
  }

  // ---- audio element (files, or speech synthesised by the server)
  function load(then) {
    var url = cfg.speech ? location.pathname + '/speech' : cfg.src;
    function direct() { au.src = url; loaded = true; then(); }
    if (!window.fetch || !window.URL || !URL.createObjectURL) return direct();
    fetch(url).then(function (r) { if (!r.ok) throw r; return r.blob(); })
      .then(function (b) { au.src = URL.createObjectURL(b); loaded = true; then(); })
      .catch(direct);
  }
  function playAudio(fromStart) {
    if (fromStart) au.currentTime = 0;
    var p = au.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') ask(); });
  }
  au.addEventListener('play', onStart);
  au.addEventListener('pause', function () { document.body.classList.remove('playing'); });
  au.addEventListener('ended', onEnd);

  function play(fromStart) {
    if (mode === 'speech') return speak();
    if (!loaded) return load(function () { playAudio(fromStart); });
    playAudio(fromStart);
  }
  ['touchend', 'click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (!started) play(false); });
  });
  again.addEventListener('click', function (e) { e.stopPropagation(); play(true); });
  // Voices may load asynchronously: give them a moment before the first attempt.
  if (mode === 'speech' && !(synth.getVoices() || []).length && 'onvoiceschanged' in synth) {
    var go = function () { if (!started && !go.done) { go.done = true; play(false); } };
    synth.onvoiceschanged = go;
    setTimeout(go, 1000);
  } else play(false);
})();
</script>`;

export function renderMessagePage({ title, text, level, lang = 'it', createdAt, audioFile, speech }) {
  const hasAudio = Boolean(audioFile || speech);
  const cfg = { lang: SPEECH_LANG[lang] ?? 'it-IT', speech: speech || '', src: audioFile ? `/media/${encodeURIComponent(audioFile)}` : '' };
  const theme = THEMES[level] ?? THEMES.info;
  const label = t(theme.label, {}, lang);
  const time = new Date(createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || label)}</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
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
  .audio { display: flex; align-items: center; gap: 2.4vmin; margin-top: 4vmin; font-size: clamp(18px, 3vmin, 48px);
           font-weight: 600; color: ${theme.accent}; }
  .eq { display: inline-flex; align-items: flex-end; gap: .8vmin; height: 5vmin; }
  .eq i { width: 1.1vmin; height: 30%; border-radius: 1vmin; background: currentColor; transition: height .3s; }
  .playing .eq i { animation: eq 1s ease-in-out infinite; }
  .eq i:nth-child(2) { animation-delay: -.8s !important; } .eq i:nth-child(3) { animation-delay: -.3s !important; }
  .eq i:nth-child(4) { animation-delay: -.6s !important; } .eq i:nth-child(5) { animation-delay: -.1s !important; }
  #again { margin-left: auto; font: inherit; font-size: .8em; color: #fff; padding: 1.4vmin 3vmin; border-radius: 99px;
           border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.12); }
  #tap { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 3vmin;
         background: rgba(5,8,20,.55); backdrop-filter: blur(6px); font-size: clamp(22px, 4vmin, 64px); font-weight: 700; }
  #tap[hidden], #again[hidden] { display: none; }
  #tap b { width: 18vmin; height: 18vmin; border-radius: 50%; display: grid; place-items: center; font-size: 8vmin;
           background: #fff; color: ${theme.from}; box-shadow: 0 0 0 0 rgba(255,255,255,.5); animation: ring 1.6s infinite; }
  @keyframes eq { 0%, 100% { height: 25% } 50% { height: 100% } }
  @keyframes ring { 70% { box-shadow: 0 0 0 4vmin transparent } 100% { box-shadow: 0 0 0 0 transparent } }
  @keyframes pop { from { transform: scale(.92); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes pulse { 70% { box-shadow: 0 0 0 2.4vmin transparent } 100% { box-shadow: 0 0 0 0 transparent } }
</style>
</head>
<body>
  <main class="card">
    <span class="tag"><span class="dot"></span>${escapeHtml(label)}</span>
    ${title ? `<h1>${escapeHtml(title)}</h1>` : '<div style="height:3vmin"></div>'}
    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    ${hasAudio ? audioBlock(lang) : ''}
    <footer>${escapeHtml(t('popupSentAt', { time }, lang))}</footer>
  </main>
  ${hasAudio ? `<div id="tap" hidden><b>&#9654;</b>${escapeHtml(t('popupTapToListen', {}, lang))}</div>${audioScript(cfg)}` : ''}
</body>
</html>`;
}
