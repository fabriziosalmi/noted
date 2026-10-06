import { describe, expect, it } from 'vitest';
import { claudeDesktopConfigPath, revealLabelKey } from './platform';
import en from '../locales/en.json';

describe('per-OS wording', () => {
  it('names the file manager of each OS', () => {
    expect(revealLabelKey('mac')).toBe('mcpRevealInFinder');
    expect(revealLabelKey('windows')).toBe('mcpRevealInExplorer');
    expect(revealLabelKey('linux')).toBe('mcpRevealInFileManager');
    for (const os of ['mac', 'windows', 'linux'] as const) expect(en).toHaveProperty(revealLabelKey(os));
  });

  it('gives the Claude Desktop config path of each OS', () => {
    expect(claudeDesktopConfigPath('mac')).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
    expect(claudeDesktopConfigPath('windows')).toBe('%APPDATA%\\Claude\\claude_desktop_config.json');
    expect(claudeDesktopConfigPath('linux')).toBe('~/.config/Claude/claude_desktop_config.json');
  });

  it('the hint is a template, so no OS path is baked into a translation', () => {
    expect(en.mcpClientClaudeDesktopHint).toContain('{path}');
    expect(en.mcpClientClaudeDesktopHint).not.toContain('Library');
  });
});
