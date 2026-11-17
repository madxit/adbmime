#!/usr/bin/env node
// Builds AdbMime as a self-contained executable for the current platform (Node.js single executable application):
// the PC running it needs no Node.js installation.
//
//   1. esbuild bundles src/server.js and its npm dependencies into a single CommonJS file;
//   2. `node --build-sea` embeds the bundle into a copy of the Node.js binary (official build, Node.js >= 25.5);
//   3. the executable is packaged with what it serves from disk (public/, src/shared/), .env.example, the README
//      and the third-party licenses.
//
// Output in dist/: adbmime-<version>-<os>-<arch>/ (the package), its archive (.zip on Windows, .tar.gz elsewhere)
// with a .sha256 file, and build-info.json (read by scripts/smoke-test.mjs).
// In GitHub Actions on a tag (Release-X.Y.Z or vX.Y.Z) the version comes from the tag.
// SEA_NODE=/path/to/node builds with another Node.js binary: Homebrew's node, for instance, is compiled without
// single executable support, so use the official one from nodejs.org.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, 'bundle');
const CI = Boolean(process.env.GITHUB_ACTIONS);

const log = (msg) => console.log(`[build] ${msg}`);
const warn = (msg) => console.warn(CI ? `::warning::${msg}` : `[build] warning: ${msg}`);
function fail(msg) {
  console.error(CI ? `::error::${msg.replace(/\n/g, '%0A')}` : `[build] error: ${msg}`);
  process.exit(1);
}

/** Runs a command and returns its trimmed stdout; throws with stdout+stderr on failure. */
function run(cmd, args, env) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } }).trim();
  } catch (err) {
    err.message = `${cmd} ${args.join(' ')}\n${`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message}`;
    throw err;
  }
}
const tryRun = (cmd, args) => {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- what to build

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const seaNode = process.env.SEA_NODE || process.execPath;
const target = JSON.parse(
  run(seaNode, ['-p', 'JSON.stringify({ node: process.versions.node, platform: process.platform, arch: process.arch })']),
);
const [major, minor] = target.node.split('.').map(Number);
if (major < 25 || (major === 25 && minor < 5)) {
  fail(`Node.js ${target.node} cannot build single executables: 25.5 or later is required (official build).`);
}

let version = pkg.version;
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '';
if (tag) {
  const fromTag = tag.replace(/^(release[-_]?|v)/i, '');
  if (!/^\d+\.\d+\.\d+([-+][\w.+-]+)?$/.test(fromTag)) {
    warn(`Tag ${tag} contains no version: using package.json version ${version}.`);
  } else {
    if (fromTag !== version) warn(`Tag ${tag} does not match package.json version ${version}: the build uses ${fromTag}.`);
    version = fromTag;
  }
}
const sha = tryRun('git', ['rev-parse', 'HEAD']) || process.env.GITHUB_SHA;
const status = tryRun('git', ['status', '--porcelain', '--untracked-files=no']);
const buildInfo = { version, commit: sha ? sha.slice(0, 7) : null, dirty: status === null ? null : status !== '' };

const isWindows = target.platform === 'win32';
const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[target.platform] ?? target.platform;
const name = `adbmime-${version}-${osName}-${target.arch}`;
const outDir = path.join(DIST, name);
const exe = path.join(outDir, isWindows ? 'adbmime.exe' : 'adbmime');

log(`${name} (commit ${buildInfo.commit ?? 'unknown'}${buildInfo.dirty ? ', uncommitted changes' : ''}, Node.js ${target.node})`);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- 1. bundle

const bundle = path.join(WORK, 'server.cjs');
const { metafile } = await esbuild.build({
  absWorkingDir: ROOT, // metafile paths (used for the licenses) are relative to it
  entryPoints: [path.join(ROOT, 'src', 'server.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${major}`,
  define: {
    // version.js: no package.json or .git next to the executable.
    __ADBMIME_BUILD__: JSON.stringify(buildInfo),
    // config.js reads import.meta.url only when not running as an executable: this keeps the bundle runnable
    // with plain `node dist/bundle/server.cjs` too.
    'import.meta.url': '__adbmimeImportMetaUrl',
  },
  banner: { js: 'const __adbmimeImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  // Express can load template engines by name; AdbMime renders no views.
  logOverride: { 'unsupported-require-call': 'silent' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});
log(`bundle: ${(fs.statSync(bundle).size / 1024).toFixed(0)} KB`);

// ---------------------------------------------------------------- 2. executable

/** Copy of the Node.js binary without its Authenticode signature, which embedding the app would invalidate. */
function unsignedNodeCopy() {
  const copy = path.join(WORK, 'node.exe');
  fs.copyFileSync(seaNode, copy);
  const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const signtool = (fs.existsSync(kits) ? fs.readdirSync(kits) : [])
    .filter((v) => /^\d+(\.\d+)+$/.test(v))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .map((v) => path.join(kits, v, target.arch === 'arm64' ? 'arm64' : 'x64', 'signtool.exe'))
    .find((p) => fs.existsSync(p));
  try {
    if (!signtool) throw new Error('signtool.exe (Windows SDK) not found');
    run(signtool, ['remove', '/s', copy]);
  } catch (err) {
    warn(`Cannot remove the Node.js signature (${err.message.split('\n')[0]}): adbmime.exe keeps an invalid one.`);
  }
  return copy;
}

