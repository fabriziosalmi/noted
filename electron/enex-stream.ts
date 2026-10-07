// Reads an Evernote export (.enex) as a stream: one note at a time, so a notebook of many hundreds of megabytes of attachments is never in
// memory whole. The export is XML; ENML (the note's own text) is a CDATA string inside it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import sax from 'sax';

export interface EnexResource { data: Buffer; mime: string; fileName: string; /** MD5 of the bytes: what <en-media hash> names. */ hash: string }

export interface EnexNote {
  title: string;
  created: string;
  updated: string;
  tags: string[];
  sourceUrl: string;
  author: string;
  /** ENML. */
  content: string;
  resources: EnexResource[];
}

export class EnexError extends Error {}

interface Open { title: string; created: string; updated: string; tags: string[]; sourceUrl: string; author: string; content: string; resources: EnexResource[] }
interface OpenResource { data: string[]; mime: string; fileName: string }

/** Every note in the file, in order. Throws EnexError when the file is not an Evernote export, or is cut short. */
export async function* readEnex(file: string, chunkBytes = 1 << 20): AsyncGenerator<EnexNote> {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const path: string[] = [];
  let note: Open | null = null;
  let resource: OpenResource | null = null;
  let text = '';
  let sawRoot = false;
  let failure: Error | null = null;
  const ready: EnexNote[] = [];

  parser.onerror = (err) => { failure = failure ?? err; };
  parser.onopentag = (tag) => {
    path.push(tag.name);
    if (path.length === 1) {
      if (tag.name !== 'en-export') failure = new EnexError('This is not an Evernote export (.enex) file');
      sawRoot = true;
    }
    text = '';
    if (tag.name === 'note' && path.length === 2) note = { title: '', created: '', updated: '', tags: [], sourceUrl: '', author: '', content: '', resources: [] };
    if (tag.name === 'resource' && note) resource = { data: [], mime: '', fileName: '' };
  };
  parser.ontext = (t) => { text += t; };
  parser.oncdata = (t) => { text += t; };
  parser.onclosetag = (name) => {
    const here = path.join('/');
    path.pop();
    if (!note) return;
    if (resource) {
      if (name === 'data') resource.data.push(text.replace(/\s+/g, ''));
      else if (name === 'mime') resource.mime = text.trim();
      else if (name === 'file-name') resource.fileName = text.trim();
      else if (name === 'resource') {
        const data = Buffer.from(resource.data.join(''), 'base64');
        note.resources.push({ data, mime: resource.mime, fileName: resource.fileName, hash: crypto.createHash('md5').update(data).digest('hex') });
        resource = null;
      }
      text = '';
      return;
    }
    if (here === 'en-export/note/title') note.title = text.trim();
    else if (here === 'en-export/note/created') note.created = text.trim();
    else if (here === 'en-export/note/updated') note.updated = text.trim();
    else if (here === 'en-export/note/tag') { if (text.trim()) note.tags.push(text.trim()); }
    else if (here === 'en-export/note/content') note.content = text;
    else if (here === 'en-export/note/note-attributes/source-url') note.sourceUrl = text.trim();
    else if (here === 'en-export/note/note-attributes/author') note.author = text.trim();
    else if (here === 'en-export/note') { ready.push(note); note = null; }
    text = '';
  };

  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: chunkBytes });
  try {
    for await (const chunk of stream) {
      parser.write(chunk as string);
      if (failure) throw failure;
      while (ready.length) yield ready.shift()!;
    }
    parser.close();
    if (failure) throw failure;
    if (!sawRoot) throw new EnexError('This file is empty, or is not an Evernote export (.enex)');
    if (path.length > 0) throw new EnexError('The export is cut short');
    while (ready.length) yield ready.shift()!;
  } finally {
    stream.destroy();
  }
}
