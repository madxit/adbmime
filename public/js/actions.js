// Classic multi-board actions: apps, folders, popups, audio, power, shell.
import { t } from '/assets/i18n.js';
import { $, $$, api, confirmDanger, connectedTargets, esc, label, run, toast } from './core.js';

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
    const serials = connectedTargets();
    const form = new FormData();
    form.append('apk', file);
    form.append('serials', JSON.stringify(serials));
    form.append('grantPermissions', String($('#apkGrant').checked));
    const res = await run(e.currentTarget, t('apps.installLog', { file: file.name }), () => api('/api/actions/install', { method: 'POST', form }));
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
    const ok = await confirmDanger({
      title: t('apps.uninstallConfirmTitle'),
      text: t('apps.uninstallConfirmText', { pkg: packageName, n: serials.length }),
      okText: t('apps.uninstall'),
    });
    if (ok) run(btn, t('apps.uninstallLog', { pkg: packageName }), () => api('/api/actions/uninstall', { method: 'POST', body: { serials, packageName } }));
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
    const ok = await confirmDanger({
      title: t('folders.confirmTitle'),
      text: t('folders.confirmText', { paths: paths.join(', '), n: serials.length }),
      okText: t('folders.confirmOk'),
    });
    if (ok) run(btn, t('folders.log', { n: paths.length }), () => api('/api/actions/clear', { method: 'POST', body: { serials, paths } }));
  };

  // ---------------------------------------------------------------- popup + live preview
  const preview = () => {
    const mode = msgMode();
    const level = msgLevel();
    const title = $('#msgTitle').value.trim();
    const text = $('#msgText').value.trim();
    const screen = $('#msgPreview .bp-screen');
    screen.className = `bp-screen ${mode === 'notification' ? 'notification' : level}`;
    $('#pvTag').textContent = t(`msg.tag_${level}`);
    $('#pvTitle').textContent = title;
    $('#pvTitle').hidden = !title;
    $('#pvText').textContent = text || t('msg.previewEmpty');
    $('#pvText').classList.toggle('placeholder', !text);
    $('#pvNTitle').textContent = title || t('msg.notifDefault');
    $('#pvNText').textContent = text || t('msg.previewEmpty');
  };
  const msgMode = segmented('#msgMode', (v) => {
    $('#msgLevelField').style.visibility = v === 'screen' ? '' : 'hidden';
    preview();
  });
  const msgLevel = segmented('#msgLevel', preview);
  $('#msgTitle').oninput = preview;
  $('#msgText').oninput = preview;
  window.addEventListener('langchange', preview);
  preview();

  $('#btnMessage').onclick = async (e) => {
    const text = $('#msgText').value.trim();
    if (!text) return toast(t('msg.need'), 'err');
    const serials = connectedTargets();
    const title = $('#msgTitle').value.trim();
    const body = { serials, title, text, mode: msgMode(), level: msgLevel() };
    await run(e.currentTarget, t('msg.log', { title: title || text.slice(0, 30) }), () => api('/api/actions/message', { method: 'POST', body }));
    if ($('#msgSpeak').checked) {
      const form = new FormData();
      form.append('serials', JSON.stringify(serials));
      form.append('text', title ? `${title}. ${text}` : text);
      await run(null, t('msg.speakLog'), () => api('/api/actions/audio', { method: 'POST', form }));
    }
  };

  // ---------------------------------------------------------------- audio
  $('#volOn').onchange = (e) => ($('#volume').disabled = !e.target.checked);
  $('#volume').oninput = (e) => ($('#volVal').textContent = e.target.value);

  $('#btnAudio').onclick = async (e) => {
    const text = $('#audioText').value.trim();
    const file = audio.file();
    if (!text && !file) return toast(t('audio.need'), 'err');
    const form = new FormData();
    form.append('serials', JSON.stringify(connectedTargets()));
    if (file) form.append('audio', file);
    else form.append('text', text);
    if ($('#volOn').checked) form.append('volume', $('#volume').value);
    const title = file ? t('audio.logFile', { file: file.name }) : t('audio.logTts');
    const res = await run(e.currentTarget, title, () => api('/api/actions/audio', { method: 'POST', form }));
    if (res && file) audio.reset();
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
      const ok = action === 'screen' ? true : await confirmDanger(opts);
      if (ok) {
        run(null, t('power.log', { action: t(`power.${action}`), n: serials.length }), () =>
          api('/api/actions/power', { method: 'POST', body: { serials, action } }),
        );
      }
    };
  });

  // ---------------------------------------------------------------- shell
  $('#btnShell').onclick = (e) => {
    const command = $('#shellCmd').value.trim();
    if (!command) return toast(t('shell.need'), 'err');
    run(e.currentTarget, `adb shell ${command}`, () => api('/api/actions/shell', { method: 'POST', body: { serials: connectedTargets(), command } }));
  };
  $('#shellCmd').onkeydown = (e) => e.key === 'Enter' && !$('#btnShell').disabled && $('#btnShell').click();
  $('#shellChips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#shellCmd').value = chip.textContent;
    $('#shellCmd').focus();
  };
}