const seaConfig = path.join(WORK, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: bundle,
      output: exe,
      disableExperimentalSEAWarning: true,
      ...(isWindows && { executable: unsignedNodeCopy() }),
    },
    null,
    2,
  ),
);
try {
  run(seaNode, ['--build-sea', seaConfig]);
} catch (err) {
  if (/disabled/i.test(err.message)) {
    fail(`${seaNode} is built without single executable support (e.g. Homebrew's node): use the official Node.js from nodejs.org, e.g. SEA_NODE=/path/to/node npm run build`);
  }
  fail(`node --build-sea failed: ${err.message}`);
}
if (target.platform === 'darwin') {
  // --build-sea drops Node's signature and macOS only runs signed code: sign ad hoc.
  run('codesign', ['--sign', '-', '--force', exe]);
}
if (!isWindows) fs.chmodSync(exe, 0o755);
log(`executable: ${path.relative(ROOT, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);

// ---------------------------------------------------------------- 3. package

const noJunk = (src) => !/(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(src);
fs.cpSync(path.join(ROOT, 'public'), path.join(outDir, 'public'), { recursive: true, filter: noJunk });
fs.cpSync(path.join(ROOT, 'src', 'shared'), path.join(outDir, 'src', 'shared'), { recursive: true, filter: noJunk });
for (const file of ['.env.example', 'README.md']) fs.copyFileSync(path.join(ROOT, file), path.join(outDir, file));
fs.writeFileSync(path.join(outDir, 'THIRD-PARTY-NOTICES.txt'), await thirdPartyNotices());

const archive = path.join(DIST, `${name}${isWindows ? '.zip' : '.tar.gz'}`);
if (isWindows) {
  // Windows' own tar (libarchive) writes zip files; Git's GNU tar earlier in PATH cannot.
  run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', archive, '-C', DIST, name]);
} else {
  // COPYFILE_DISABLE: no macOS ._* metadata files in the archive.
  run('tar', ['-czf', archive, '-C', DIST, name], { COPYFILE_DISABLE: '1' });
}
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
log(`archive: ${path.relative(ROOT, archive)} (${(fs.statSync(archive).size / 1048576).toFixed(1)} MB)`);

fs.writeFileSync(
  path.join(DIST, 'build-info.json'),
  JSON.stringify({ ...buildInfo, name, node: target.node, dir: outDir, executable: exe, archive }, null, 2),
);

// ---------------------------------------------------------------- licenses

/** Licenses of the Node.js runtime and of the npm packages inside the bundle (MIT and friends require them). */
async function thirdPartyNotices() {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const dir = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
    if (!dir || packages.has(dir)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(path.join(ROOT, dir)).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    packages.set(dir, {
      name: meta.name,
      version: meta.version,
      license: meta.license ?? meta.licenses?.map((l) => l.type).join(' OR '), // old packages: `licenses` array
      text: file ? fs.readFileSync(path.join(ROOT, dir, file), 'utf8').trim() : null,
    });
  }
  const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));

  const sep = `\n\n${'='.repeat(78)}\n`;
  const parts = [
    `AdbMime ${version} includes third-party software, listed below with its license.\n\n` +
      `- Node.js ${target.node}: the runtime embedded in the executable (MIT and others)\n` +
      list.map((p) => `- ${p.name} ${p.version} (${p.license ?? 'see below'})`).join('\n') +
      '\n- Twemoji flags in public/assets/flags/: graphics © Twitter/X and other contributors, CC-BY 4.0,\n' +
      '  https://github.com/jdecked/twemoji, https://creativecommons.org/licenses/by/4.0/',
    ...list.map((p) => `${p.name} ${p.version}\n\n${p.text ?? `License: ${p.license ?? 'unknown'}`}`),
    `Node.js ${target.node}\n\n${await nodeLicense()}`,
  ];
  return `${parts.join(sep)}\n`;
}

async function nodeLicense() {
  // Official builds ship LICENSE in the install root (next to node.exe, or one level above bin/node).
  const bin = path.dirname(fs.realpathSync(seaNode));
  for (const file of [path.join(bin, 'LICENSE'), path.join(bin, '..', 'LICENSE')]) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  }
  const url = `https://raw.githubusercontent.com/nodejs/node/v${target.node}/LICENSE`;
  try {
    const res = await fetch(url);
    if (res.ok) return (await res.text()).trim();
  } catch {
    /* fall through */
  }
  warn(`Node.js license not found locally nor at ${url}: THIRD-PARTY-NOTICES.txt links it instead.`);
  return `See ${url}`;
}
