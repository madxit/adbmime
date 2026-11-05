// Sequence ("macro") model shared by the server and the browser.
//  - validation of the steps (`normalizeSteps`);
//  - conversion of a step to the command run in the device shell (`deviceCommand`);
//  - the plain-text import/export format (`toText` / `fromText`), which is compatible with
//    the command files of the original AdbMime desktop app ("adb shell input tap 10 20", "sleep 2"...).
// This file must stay dependency free: it is served as-is to the browser.

export const MAX_STEPS = 500;
export const MAX_SLEEP_S = 600;
export const MAX_TOTAL_SLEEP_S = 3600;
export const MAX_COORD = 20000;

export const STEP_TYPES = [
  // input on the screen
  'tap',
  'swipe',
  'key',
  'text',
  'sleep',
  // apps and system
  'open',
  'url',
  'install',
  'uninstall',
  'hide',
  'unhide',
  'clear',
  'popup',
  'power',
  'shell',
  'comment',
];

/**
 * Steps that are not a plain device shell command: exported as `#@<type> {json}` lines.
 * "audio" is only read (older files): it becomes an audio popup.
 */
export const DIRECTIVE_TYPES = ['install', 'clear', 'popup', 'audio', 'power'];

/** Audio of a popup: none, the popup text read aloud (TTS) or a library audio file. */
export const POPUP_AUDIO = ['none', 'tts', 'file'];

/** Name of a file stored in the server library (see src/library.js). */
export const LIBRARY_FILE_RE = /^[a-f0-9]{20}\.(apk|mp3|wav|ogg|m4a)$/;
const AUDIO_FILE_RE = /^[a-f0-9]{20}\.(mp3|wav|ogg|m4a)$/;

/** Most useful Android key codes (android.view.KeyEvent). */
export const KEYCODES = {
  HOME: 3,
  BACK: 4,
  APP_SWITCH: 187,
  MENU: 82,
  POWER: 26,
  WAKEUP: 224,
  SLEEP: 223,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  VOLUME_MUTE: 164,
  ENTER: 66,
  DEL: 67,
  FORWARD_DEL: 112,
  EXPLORER: 64,
  TAB: 61,
  SPACE: 62,
  ESCAPE: 111,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  MOVE_HOME: 122,
  MOVE_END: 123,
  MEDIA_PLAY_PAUSE: 85,
  MEDIA_STOP: 86,
  MEDIA_NEXT: 87,
  MEDIA_PREVIOUS: 88,
  BRIGHTNESS_DOWN: 220,
  BRIGHTNESS_UP: 221,
  NOTIFICATION: 83,
  SETTINGS: 176,
  SEARCH: 84,
};

export const keyName = (code) =>
  Object.keys(KEYCODES).find((k) => KEYCODES[k] === Number(code)) ?? String(code);

const PACKAGE_RE = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;
const URL_RE = /^[a-z][a-z0-9+.-]*:\S+$/i;
const ASCII_RE = /^[\x20-\x7e]*$/;

/** Validation error: `code` is translated by the caller (keys `seq_<code>`). */
export class StepError extends Error {
  constructor(code, index = null, params = {}) {
    super(code);
    this.code = code;
    this.index = index;
    this.params = params;
  }
}

/** Quote a value for the Android (mksh/toybox) shell. */
export const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function intIn(value, min, max, code) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new StepError(code);
  return n;
}

const coord = (v) => intIn(v, 0, MAX_COORD, 'coords');

function packageName(v) {
  const p = String(v ?? '').trim();
  if (!PACKAGE_RE.test(p) || p.length > 200) throw new StepError('package');
  return p;
}

