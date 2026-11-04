// Classic multi-board actions: apps, folders, popups (text and/or audio), power, shell.
// When recording is on, every action is also appended to the open sequence; with no connected
// target board, actions are only recorded (not executed).
import { icon } from '/assets/icons.js';
import { t } from '/assets/i18n.js';
import { $, $$, api, confirmDanger, connectedTargets, esc, label, run, toast } from './core.js';
import { isRecording, record } from './recorder.js';

/** Segmented control helper: returns a getter for the active value. */
function segmented(sel, onChange) {
  const root = $(sel);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    $$('button', root).forEach((x) => x.classList.toggle('active', x === b));
    onChange?.(b.dataset.v);
  };
  return () => $('button.active', root).dataset.v;
}

/** Wire a drop zone to a hidden file input. `placeholderKey` is an i18n key. */
function dropZone(zoneSel, inputSel, nameSel, placeholderKey) {
  const zone = $(zoneSel);
  const input = $(inputSel);
  const show = () => {
    $(nameSel).textContent = input.files[0]?.name ?? t(placeholderKey);
    zone.classList.toggle('has-file', Boolean(input.files[0]));
  };
  input.onchange = show;
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add('over');
  };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      show();
    }
  };
  window.addEventListener('langchange', show);
  show();
  return { file: () => input.files[0], reset: () => ((input.value = ''), show()) };
}

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Store a file in the server library (needed to replay install/audio steps later). */
export async function uploadToLibrary(file) {
  const form = new FormData();
  form.append('file', file);
  return api('/api/library', { method: 'POST', form });
}

/** True when the action must only be recorded (recording on, no connected target). */
const recordOnly = () => isRecording() && connectedTargets().length === 0;

/** Record steps; when nothing will be executed, tell the user. Returns true if execution must be skipped. */
function recordSteps(steps) {
  record(steps);
  if (recordOnly()) {
    toast(t('rec.recordedOnly'), 'info');
    return true;
  }
  return false;
}

/** Ask for confirmation only when something is really going to be executed. */
const confirmIfRunning = (opts) => (recordOnly() ? Promise.resolve(true) : confirmDanger(opts));

export function renderActionsMeta(meta) {
  $('#rootsHint').innerHTML = t('folders.roots', {
    roots: meta.clearAllowedRoots.map((r) => `<code>${esc(r)}</code>`).join(' '),
  });
}

