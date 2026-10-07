// Fetching a web page for the "note from a source" feature. The address comes from the person, but a page can redirect anywhere, and a
// name can resolve to anything: so this is where a URL must not become a way into the machine or its network. Every address
// connected to is checked at the moment of connecting (not before, which a name that changes its answer would slip through), a
// redirect is followed by hand and checked at each hop, and the size and the time are limited.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

/** What may never be reached: this machine, the local network, link-local (cloud metadata), and addresses that are not for the public internet. */
const PRIVATE = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]] as const) PRIVATE.addSubnet(net6, bits, 'ipv6');

/** Embedded IPv4 of an IPv6 address that carries one (v4-mapped, NAT64, 6to4), or null. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) { const a = parseInt(hex[1], 16); const b = parseInt(hex[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  const six = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})::?/i.exec(ip);
  if (six) { const a = parseInt(six[1], 16); const b = parseInt(six[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}

/** Is this address one a web page may be fetched from? Not private, not loopback, not link-local, and nothing malformed. */
export function isPublicAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 0) return false;
  if (kind === 4) return !PRIVATE.check(address, 'ipv4');
  const v4 = embeddedV4(address);
  if (v4 !== null) return isPublicAddress(v4);
  return !PRIVATE.check(address, 'ipv6');
}

export type FetchErrorCode = 'blocked' | 'scheme' | 'redirects' | 'too-large' | 'timeout' | 'pdf' | 'unsupported' | 'status' | 'network';

export class IngestFetchError extends Error {
  code: FetchErrorCode;
  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.name = 'IngestFetchError';
    this.code = code;
  }
}

export interface FetchedPage {
  /** Where the page was in the end, after redirects. */
  url: string;
  contentType: string;
  html: boolean;
  text: string;
}

export interface FetchDeps {
  /** Which addresses are fine to connect to (tests change it; the app uses `isPublicAddress`). */
  isPublic?: (address: string) => boolean;
  /** How a name becomes addresses (tests change it; the app asks the system). */
  resolve?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

const systemResolve = (hostname: string): Promise<string[]> =>
  new Promise((resolve, reject) => dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs.map(a => a.address)))));

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.subarray(0, 2048).toString('latin1'))?.[1];
  return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
}

function decode(body: Buffer, contentType: string): string {
  try { return new TextDecoder(charsetOf(contentType, body)).decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

interface Hop { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

/** One request, to one address that has been checked. The connection goes to that address, so what was checked is what is reached. */
function request(url: URL, address: string, family: 4 | 6, timeoutMs: number, maxBytes: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      host: address, family, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`, method: 'GET',
      servername: net.isIP(url.hostname) ? undefined : url.hostname, // TLS is for the name that was asked for, not the address
      headers: { Host: url.host, 'User-Agent': 'Mozilla/5.0 (compatible; Noted/1.6; +https://github.com/fabriziosalmi/noted)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1', 'Accept-Language': 'en,*;q=0.5' },
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { fail(new IngestFetchError('too-large', `the page is larger than ${maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / 1024 / 1024)} MB` : `${Math.round(maxBytes / 1024)} KB`}`)); return; }
        chunks.push(chunk);
      });
      res.on('end', () => { if (!done) { done = true; resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }); } });
      res.on('error', err => fail(err));
    });
    // The first thing that goes wrong is the answer; what the destroyed request says afterwards is not.
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      reject(err instanceof IngestFetchError ? err : new IngestFetchError('network', err.message));
      req.destroy();
    };
    req.setTimeout(timeoutMs, () => fail(new IngestFetchError('timeout', 'the page took too long to answer')));
    req.on('error', err => fail(err));
    req.end();
  });
}

export async function fetchPage(rawUrl: string, deps: FetchDeps = {}): Promise<FetchedPage> {
  const isPublic = deps.isPublic ?? isPublicAddress;
  const resolve = deps.resolve ?? systemResolve;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? MAX_PAGE_BYTES;
  const deadline = Date.now() + timeoutMs;

  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new IngestFetchError('scheme', 'that is not a web address'); }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IngestFetchError('scheme', 'only http and https addresses can be fetched');
    if (url.username || url.password) throw new IngestFetchError('blocked', 'an address with a user name or password is not fetched');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Every address the name leads to has to be fine: one that is not means the name is not trusted at all.
    let addresses: string[];
    try { addresses = net.isIP(host) ? [host] : await resolve(host); } catch { throw new IngestFetchError('network', `could not find ${host}`); }
    if (addresses.length === 0 || !addresses.every(isPublic)) throw new IngestFetchError('blocked', `${host} is not a public address`);
    const address = addresses[0];
    const left = deadline - Date.now();
    if (left <= 0) throw new IngestFetchError('timeout', 'the page took too long to answer');
    const res = await request(url, address, net.isIP(address) === 6 ? 6 : 4, left, maxBytes);

    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      try { url = new URL(res.headers.location, url); } catch { throw new IngestFetchError('network', 'the page redirects to an address that is not valid'); }
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new IngestFetchError('status', `the page answered ${res.status}`);
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('application/pdf') || /\.pdf($|\?)/i.test(url.pathname) && !contentType) throw new IngestFetchError('pdf', 'that is a PDF; PDFs are not read yet');
    const html = /text\/html|application\/xhtml/.test(contentType);
    if (!html && !/^text\/(plain|markdown)/.test(contentType) && contentType !== '') throw new IngestFetchError('unsupported', `a page of type ${contentType.split(';')[0]} cannot be read`);
    const text = decode(res.body, contentType);
    return { url: url.toString(), contentType, html: html || (contentType === '' && /^\s*<(!doctype|html|head|body)/i.test(text)), text };
  }
  throw new IngestFetchError('redirects', 'the page redirects too many times');
}