/** Return a clean copy of a step, or throw a StepError. */
export function normalizeStep(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  switch (s.type) {
    case 'tap':
      return { type: 'tap', x: coord(s.x), y: coord(s.y) };
    case 'swipe':
      return {
        type: 'swipe',
        x1: coord(s.x1),
        y1: coord(s.y1),
        x2: coord(s.x2),
        y2: coord(s.y2),
        duration: intIn(s.duration ?? 300, 0, 10000, 'duration'),
      };
    case 'key':
      return { type: 'key', keycode: intIn(s.keycode, 0, 999, 'keycode'), longpress: Boolean(s.longpress) };
    case 'text': {
      const text = String(s.text ?? '');
      if (!text || text.length > 500) throw new StepError('text');
      if (!ASCII_RE.test(text)) throw new StepError('ascii');
      return { type: 'text', text };
    }
    case 'sleep': {
      const n = Number(s.seconds);
      if (!Number.isFinite(n) || n < 0 || n > MAX_SLEEP_S) throw new StepError('seconds');
      return { type: 'sleep', seconds: Math.round(n * 10) / 10 };
    }
    case 'open':
    case 'hide':
    case 'unhide':
    case 'uninstall':
      return { type: s.type, package: packageName(s.package) };
    case 'url': {
      const url = String(s.url ?? '').trim();
      if (!URL_RE.test(url) || url.length > 2000) throw new StepError('url');
      return { type: 'url', url };
    }
    case 'shell': {
      const command = String(s.command ?? '').trim();
      if (!command || command.length > 2000) throw new StepError('command');
      return { type: 'shell', command };
    }
    case 'comment':
      return { type: 'comment', text: String(s.text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500) };
    case 'install': {
      const file = String(s.file ?? '');
      if (!/\.apk$/.test(file) || !LIBRARY_FILE_RE.test(file)) throw new StepError('file');
      return { type: 'install', file, name: fileName(s.name, file), grant: Boolean(s.grant) };
    }
    case 'clear': {
      const raw = Array.isArray(s.paths) ? s.paths : String(s.paths ?? '').split(/[\s,;]+/);
      const paths = [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))];
      if (!paths.length || paths.length > 20) throw new StepError('paths');
      if (paths.some((p) => !p.startsWith('/') || p.includes('..') || p.length > 300)) throw new StepError('paths');
      return { type: 'clear', paths };
    }
    case 'popup':
    case 'audio': {
      // Legacy "audio" steps are full screen popups whose only content is the audio.
      const legacy = s.type === 'audio';
      const mode = legacy ? 'screen' : (s.mode ?? 'screen');
      const level = legacy ? 'info' : (s.level ?? 'info');
      if (!['screen', 'notification'].includes(mode) || !['info', 'warning', 'urgent'].includes(level)) {
        throw new StepError('option');
      }
      let audio = legacy ? (s.file ? 'file' : 'tts') : (s.audio ?? 'none');
      if (!POPUP_AUDIO.includes(audio)) throw new StepError('option');
      if (mode === 'notification') audio = 'none'; // notifications cannot play audio
      const text = String(s.text ?? '').trim();
      if ((audio !== 'file' && !text) || text.length > 2000) throw new StepError('text');
      const step = { type: 'popup', mode, level, title: String(s.title ?? '').trim().slice(0, 120), text, audio };
      if (audio === 'file') {
        if (!AUDIO_FILE_RE.test(String(s.file ?? ''))) throw new StepError('file');
        Object.assign(step, { file: s.file, name: fileName(s.name, s.file) });
      }
      if (audio !== 'none') {
        step.volume = s.volume === undefined || s.volume === null || s.volume === '' ? null : intIn(s.volume, 1, 15, 'option');
      }
      return step;
    }
    case 'power':
      if (!['shutdown', 'reboot', 'screen'].includes(s.action)) throw new StepError('option');
      return { type: 'power', action: s.action };
    default:
      throw new StepError('type');
  }
}

const fileName = (name, file) => String(name || file).replace(/[\r\n]+/g, ' ').slice(0, 200);

