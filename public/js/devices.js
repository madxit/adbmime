// Boards sidebar: compact vertical list, filters, selection, scan and connection.
import { icon } from '/assets/icons.js';
import { locale, t } from '/assets/i18n.js';
import {
  $, $$, api, confirmDanger, connectedTargets, deviceName, esc, findDevice, label, modal, ONLINE, run, state, toast,
} from './core.js';
import { isRecording } from './recorder.js';

let onOpenScreen = () => {};
export const setOpenScreenHandler = (fn) => (onOpenScreen = fn);

function visibleDevices() {
  const q = state.filter.trim().toLowerCase();
  return state.devices.filter((d) => {
    if (state.statusFilter === 'connected' && d.status !== 'connected') return false;
    if (state.statusFilter === 'online' && !ONLINE.includes(d.status)) return false;
    if (state.statusFilter === 'offline' && ONLINE.includes(d.status)) return false;
    if (!q) return true;
    return [d.name, d.ip, d.serial, d.model, d.manufacturer].some((v) => v?.toLowerCase().includes(q));
  });
}

function row(d) {
  const sub = [d.serial, d.android && `Android ${d.android}`].filter(Boolean).join(' · ');
  const title = [d.manufacturer, d.model].filter(Boolean).join(' ');
  const canConnect = d.status === 'online' || d.status === 'unauthorized';
  const connected = d.status === 'connected';
  return `<div class="dev s-${d.status} ${state.selected.has(d.serial) ? 'selected' : ''}" data-serial="${esc(d.serial)}" title="${esc(title)}">
    <span class="cb">${icon('check')}</span>
    <span class="sdot s-${d.status}"></span>
    <div class="dev-main">
      <div class="dev-name">${esc(deviceName(d))}</div>
      <div class="dev-sub">${esc(d.status === 'unauthorized' ? t('device.authorize') : sub)}</div>
    </div>
    <span class="dev-status">${esc(t(`status.${d.status}`))}</span>
    <div class="dev-acts">
      ${connected ? `<button class="btn" data-act="screen" title="${esc(t('device.screen'))}">${icon('screen')}</button>` : ''}
      ${connected ? `<button class="btn" data-act="disconnect" title="${esc(t('devices.disconnect'))}">${icon('unlink')}</button>` : ''}
      ${canConnect ? `<button class="btn" data-act="connect" title="${esc(t('devices.connect'))}">${icon('link')}</button>` : ''}
      <button class="btn" data-act="rename" title="${esc(t('device.rename'))}">${icon('edit')}</button>
      <button class="btn" data-act="forget" title="${esc(t('device.forget'))}">${icon('trash')}</button>
    </div>
  </div>`;
}

let lastListHtml = '';

export function renderDevices() {
  const ds = state.devices;
  const count = (fn) => ds.filter(fn).length;
  $('#devCount').textContent = ds.length;
  $('#cAll').textContent = ds.length;
  $('#cConnected').textContent = count((d) => d.status === 'connected');
  $('#cOnline').textContent = count((d) => ONLINE.includes(d.status));
  $('#cOffline').textContent = count((d) => !ONLINE.includes(d.status));

  for (const s of state.selected) if (!findDevice(s)) state.selected.delete(s);

  const list = visibleDevices();
  const html = list.length
    ? list.map(row).join('')
    : `<div class="empty"><div class="big">${icon(ds.length ? 'search' : 'radar')}</div>
        <h3>${esc(t(ds.length ? 'devices.noMatchTitle' : 'devices.emptyTitle'))}</h3>
        <div>${esc(t(ds.length ? 'devices.noMatchText' : 'devices.emptyText'))}</div></div>`;
  // Re-render only on changes, so hovering/clicking a row is not disturbed by polling.
  if (html !== lastListHtml) {
    $('#devList').innerHTML = html;
    lastListHtml = html;
  }

  const visibleSelected = list.filter((d) => state.selected.has(d.serial)).length;
  const selAll = $('#selAll');
  selAll.checked = list.length > 0 && visibleSelected === list.length;
  selAll.indeterminate = visibleSelected > 0 && visibleSelected < list.length;
  $('#selText').textContent = state.selected.size ? t('select.count', { n: state.selected.size }) : t('select.none');

  const targets = connectedTargets().length;
  $('#btnConnect').disabled = ![...state.selected].some((s) => findDevice(s)?.status !== 'connected');
  $('#btnDisconnect').disabled = targets === 0;

  // Target bar above the action panes.
  const bar = $('#targetBar');
  const notReady = state.selected.size - targets;
  bar.classList.toggle('ready', targets > 0);
  bar.classList.toggle('warn', targets === 0 && state.selected.size > 0);
  $('#targetTxt').innerHTML = state.selected.size === 0 ? esc(t('target.none')) : t('target.ready', { n: targets });
  $('#targetSub').textContent = notReady > 0 ? t('target.notReady', { n: notReady }) : '';
  // While recording, actions stay available even without targets (they are only recorded).
  const recording = isRecording();
  $$('.needs-target').forEach((b) => {
    if (!b.querySelector('.spinner')) b.disabled = targets === 0 && !recording;
  });
  if (recording && targets === 0) $('#targetTxt').textContent = t('rec.targetHint');
  window.dispatchEvent(new CustomEvent('targetschange', { detail: targets }));
}

