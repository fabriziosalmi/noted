import { describe, expect, it } from 'vitest';
import { mcpServerArgs, shellWord, withNotedServer } from './clientConfig';

const entry = { command: 'node', args: ['/app/dist-mcp/index.cjs', '--notes-dir', '/Users/me/Notes'] };

describe('mcpServerArgs', () => {
  it('names the vault, unless it is the default one', () => {
    expect(mcpServerArgs('/s/index.cjs', '/Users/me/My Notes')).toEqual(['/s/index.cjs', '--notes-dir', '/Users/me/My Notes']);
    expect(mcpServerArgs('/s/index.cjs', null)).toEqual(['/s/index.cjs']);
    expect(mcpServerArgs('/s/index.cjs', '')).toEqual(['/s/index.cjs']);
  });
});

describe('shellWord', () => {
  it('keeps a path with spaces or quotes as one shell word', () => {
    expect(shellWord('/plain/path.cjs')).toBe('/plain/path.cjs');
    expect(shellWord('/Users/me/Mobile Documents/Notes')).toBe('"/Users/me/Mobile Documents/Notes"');
    expect(shellWord('a"b$c`d\\e')).toBe('"a\\"b\\$c\\`d\\\\e"');
  });
});

describe('withNotedServer', () => {
  it('adds Noted and keeps every other server and setting', () => {
    const before = JSON.stringify({ globalShortcut: 'Cmd+Space', mcpServers: { github: { command: 'gh-mcp', args: [] } } });
    const after = JSON.parse(withNotedServer(before, entry)!);
    expect(after).toEqual({ globalShortcut: 'Cmd+Space', mcpServers: { github: { command: 'gh-mcp', args: [] }, noted: entry } });
  });

  it('replaces an older Noted entry', () => {
    const before = JSON.stringify({ mcpServers: { noted: { command: 'node', args: ['/old.cjs'] } } });
    expect(JSON.parse(withNotedServer(before, entry)!).mcpServers.noted).toEqual(entry);
  });

  it('starts a file that does not exist or is empty', () => {
    expect(JSON.parse(withNotedServer(null, entry)!)).toEqual({ mcpServers: { noted: entry } });
    expect(JSON.parse(withNotedServer('  \n', entry)!)).toEqual({ mcpServers: { noted: entry } });
  });

  it('refuses a file it cannot read as a JSON object, rather than replacing it', () => {
    expect(withNotedServer('{ "mcpServers": { "github": {}, }, }', entry)).toBeNull(); // trailing commas
    expect(withNotedServer('// comment\n{}', entry)).toBeNull();
    expect(withNotedServer('[]', entry)).toBeNull();
    expect(withNotedServer('null', entry)).toBeNull();
    expect(withNotedServer('{"mcpServers": []}', entry)).toBeNull();
  });
});