/** Short human readable description of a step (used in logs). */
export function stepLabel(step) {
  switch (step.type) {
    case 'install':
      return `install ${step.name}${step.grant ? ' (-g)' : ''}`;
    case 'clear':
      return `clear ${step.paths.join(' ')}`;
    case 'popup': {
      const audio = step.audio === 'file' ? ` +audio ${step.name}` : step.audio === 'tts' ? ' +tts' : '';
      const vol = step.volume === null || step.volume === undefined ? '' : ` vol=${step.volume}`;
      return `popup [${step.mode === 'screen' ? step.level : 'notification'}] ${step.title || step.text.slice(0, 50)}${audio}${vol}`;
    }
    case 'power':
      return `power ${step.action}`;
    case 'sleep':
      return `sleep ${step.seconds}`;
    default:
      return deviceCommand(step) ?? step.type;
  }
}

/** Validate a whole sequence. Errors carry the (0-based) index of the faulty step. */
export function normalizeSteps(list, { allowEmpty = false } = {}) {
  // An empty sequence can be saved (and filled later), but never run.
  if (!Array.isArray(list) || (!list.length && !allowEmpty)) throw new StepError('empty');
  if (list.length > MAX_STEPS) throw new StepError('tooMany', null, { max: MAX_STEPS });
  const steps = list.map((raw, i) => {
    try {
      return normalizeStep(raw);
    } catch (err) {
      if (err instanceof StepError) err.index = i;
      throw err;
    }
  });
  const totalSleep = steps.reduce((sum, s) => sum + (s.type === 'sleep' ? s.seconds : 0), 0);
  if (totalSleep > MAX_TOTAL_SLEEP_S) throw new StepError('tooLong', null, { max: MAX_TOTAL_SLEEP_S });
  return steps;
}

/** Command executed in the device shell (`adb shell <command>`); null for sleep/comment. */
export function deviceCommand(step) {
  switch (step.type) {
    case 'tap':
      return `input tap ${step.x} ${step.y}`;
    case 'swipe':
      return `input swipe ${step.x1} ${step.y1} ${step.x2} ${step.y2} ${step.duration}`;
    case 'key':
      return `input keyevent ${step.longpress ? '--longpress ' : ''}${step.keycode}`;
    case 'text':
      // `input text` turns "%s" into spaces: real spaces would split the argument.
      return `input text ${shQuote(step.text.replace(/ /g, '%s'))}`;
    case 'open':
      return `monkey -p ${step.package} -c android.intent.category.LAUNCHER 1`;
    case 'url':
      return `am start -a android.intent.action.VIEW -d ${shQuote(step.url)}`;
    case 'hide':
      return `pm hide ${step.package}`;
    case 'unhide':
      return `pm unhide ${step.package}`;
    case 'uninstall':
      return `pm uninstall ${step.package}`;
    case 'shell':
      return step.command;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ text format

/** One line of the text format (same syntax as the original AdbMime command files). */
export function stepToLine(step) {
  if (DIRECTIVE_TYPES.includes(step.type)) {
    // Comments for the original desktop app, which simply ignores them.
    const { type, ...rest } = step;
    return `#@${type} ${JSON.stringify(rest)}`;
  }
  switch (step.type) {
    case 'sleep':
      return `sleep ${step.seconds}`;
    case 'comment':
      return `#${step.text}`;
    case 'open':
      return `adb shell monkey --pct-syskeys 0 -p ${step.package} 1`;
    case 'uninstall':
      return `adb uninstall ${step.package}`;
    default:
      return `adb shell ${deviceCommand(step)}`;
  }
}

export function toText(steps, name = '') {
  const header = name ? [`#@name ${name.replace(/[\r\n]+/g, ' ')}`] : [];
  return [...header, ...steps.map(stepToLine)].join('\n') + '\n';
}

/** Undo shell quoting: handles '...', "..." and backslash escapes. */
export function unquote(input) {
  let out = '';
  let i = 0;
  const s = String(input);
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      out += s.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) i++;
        out += s[i++];
      }
      if (s[i] !== '"') return null;
      i++;
    } else if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function parseShell(cmd) {
  let m;
  if ((m = /^input\s+tap\s+(\d+)\s+(\d+)$/.exec(cmd))) return { type: 'tap', x: +m[1], y: +m[2] };
  if ((m = /^input\s+swipe\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(cmd))) {
    return { type: 'swipe', x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], duration: m[5] ? +m[5] : 300 };
  }
  if ((m = /^input\s+keyevent\s+(--longpress\s+)?(?:KEYCODE_)?(\w+)$/.exec(cmd))) {
    const code = /^\d+$/.test(m[2]) ? +m[2] : KEYCODES[m[2].toUpperCase()];
    if (code !== undefined) return { type: 'key', keycode: code, longpress: Boolean(m[1]) };
  }
  if ((m = /^input\s+text\s+(.+)$/.exec(cmd))) {
    const text = unquote(m[1]);
    if (text !== null) return { type: 'text', text: text.replace(/%s/g, ' ') };
  }
  if ((m = /^monkey\b.*?\s-p\s+(\S+)/.exec(cmd))) return { type: 'open', package: m[1] };
  if ((m = /^am\s+start\s+-a\s+android\.intent\.action\.VIEW\s+-d\s+(\S+|'[^']*')$/.exec(cmd))) {
    const url = unquote(m[1]);
    if (url) return { type: 'url', url };
  }
  if ((m = /^pm\s+(hide|unhide|uninstall)\s+(\S+)$/.exec(cmd))) return { type: m[1], package: m[2] };
  return { type: 'shell', command: cmd };
}

