// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  detectImage, isValidAttachmentsFolder, attachmentName, isLocalImageRef, normalizeImageRef, localImageRefs,
  parseDataImageUri, extractDataImages, inlineLocalImages, imageTypeFromExt,
} from './attachments';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const uri = (b: Uint8Array, mime = 'image/png') => `data:${mime};base64,${b64(b)}`;

describe('detectImage', () => {
  it('recognises the stored formats from their bytes', () => {
    expect(detectImage(PNG)?.ext).toBe('png');
    expect(detectImage(JPG)?.ext).toBe('jpg');
    expect(detectImage(GIF)?.ext).toBe('gif');
    expect(detectImage(WEBP)?.ext).toBe('webp');
  });
  it('refuses everything else, including an SVG or HTML posing as an image', () => {
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImage(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectImage(new Uint8Array([]))).toBeNull();
    expect(detectImage(Uint8Array.from([0x89, 0x50]))).toBeNull(); // truncated header
    expect(detectImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // RIFF WAVE
  });
});

describe('names and folders', () => {
  it('names an attachment from its content hash', () => {
    expect(attachmentName('a'.repeat(64), 'png')).toBe(`${'a'.repeat(32)}.png`);
  });
  it('accepts a plain single-segment folder and nothing that could escape or hide', () => {
    for (const ok of ['attachments', 'Images', 'my pics', 'a_b-c']) expect(isValidAttachmentsFolder(ok), ok).toBe(true);
    for (const bad of ['', '.hidden', '..', 'a/b', 'a\\b', '/abs', 'x'.repeat(65), 'con', 'NUL', '-x', 5, null, 'a\0b']) {
      expect(isValidAttachmentsFolder(bad), String(bad)).toBe(false);
    }
  });
  it('maps extensions to types', () => {
    expect(imageTypeFromExt('JPEG')?.ext).toBe('jpg');
    expect(imageTypeFromExt('.png')?.mime).toBe('image/png');
    expect(imageTypeFromExt('svg')).toBeNull();
  });
});

describe('isLocalImageRef / normalizeImageRef', () => {
  it('accepts vault-relative image paths', () => {
    for (const ok of ['attachments/a.png', 'img/x.JPG', 'pic.webp', 'a b/c.gif']) expect(isLocalImageRef(ok), ok).toBe(true);
  });
  it('rejects URLs, data URIs, absolute paths, traversal, and non-images', () => {
    for (const bad of ['https://x/a.png', 'app://./a.png', 'data:image/png;base64,AAA', 'file:///etc/a.png', '/etc/a.png', '//host/a.png',
      '../a.png', 'a/../b.png', 'a//b.png', 'a\\b.png', 'a.svg', 'a.txt', 'noext', '', 'a\0.png', 'C:/x.png']) {
      expect(isLocalImageRef(bad), bad).toBe(false);
    }
  });
  it('normalises entities, percent-encoding, queries and fragments', () => {
    expect(normalizeImageRef('attachments/a%20b.png?x=1#y')).toBe('attachments/a b.png');
    expect(normalizeImageRef('attachments/a&amp;b.png')).toBe('attachments/a&b.png');
    expect(normalizeImageRef('%2e%2e/a.png')).toBeNull();
    expect(normalizeImageRef('./attachments/./a.png')).toBe('attachments/a.png');
  });
});

describe('localImageRefs', () => {
  it('finds HTML and Markdown references, once each, skipping remote and embedded images', () => {
    const raw = `<p><img src="attachments/a.png"> <img alt="x" src='attachments/b.jpg'/> <img src="https://x/c.png"> <img src="${uri(PNG)}">
      <img src="attachments/a.png"></p>\n![d](attachments/d.webp "title") ![e](<attachments/e.gif>) ![f](https://x/f.png)`;
    expect(localImageRefs(raw)).toEqual(['attachments/a.png', 'attachments/b.jpg', 'attachments/d.webp', 'attachments/e.gif']);
  });
  it('ignores text that merely looks like a path', () => {
    expect(localImageRefs('<p>see attachments/a.png</p><a href="attachments/a.png">link</a>')).toEqual([]);
  });
});

describe('parseDataImageUri', () => {
  it('decodes a real image data URI and trusts the bytes over the declared type', () => {
    expect(parseDataImageUri(uri(PNG))?.type.ext).toBe('png');
    expect(parseDataImageUri(uri(JPG, 'image/png'))?.type.ext).toBe('jpg'); // claimed PNG, is JPEG
  });
  it('refuses non-images and malformed URIs', () => {
    expect(parseDataImageUri(uri(Buffer.from('<svg/>'), 'image/png'))).toBeNull();
    expect(parseDataImageUri('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(parseDataImageUri('data:text/html;base64,AAAA')).toBeNull();
    expect(parseDataImageUri('https://x/a.png')).toBeNull();
  });
});

describe('extractDataImages', () => {
  const store = (calls: { n: number }) => (bytes: Uint8Array, type: { ext: string }) => { calls.n++; return `attachments/${b64(bytes).slice(0, 4).replace(/[^A-Za-z0-9]/g, 'x')}.${type.ext}`; };

  it('replaces HTML and Markdown embedded images with paths and reports what it removed', () => {
    const raw = `<p>hi <img src="${uri(PNG)}" alt="a"> and <img src='${uri(GIF, 'image/gif')}'></p>\n![md](${uri(JPG, 'image/jpeg')})`;
    const calls = { n: 0 };
    const out = extractDataImages(raw, store(calls));
    expect(out.images).toBe(3);
    expect(calls.n).toBe(3);
    expect(out.bytes).toBeGreaterThan(30);
    expect(out.content).not.toContain('base64');
    expect(out.content).toMatch(/<img src="attachments\/[^"]+\.png" alt="a">/);
    expect(out.content).toMatch(/!\[md\]\(attachments\/[^)]+\.jpg\)/);
  });

  it('leaves an image alone when the store cannot save it, and non-image data URIs too', () => {
    const raw = `<img src="${uri(PNG)}"><img src="data:image/svg+xml;base64,AAAA">`;
    const out = extractDataImages(raw, () => null);
    expect(out.content).toBe(raw);
    expect(out.images).toBe(0);
  });

  it('does not touch unrelated text or attributes', () => {
    const raw = '<p style="background:url(data:image/png;base64,AAAA)">x</p><a href="data:image/png;base64,AAAA">y</a>';
    expect(extractDataImages(raw, () => 'x.png').content).toBe(raw);
  });

  it('round-trips: extract then inline gives back images with the same bytes', () => {
    const raw = `<p><img src="${uri(PNG)}"></p>`;
    const files = new Map<string, { bytes: Uint8Array; type: ReturnType<typeof detectImage> & object }>();
    const out = extractDataImages(raw, (bytes, type) => { const rel = 'attachments/x.png'; files.set(rel, { bytes, type }); return rel; });
    const back = inlineLocalImages(out.content, rel => files.get(rel) ?? null);
    expect(back).toBe(raw);
  });
});

describe('inlineLocalImages', () => {
  const read = (rel: string) => (rel === 'attachments/a.png' ? { bytes: PNG, type: detectImage(PNG)! } : null);
  it('turns local images into data URIs, leaves missing ones and remote ones alone', () => {
    const raw = '<img src="attachments/a.png"><img src="attachments/missing.png"><img src="https://x/a.png">![m](attachments/a.png)';
    const out = inlineLocalImages(raw, read);
    expect(out).toContain(`<img src="${uri(PNG)}">`);
    expect(out).toContain('<img src="attachments/missing.png">');
    expect(out).toContain('<img src="https://x/a.png">');
    expect(out).toContain(`![m](${uri(PNG)})`);
  });
  it('never asks for a path that escapes the vault', () => {
    const asked: string[] = [];
    inlineLocalImages('<img src="../../etc/a.png"><img src="/etc/a.png"><img src="%2e%2e/a.png">', rel => { asked.push(rel); return null; });
    expect(asked).toEqual([]);
  });
});
