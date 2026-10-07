// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { fetchPage, isPublicAddress, type IngestFetchError } from './ingest-fetch';

describe('isPublicAddress', () => {
  it('refuses this machine, the local network, link-local (cloud metadata) and every other range that is not the public internet', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1',
      '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1']) expect(isPublicAddress(ip), ip).toBe(false);
  });
  it('refuses an IPv6 address that only wraps a private IPv4 one (mapped, NAT64, 6to4), in either spelling', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:c0a8:101::1']) expect(isPublicAddress(ip), ip).toBe(false);
  });
  it('allows addresses of the public internet', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('is false for anything that is not an address', () => {
    for (const x of ['', 'example.com', '999.1.1.1', '1.2.3', 'localhost']) expect(isPublicAddress(x), x).toBe(false);
  });
});

// A real server on this machine, treated as "public" through the injected guard, so the fetching can be tested end to end.
let server: http.Server;
let port: number;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
const seen: string[] = [];
const deps = { isPublic: (a: string) => a === '127.0.0.1', resolve: async () => ['127.0.0.1'] };
beforeEach(async () => {
  seen.length = 0;
  server = http.createServer((req, res) => { seen.push(`${req.headers.host} ${req.url}`); handler(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
const url = (p = '/') => `http://example.test:${port}${p}`;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as IngestFetchError; } throw new Error('did not fail'); };

describe('fetchPage', () => {
  it('fetches an HTML page, as text, and says where it was and what it was', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html><body><h1>Héllo</h1></body></html>'); };
    const page = await fetchPage(url('/a?x=1'), deps);
    expect(page).toMatchObject({ url: url('/a?x=1'), html: true, text: '<html><body><h1>Héllo</h1></body></html>' });
    expect(seen).toEqual([`example.test:${port} /a?x=1`]); // the Host is the name asked for, the connection went to the checked address
  });

  it('reads plain text, and the character set the page says', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' }); res.end(Buffer.from('caffè', 'latin1')); };
    expect(await fetchPage(url(), deps)).toMatchObject({ html: false, text: 'caffè' });
  });

  it('takes a page with no type that looks like HTML for HTML, and one that does not for text', async () => {
    handler = (_req, res) => { res.writeHead(200); res.end('<!doctype html><title>x</title>'); };
    expect((await fetchPage(url(), deps)).html).toBe(true);
    handler = (_req, res) => { res.writeHead(200); res.end('just words'); };
    expect((await fetchPage(url(), deps)).html).toBe(false);
  });

  it('follows redirects, by hand, to the end', async () => {
    handler = (req, res) => {
      if (req.url === '/') { res.writeHead(301, { location: '/two' }); res.end(); }
      else if (req.url === '/two') { res.writeHead(302, { location: `http://example.test:${port}/three` }); res.end(); }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('arrived'); }
    };
    expect(await fetchPage(url(), deps)).toMatchObject({ url: url('/three'), text: 'arrived' });
  });

  it('a redirect to an address that is not public is refused, even though the page it came from was fine', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: 'http://metadata.test/latest/meta-data/' }); res.end(); };
    const err = await fails(fetchPage(url(), { isPublic: a => a === '127.0.0.1', resolve: async h => (h === 'metadata.test' ? ['169.254.169.254'] : ['127.0.0.1']) }));
    expect(err).toMatchObject({ code: 'blocked' });
    expect(seen).toHaveLength(1); // the second request was never made
  });

  it('a name that has any address that is not public is refused (one good answer does not vouch for the rest)', async () => {
    handler = (_req, res) => { res.writeHead(200); res.end('x'); };
    expect(await fails(fetchPage(url(), { isPublic: a => a === '127.0.0.1', resolve: async () => ['127.0.0.1', '10.0.0.1'] }))).toMatchObject({ code: 'blocked' });
    expect(seen).toEqual([]);
  });

  it('refuses an address given as a number that is not public, whatever the way it is written', async () => {
    handler = (_req, res) => { res.writeHead(200); res.end('x'); };
    for (const bad of ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/', 'http://10.1.2.3:8080/', 'http://localhost/']) {
      const err = await fails(fetchPage(bad)); // the real guard
      expect(['blocked', 'network'], bad).toContain(err.code);
    }
    expect(seen).toEqual([]);
  });

  it('refuses what is not a web address: other schemes, a name and a password', async () => {
    for (const bad of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url', '']) expect(await fails(fetchPage(bad, deps)), bad).toMatchObject({ code: 'scheme' });
    expect(await fails(fetchPage(`http://user:pass@example.test:${port}/`, deps))).toMatchObject({ code: 'blocked' });
  });

  it('gives up on redirects that never end', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: '/again' }); res.end(); };
    expect(await fails(fetchPage(url(), deps))).toMatchObject({ code: 'redirects' });
  });

  it('refuses a page that is too large, without reading all of it', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('x'.repeat(2000)); res.write('y'.repeat(2000)); res.end(); };
    expect(await fails(fetchPage(url(), { ...deps, maxBytes: 1000 }))).toMatchObject({ code: 'too-large' });
  });

  it('gives up on a page that does not answer', async () => {
    handler = () => { /* never answers */ };
    expect(await fails(fetchPage(url(), { ...deps, timeoutMs: 150 }))).toMatchObject({ code: 'timeout' });
  });

  it('says what it cannot read: a PDF, an image, an error page', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF'); };
    expect(await fails(fetchPage(url('/x.pdf'), deps))).toMatchObject({ code: 'pdf' });
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end('x'); };
    expect(await fails(fetchPage(url(), deps))).toMatchObject({ code: 'unsupported' });
    handler = (_req, res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('gone'); };
    expect(await fails(fetchPage(url(), deps))).toMatchObject({ code: 'status', message: 'the page answered 404' });
  });

  it('an unknown name is reported as such', async () => {
    expect(await fails(fetchPage('http://no-such-host.invalid/', { isPublic: () => true }))).toMatchObject({ code: 'network' });
  });

  it('does not ask for a compressed body it would have to unpack (so it cannot be made to inflate one)', async () => {
    let asked = '';
    handler = (req, res) => { asked = String(req.headers['accept-encoding'] ?? ''); res.writeHead(200, { 'content-type': 'text/plain' }); res.end(zlib.gzipSync('x')); };
    await fetchPage(url(), deps).catch(() => undefined);
    expect(asked).toBe('');
  });
});
