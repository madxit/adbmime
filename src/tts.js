// Server-side text-to-speech: turns text into a WAV file that the boards then play.
// Uses the engine available on the host OS: `say` (macOS), espeak-ng/espeak (Linux),
// System.Speech via PowerShell (Windows).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, MEDIA_DIR } from './config.js';
import { t } from './i18n.js';

// Locale used to pick a voice for each UI language.
const LOCALES = {
  it: { mac: /\bit[_-]IT\b/, win: 'it', espeak: 'it' },
  en: { mac: /\ben[_-](GB|US)\b/, win: 'en', espeak: 'en' },
  fr: { mac: /\bfr[_-]FR\b/, win: 'fr', espeak: 'fr' },
  es: { mac: /\bes[_-]ES\b/, win: 'es', espeak: 'es' },
  de: { mac: /\bde[_-]DE\b/, win: 'de', espeak: 'de' },
  pt: { mac: /\bpt[_-](PT|BR)\b/, win: 'pt', espeak: 'pt' },
  zh: { mac: /\bzh[_-]CN\b/, win: 'zh', espeak: 'cmn' },
};

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60_000, windowsHide: true, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout)),
    );
  });

const macVoices = new Map(); // lang -> voice name (cached lookup)

async function pickMacVoice(lang) {
  // TTS_VOICE forces a voice, but only makes sense for the default language.
  if (config.ttsVoice && lang === 'it') return config.ttsVoice;
  if (macVoices.has(lang)) return macVoices.get(lang);
  let voice = null;
  try {
    const voices = await run('say', ['-v', '?']);
    const line = voices.split('\n').find((l) => LOCALES[lang].mac.test(l));
    voice = line ? line.split(/\s{2,}/)[0].trim() : null;
  } catch {
    /* default voice */
  }
  macVoices.set(lang, voice);
  return voice;
}

async function firstAvailable(cmds) {
  for (const cmd of cmds) {
    try {
      await run(cmd, ['--version'], { timeout: 5000 });
      return cmd;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Synthesize `text` in language `lang` and return the generated file name (inside MEDIA_DIR). */
export async function synthesize(text, lang = 'it') {
  if (!LOCALES[lang]) lang = 'it';
  const forcedVoice = lang === 'it' ? config.ttsVoice : '';
  const id = crypto.randomUUID();
  const file = `${id}.wav`;
  const out = path.join(MEDIA_DIR, file);
  // Text goes through a file, never through the command line, to avoid quoting issues.
  const txt = path.join(MEDIA_DIR, `${id}.txt`);
  fs.writeFileSync(txt, text, 'utf8');

  try {
    if (process.platform === 'darwin') {
      const voice = await pickMacVoice(lang);
      const args = ['-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', txt];
      if (voice) args.unshift('-v', voice);
      await run('say', args);
    } else if (process.platform === 'win32') {
      const ps = [
        'Add-Type -AssemblyName System.Speech;',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
        "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like ($env:TTS_LANG + '*') } | Select-Object -First 1;",
        'if ($env:TTS_VOICE) { $s.SelectVoice($env:TTS_VOICE) } elseif ($v) { $s.SelectVoice($v.VoiceInfo.Name) };',
        '$s.SetOutputToWaveFile($env:TTS_OUT);',
        '$s.Speak([IO.File]::ReadAllText($env:TTS_TXT));',
        '$s.Dispose();',
      ].join(' ');
      await run('powershell', ['-NoProfile', '-Command', ps], {
        env: { ...process.env, TTS_OUT: out, TTS_TXT: txt, TTS_VOICE: forcedVoice, TTS_LANG: LOCALES[lang].win },
      });
    } else {
      const engine = await firstAvailable(['espeak-ng', 'espeak']);
      if (!engine) {
        throw new Error(t('noTts'));
      }
      await run(engine, ['-v', forcedVoice || LOCALES[lang].espeak, '-w', out, '-f', txt]);
    }
  } finally {
    fs.rmSync(txt, { force: true });
  }
  if (!fs.existsSync(out)) throw new Error(t('ttsFailed'));
  return file;
}
