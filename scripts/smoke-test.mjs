#!/usr/bin/env node
// Smoke test of the executable built by scripts/build.mjs (dist/build-info.json): starts it from another working
// directory, without adb, and checks that it serves the console (login page, static files, shared module, login,
// /api/state with the baked version and commit) and keeps its data next to the executable.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build-info.json'), 'utf8'));

const port = await new Promise((resolve, reject) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = srv.address();
    srv.close(() => resolve(free));
  });
  srv.on('error', reject);
});
const base = `http://127.0.0.1:${port}`;

const child = spawn(info.executable, [], {
  cwd: os.tmpdir(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    AUTH_USERNAME: '',
    AUTH_PASSWORD: '',
    AUTO_SCAN_ON_START: 'false',
    ADB_PATH: path.join(os.tmpdir(), 'adbmime-smoke-no-adb'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal ?? code)));

let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log(`Smoke test: ${path.relative(ROOT, info.executable)} on ${base}`);
try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the executable exited with code ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error('the server did not answer within 30 s');
    try {
      if ((await fetch(`${base}/login`)).ok) break;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }

  await check('login page', async () => {
    const res = await fetch(`${base}/login`);
    expect(res.status === 200 && /<html/i.test(await res.text()), `status ${res.status}`);
  });
  await check('static files (public/)', async () => {
    const res = await fetch(`${base}/assets/styles.css`);
    expect(res.status === 200 && /css/.test(res.headers.get('content-type')), `status ${res.status}`);
  });
  let cookie = '';
  await check('login with empty credentials', async () => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' }),
    });
    cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect(res.status === 200 && cookie, `status ${res.status}`);
  });
  await check('console and shared module (src/shared/)', async () => {
    const page = await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' });
    expect(page.status === 200, `/ status ${page.status}`);
    const res = await fetch(`${base}/shared/sequence-format.js`, { headers: { cookie }, redirect: 'manual' });
    expect(res.status === 200 && /^export /m.test(await res.text()), `status ${res.status}`);
  });
  await check(`/api/state reports version ${info.version} (${info.commit})`, async () => {
    const res = await fetch(`${base}/api/state`, { headers: { cookie } });
    const state = await res.json();
    expect(res.status === 200, `status ${res.status}`);
    expect(state.version === info.version && state.commit === info.commit, `got ${state.version} (${state.commit})`);
  });
  await check('data/ created next to the executable', async () => {
    expect(fs.existsSync(path.join(info.dir, 'data')), `${path.join(info.dir, 'data')} missing`);
  });
} catch (err) {
  failed++;
  console.log(`  FAIL  startup: ${err.message}`);
} finally {
  child.kill();
  await Promise.race([exited, sleep(5000)]);
}

if (failed) {
  console.log(`\n${failed} check(s) failed. Output of the executable:\n${output}`);
  process.exit(1);
}
console.log('All checks passed.');