export function initActions() {
  const apk = dropZone('#apkDrop', '#apkFile', '#apkName', 'apps.drop');
  const audio = dropZone('#audioDrop', '#audioFile', '#audioName', 'audio.drop');


  // ---------------------------------------------------------------- apps
  $('#btnInstall').onclick = async (e) => {
    const file = apk.file();
    if (!file) return toast(t('apps.needApk'), 'err');
    const btn = e.currentTarget;
    const grant = $('#apkGrant').checked;
    const form = new FormData();
    form.append('serials', JSON.stringify(connectedTargets()));
    form.append('grantPermissions', String(grant));
    if (isRecording()) {
      // The APK must stay on the server to replay the sequence later.
      let stored;
      try {
        btn.disabled = true;
        stored = await uploadToLibrary(file);
      } catch (err) {
        return toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
      if (recordSteps({ type: 'install', file: stored.file, name: stored.name, grant })) return apk.reset();
      form.append('libraryFile', stored.file);
    } else {
      form.append('apk', file);
    }
    const res = await run(btn, t('apps.installLog', { file: file.name }), () => api('/api/actions/install', { method: 'POST', form }));
    if (res && !res.failed) apk.reset();
  };

  $('#btnPkgList').onclick = async (e) => {
    const serial = connectedTargets()[0];
    if (!serial) return toast(t('apps.needConnected'), 'err');
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { packages } = await api(`/api/devices/${encodeURIComponent(serial)}/packages`);
      $('#pkgList').innerHTML = packages.map((p) => `<option value="${esc(p)}">`).join('');
      $('#pkgHint').textContent = t('apps.pkgFound', { n: packages.length, name: label(serial) });
      $('#pkgName').focus();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  };

  $('#btnUninstall').onclick = async (e) => {
    const packageName = $('#pkgName').value.trim();
    if (!packageName) return toast(t('apps.needPkg'), 'err');
    const serials = connectedTargets();
    const btn = e.currentTarget;
    const ok = await confirmIfRunning({
      title: t('apps.uninstallConfirmTitle'),
      text: t('apps.uninstallConfirmText', { pkg: packageName, n: serials.length }),
      okText: t('apps.uninstall'),
    });
    if (!ok || recordSteps({ type: 'uninstall', package: packageName })) return;
    run(btn, t('apps.uninstallLog', { pkg: packageName }), () => api('/api/actions/uninstall', { method: 'POST', body: { serials, packageName } }));
  };

  // ---------------------------------------------------------------- folders
  $('#folderChips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const ta = $('#folders');
    const list = lines(ta.value);
    if (!list.includes(chip.dataset.path)) list.push(chip.dataset.path);
    ta.value = list.join('\n');
  };

  $('#btnClear').onclick = async (e) => {
    const paths = lines($('#folders').value);
    if (!paths.length) return toast(t('folders.need'), 'err');
    const serials = connectedTargets();
    const btn = e.currentTarget;
    const ok = await confirmIfRunning({
      title: t('folders.confirmTitle'),
      text: t('folders.confirmText', { paths: paths.join(', '), n: serials.length }),
      okText: t('folders.confirmOk'),
    });
    if (!ok || recordSteps({ type: 'clear', paths })) return;
    run(btn, t('folders.log', { n: paths.length }), () => api('/api/actions/clear', { method: 'POST', body: { serials, paths } }));
  };

  // ---------------------------------------------------------------- popup (text and/or audio) + live preview
  const preview = () => {
    const mode = msgMode();
    const level = msgLevel();
    const kind = mode === 'screen' ? msgAudio() : 'none';
    const title = $('#msgTitle').value.trim();
    const text = $('#msgText').value.trim();
    const screen = $('#msgPreview .bp-screen');
    screen.className = `bp-screen ${mode === 'notification' ? 'notification' : level}`;
    $('#pvTag').textContent = t(`msg.tag_${level}`);
    $('#pvTitle').textContent = title;
    $('#pvTitle').hidden = !title;
    // An audio-file popup may have no text at all.
    const textless = !text && kind === 'file';
    $('#pvText').textContent = text || t('msg.previewEmpty');
    $('#pvText').classList.toggle('placeholder', !text);
    $('#pvText').hidden = textless;
    $('#pvAudio').hidden = kind === 'none';
    $('#pvAudioTxt').textContent = kind === 'file' ? (audio.file()?.name ?? t('msg.audioFile')) : t('msg.audioTts');
    $('#pvNTitle').textContent = title || t('msg.notifDefault');
    $('#pvNText').textContent = text || t('msg.previewEmpty');

    // Form: audio options only for full screen popups.
    $('#msgAudioField').hidden = mode !== 'screen';
    $('#audioDrop').hidden = kind !== 'file';
    $('#msgVolField').hidden = kind === 'none';
    $('#msgAudioHint').textContent = kind === 'none' ? '' : t(`msg.audioHint_${kind}`);
  };
  const msgMode = segmented('#msgMode', (v) => {
    $('#msgLevelField').style.visibility = v === 'screen' ? '' : 'hidden';
    preview();
  });
  const msgLevel = segmented('#msgLevel', preview);
  const msgAudio = segmented('#msgAudio', preview);
  $('#msgTitle').oninput = preview;
  $('#msgText').oninput = preview;
  $('#audioFile').addEventListener('change', preview);
  $('#audioDrop').addEventListener('drop', () => setTimeout(preview));
  $('#volOn').onchange = (e) => ($('#volume').disabled = !e.target.checked);
  $('#volume').oninput = (e) => ($('#volVal').textContent = e.target.value);
  window.addEventListener('langchange', preview);
  preview();

  $('#btnMessage').onclick = async (e) => {
    const btn = e.currentTarget;
    const mode = msgMode();
    const kind = mode === 'screen' ? msgAudio() : 'none';
    const title = $('#msgTitle').value.trim();
    const text = $('#msgText').value.trim();
    const file = kind === 'file' ? audio.file() : null;
    if (kind === 'file' && !file) return toast(t('msg.needAudio'), 'err');
    if (!text && kind !== 'file') return toast(t('msg.need'), 'err');
    const volume = kind !== 'none' && $('#volOn').checked ? Number($('#volume').value) : null;

    const step = { type: 'popup', mode, level: msgLevel(), title, text, audio: kind };
    if (kind !== 'none') step.volume = volume;
    const form = new FormData();
    form.append('serials', JSON.stringify(connectedTargets()));
    for (const k of ['mode', 'level', 'title', 'text', 'audio']) form.append(k, step[k]);
    if (volume !== null) form.append('volume', String(volume));

    if (file && isRecording()) {
      // The audio file must stay on the server to replay the sequence later.
      try {
        btn.disabled = true;
        const stored = await uploadToLibrary(file);
        Object.assign(step, { file: stored.file, name: stored.name });
      } catch (err) {
        return toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
      form.append('libraryFile', step.file);
    } else if (file) form.append('audio', file);
    if (recordSteps(step)) return file && (audio.reset(), preview());

    const what = title || text.slice(0, 30) || file?.name || '';
    const res = await run(btn, t(kind === 'none' ? 'msg.log' : 'msg.logAudio', { title: what }), () =>
      api('/api/actions/message', { method: 'POST', form }),
    );
    if (res && file) {
      audio.reset();
      preview();
    }
  };

  // ---------------------------------------------------------------- power
  $$('[data-power]').forEach((b) => {
    b.onclick = async () => {
      const action = b.dataset.power;
      const serials = connectedTargets();
      const opts = {
        title: t(`power.confirm_${action}`),
        text: t('power.confirmText', { n: serials.length }),
        okText: t(`power.ok_${action}`),
      };
      // The screen toggle is harmless: no confirmation needed.
      const ok = action === 'screen' ? true : await confirmIfRunning(opts);
      if (!ok || recordSteps({ type: 'power', action })) return;
      run(null, t('power.log', { action: t(`power.${action}`), n: serials.length }), () =>
        api('/api/actions/power', { method: 'POST', body: { serials, action } }),
      );
    };
  });

  // ---------------------------------------------------------------- shell
  const history = loadHistory();
  let histPos = history.length;

  $('#btnShell').onclick = async (e) => {
    const command = $('#shellCmd').value.trim();
    if (!command) return toast(t('shell.need'), 'err');
    remember(history, command);
    histPos = history.length;
    if (recordSteps({ type: 'shell', command })) return;
    const res = await run(e.currentTarget, `adb shell ${command}`, () =>
      api('/api/actions/shell', { method: 'POST', body: { serials: connectedTargets(), command } }),
    );
    if (res) showShellOutput(command, res.results);
  };
  $('#shellCmd').onkeydown = (e) => {
    if (e.key === 'Enter' && !$('#btnShell').disabled) return $('#btnShell').click();
    // Arrow keys walk through the command history, like a terminal.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
      e.preventDefault();
      histPos = Math.max(0, Math.min(history.length, histPos + (e.key === 'ArrowUp' ? -1 : 1)));
      e.target.value = history[histPos] ?? '';
    }
  };
  $('#shellChips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#shellCmd').value = chip.textContent;
    $('#shellCmd').focus();
  };
  $('#shellOutClear').onclick = () => {
    $('#shellOut').hidden = true;
    $('#shellOutList').innerHTML = '';
  };
  $('#shellOutList').onclick = async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.closest('.term').querySelector('pre').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs https or localhost: fall back to a temporary selection.
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(t('shell.copied'), 'ok');
  };
}