/** Force a full list re-render (e.g. after a language change). */
export function invalidateDevices() {
  lastListHtml = '';
  renderDevices();
}

export function renderScan(scan) {
  const bar = $('#scanbar');
  bar.classList.toggle('on', Boolean(scan.running));
  if (scan.running) {
    const pct = scan.total ? Math.round((scan.scanned / scan.total) * 100) : 0;
    $('#scanText').textContent = t('scan.progress', { done: scan.scanned, total: scan.total });
    $('#scanFound').textContent = t('scan.found', { n: scan.found });
    $('#scanProgress').style.width = `${pct}%`;
  }
  const btn = $('#btnScan');
  btn.disabled = Boolean(scan.running);
  btn.innerHTML = scan.running
    ? `<span class="spinner"></span>${esc(t('devices.scanning'))}`
    : `${icon('radar')}<span>${esc(t('devices.scan'))}</span>`;
  // Notify the end of a scan observed by this page.
  if (state.scan.running && !scan.running) {
    if (scan.error) toast(scan.error, 'err');
    else toast(t('scan.done', { n: scan.found }), 'ok');
  }
  state.scan = scan;
  const nets = scan.subnets?.length ? scan.subnets.join(', ') : '';
  $('#subnets').textContent = nets ? t('devices.networks', { nets, port: state.meta?.adbPort ?? 5555 }) : '';
  $('#subnets').title = scan.finishedAt ? new Date(scan.finishedAt).toLocaleString(locale()) : '';
}

// ------------------------------------------------------------------ events

export function initDevices({ refresh }) {
  $('#btnScan').onclick = async () => {
    try {
      state.scan = await api('/api/scan', { method: 'POST' });
      toast(t('scan.started'), 'info');
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('#btnRefresh').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await api('/api/refresh', { method: 'POST' }).catch((err) => toast(err.message, 'err'));
    btn.disabled = false;
    refresh();
  };

  $('#btnAdd').onclick = async () => {
    const v = await modal({
      title: t('add.title'),
      text: t('add.text'),
      fields: [{ id: 'ip', label: t('add.field'), placeholder: '192.168.1.50, 192.168.1.51' }],
      okText: t('add.ok'),
    });
    if (!v?.ip.trim()) return;
    try {
      await api('/api/devices', { method: 'POST', body: { ip: v.ip } });
      toast(t('add.done'), 'ok');
      setTimeout(refresh, 1200);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('#filter').oninput = (e) => {
    state.filter = e.target.value;
    renderDevices();
  };

  $('#statusFilter').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#statusFilter button').forEach((x) => x.classList.toggle('active', x === b));
    state.statusFilter = b.dataset.f;
    renderDevices();
  };

  $('#selAll').onchange = (e) => {
    const visible = visibleDevices();
    for (const d of visible) e.target.checked ? state.selected.add(d.serial) : state.selected.delete(d.serial);
    renderDevices();
  };

  $$('[data-select]').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.select;
      state.selected.clear();
      for (const d of visibleDevices()) {
        if (mode === 'connected' && d.status === 'connected') state.selected.add(d.serial);
        if (mode === 'online' && ONLINE.includes(d.status)) state.selected.add(d.serial);
      }
      renderDevices();
    };
  });

  $('#devList').onclick = async (e) => {
    const rowEl = e.target.closest('.dev');
    if (!rowEl) return;
    const serial = rowEl.dataset.serial;
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) {
      state.selected.has(serial) ? state.selected.delete(serial) : state.selected.add(serial);
      return renderDevices();
    }
    const act = actBtn.dataset.act;
    const body = { serials: [serial] };
    if (act === 'screen') return onOpenScreen(serial);
    if (act === 'connect') return run(actBtn, t('log.connect', { name: label(serial) }), () => api('/api/connect', { method: 'POST', body }));
    if (act === 'disconnect') return run(actBtn, t('log.disconnect', { name: label(serial) }), () => api('/api/disconnect', { method: 'POST', body }));
    if (act === 'rename') {
      const d = findDevice(serial);
      const v = await modal({
        title: t('rename.title'),
        text: serial,
        fields: [{ id: 'name', label: t('rename.field'), value: d?.name, placeholder: t('rename.placeholder') }],
        okText: t('rename.ok'),
      });
      if (!v) return;
      await api(`/api/devices/${encodeURIComponent(serial)}`, { method: 'PATCH', body: { name: v.name } }).catch((err) => toast(err.message, 'err'));
      return refresh();
    }
    if (act === 'forget') {
      const ok = await confirmDanger({ title: t('forget.title'), text: t('forget.text', { name: label(serial) }), okText: t('forget.ok') });
      if (!ok) return;
      await api(`/api/devices/${encodeURIComponent(serial)}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'err'));
      state.selected.delete(serial);
      return refresh();
    }
  };

  $('#btnConnect').onclick = (e) => {
    const serials = [...state.selected].filter((s) => findDevice(s)?.status !== 'connected');
    if (!serials.length) return;
    run(e.currentTarget, t('log.connectMany', { n: serials.length }), () => api('/api/connect', { method: 'POST', body: { serials } }));
  };

  $('#btnDisconnect').onclick = (e) => {
    const serials = connectedTargets();
    run(e.currentTarget, t('log.disconnectMany', { n: serials.length }), () => api('/api/disconnect', { method: 'POST', body: { serials } }));
  };
}
