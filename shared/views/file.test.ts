// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readViews, writeViews, viewsFilePath } from './file';
import { blankView } from './model';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-views-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the views file', () => {
  it('has no views until some are written', () => {
    expect(readViews(dir)).toEqual([]);
    expect(fs.existsSync(viewsFilePath(dir))).toBe(false);
  });

  it('writes and reads views back, as stable text with a trailing newline, leaving no temp file', () => {
    const views = [blankView('a', 'All notes'), blankView('b', 'Board', { layout: 'board', groupBy: 'status' })];
    expect(writeViews(dir, views)).toEqual(views);
    expect(readViews(dir)).toEqual(views);
    const text = fs.readFileSync(viewsFilePath(dir), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    writeViews(dir, readViews(dir));
    expect(fs.readFileSync(viewsFilePath(dir), 'utf8')).toBe(text);
    expect(fs.readdirSync(dir)).toEqual(['.noted-views.json']);
  });

  it('cleans what it is given, and removes the file when no view is left', () => {
    const written = writeViews(dir, [{ name: 'No id' }, { nonsense: true }]);
    expect(written).toHaveLength(1);
    expect(written[0].id).toMatch(/^v-[0-9a-f]{10}$/);
    writeViews(dir, []);
    expect(fs.existsSync(viewsFilePath(dir))).toBe(false);
  });

  it('treats a corrupt file as no views, and does not touch it', () => {
    fs.writeFileSync(viewsFilePath(dir), '{ not json');
    expect(readViews(dir)).toEqual([]);
    expect(fs.readFileSync(viewsFilePath(dir), 'utf8')).toBe('{ not json');
  });
});
