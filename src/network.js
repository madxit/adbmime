// Network helpers: local subnet detection, TCP port probing and subnet scanning.
import net from 'node:net';
import os from 'node:os';
import { config } from './config.js';
import { t } from './i18n.js';

const ipToInt = (ip) => ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
const maskToPrefix = (mask) =>
  ipToInt(mask).toString(2).split('').filter((b) => b === '1').length;

export const isIPv4 = (s) => net.isIPv4(String(s));

/** Non-internal IPv4 interfaces of this machine: [{ name, address, prefix }]. */
export function localInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address, prefix: maskToPrefix(a.netmask) });
    }
  }
  return out;
}

/** Parse "a.b.c.d/nn" into { network, prefix, cidr }. */
export function parseCidr(cidr) {
  const [ip, p] = String(cidr).trim().split('/');
  const prefix = p === undefined ? 32 : Number(p);
  if (!isIPv4(ip) || !Number.isInteger(prefix) || prefix < 16 || prefix > 32) {
    throw new Error(t('badSubnet', { cidr }));
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipToInt(ip) & mask) >>> 0;
  return { network, prefix, cidr: `${intToIp(network)}/${prefix}` };
}

/** Subnets to scan: configured ones, or the /24 around each local interface. */
export function scanSubnets() {
  if (config.scanSubnets.length) return config.scanSubnets.map((c) => parseCidr(c).cidr);
  const set = new Set();
  for (const i of localInterfaces()) {
    // Never auto-scan huge networks: clamp to the host's /24.
    set.add(parseCidr(`${i.address}/${Math.max(i.prefix, 24)}`).cidr);
  }
  return [...set];
}

/** Expand a CIDR into its host addresses (network/broadcast excluded when prefix < 31). */
export function hostsOf(cidr) {
  const { network, prefix } = parseCidr(cidr);
  const size = 2 ** (32 - prefix);
  if (size <= 2) return Array.from({ length: size }, (_, i) => intToIp(network + i));
  return Array.from({ length: size - 2 }, (_, i) => intToIp(network + i + 1));
}

export function cidrContains(cidr, ip) {
  const { network, prefix } = parseCidr(cidr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === network;
}

/** Resolve true if a TCP connection to ip:port succeeds within the timeout. */
export function probe(ip, port, timeout = config.scanTimeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });
}

/** Run `fn` over `items` with at most `limit` concurrent executions. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Local address of this PC on the same subnet as `remoteIp` (fallback: first interface). */
export function localAddressFor(remoteIp) {
  const ifaces = localInterfaces();
  if (isIPv4(remoteIp)) {
    const match = ifaces.find((i) => cidrContains(`${i.address}/${i.prefix}`, remoteIp));
    if (match) return match.address;
  }
  return ifaces[0]?.address ?? '127.0.0.1';
}

/** Base URL the given board should use to reach this server. */
export function publicBaseUrlFor(remoteIp) {
  return config.publicBaseUrl || `http://${localAddressFor(remoteIp)}:${config.port}`;
}