const HISTORY_KEY = 'adbmime.shellHistory';

function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(h) ? h.slice(-50) : [];
  } catch {
    return [];
  }
}

function remember(history, command) {
  const i = history.indexOf(command);
  if (i !== -1) history.splice(i, 1);
  history.push(command);
  if (history.length > 50) history.shift();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

/** Output of the last shell command, one terminal block per board. */
function showShellOutput(command, results) {
  $('#shellOutCmd').textContent = `$ ${command}`;
  $('#shellOutList').innerHTML = results
    .map((r) => {
      const meta = [r.code !== undefined && r.code !== null ? t('shell.exit', { code: r.code }) : '', r.ms !== undefined ? `${r.ms} ms` : '']
        .filter(Boolean)
        .join(' · ');
      return `<div class="term ${r.ok ? 'ok' : 'ko'}">
        <div class="term-head">
          <i class="sdot"></i><b>${esc(label(r.serial))}</b>
          <span class="muted mono">${esc(meta)}</span>
          <div class="grow"></div>
          <button class="btn ghost sm" data-copy title="${esc(t('shell.copy'))}">${icon('copy')}</button>
        </div>
        <pre class="${r.output ? '' : 'empty-out'}">${esc(r.output || t('shell.noOutput'))}</pre>
      </div>`;
    })
    .join('');
  $('#shellOut').hidden = false;
}