/** Parse a single line; returns null for blank lines and throws StepError('type') if unknown. */
export function lineToStep(rawLine) {
  const line = rawLine.trim();
  if (!line) return null;
  let d;
  if ((d = /^#@(\w+)\s+(\{.*\})$/.exec(line)) && DIRECTIVE_TYPES.includes(d[1])) {
    let data;
    try {
      data = JSON.parse(d[2]);
    } catch {
      throw new StepError('type');
    }
    return { ...data, type: d[1] };
  }
  if (line.startsWith('#')) return { type: 'comment', text: line.slice(1) };
  let m;
  if ((m = /^sleep\s+(\d+(?:\.\d+)?)$/.exec(line))) return { type: 'sleep', seconds: Number(m[1]) };
  // Strip "adb" and an optional "-s <serial>": the target boards are chosen in the UI.
  const rest = line.replace(/^adb(?:\s+-s\s+\S+)?\s+/, '');
  if (rest === line) throw new StepError('type');
  if ((m = /^uninstall\s+(?:-k\s+)?(\S+)$/.exec(rest))) return { type: 'uninstall', package: m[1] };
  // `adb install` is importable only when it points to a file of this server library.
  if ((m = /^install\s+(?:-r\s+)?(-g\s+)?(?:\S*\/)?([a-f0-9]{20}\.apk)$/.exec(rest))) {
    return { type: 'install', file: m[2], grant: Boolean(m[1]) };
  }
  if ((m = /^shell\s+(.+)$/.exec(rest))) return parseShell(m[1].trim());
  throw new StepError('type');
}

/**
 * Parse an exported file: either the text format or JSON ({ name, steps } or [steps]).
 * Returns { name, steps, errors: [{ line, text, code }] } — invalid lines are skipped.
 */
export function parseSequenceFile(content) {
  const text = String(content ?? '').replace(/^﻿/, '');
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const list = Array.isArray(data) ? data : data.steps;
    const errors = [];
    const steps = [];
    (Array.isArray(list) ? list : []).forEach((raw, i) => {
      try {
        steps.push(normalizeStep(raw));
      } catch (err) {
        errors.push({ line: i + 1, text: JSON.stringify(raw), code: err.code ?? 'type' });
      }
    });
    return { name: Array.isArray(data) ? '' : String(data.name ?? ''), steps, errors };
  }

  let name = '';
  const steps = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const nameMatch = /^\s*#@name\s+(.*)$/.exec(line);
    if (nameMatch) {
      name = nameMatch[1].trim();
      return;
    }
    try {
      const step = lineToStep(line);
      if (step) steps.push(normalizeStep(step));
    } catch (err) {
      errors.push({ line: i + 1, text: line.trim(), code: err.code ?? 'type' });
    }
  });
  return { name, steps, errors };
}
