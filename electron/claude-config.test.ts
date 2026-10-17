// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeClaudeConfig } from './claude-config';

// Claude Desktop's configuration file belongs to Claude Desktop: Noted adds its entry and must never lose the rest.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-claude-config-'));
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

let n = 0;
const configFile = (text?: string): string => {
  const dir = path.join(root, `c${n++}`, 'Claude');
  const file = path.join(dir, 'claude_desktop_config.json');
  if (text !== undefined) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, text); }
  return file;
};
const entry = { command: 'node', args: ['/app/index.cjs', '--notes-dir', '/v'] };
const leftovers = (file: string) => fs.readdirSync(path.dirname(file)).filter(f => f.endsWith('.tmp'));

describe('writeClaudeConfig', () => {
  it('leaves a file it cannot read exactly as it was, and says so', () => {
    const text = '{ "mcpServers": { "github": { "command": "gh" } }, }';
    const file = configFile(text);
    expect(writeClaudeConfig(file, entry)).toEqual({ ok: false, reason: 'invalid' });
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });

  it('adds Noted beside the other servers, keeping the previous text as .bak', () => {
    const text = JSON.stringify({ mcpServers: { github: { command: 'gh' } }, theme: 'dark' });
    const file = configFile(text);
    expect(writeClaudeConfig(file, entry)).toEqual({ ok: true, backup: `${file}.bak` });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ mcpServers: { github: { command: 'gh' }, noted: entry }, theme: 'dark' });
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe(text);
    expect(leftovers(file)).toEqual([]);
  });

  it('creates the file (and its folder) when Claude Desktop has none yet', () => {
    const file = configFile();
    expect(writeClaudeConfig(file, entry)).toEqual({ ok: true, backup: null });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ mcpServers: { noted: entry } });
  });

  it('touches nothing when the entry is already there', () => {
    const file = configFile();
    writeClaudeConfig(file, entry);
    const mtime = fs.statSync(file).mtimeMs;
    expect(writeClaudeConfig(file, entry)).toEqual({ ok: true, backup: null });
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });
});
