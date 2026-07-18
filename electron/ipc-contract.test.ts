// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function extractBlock(source: string, startToken: string): string {
  const start = source.indexOf(startToken);
  if (start === -1) return '';
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) return '';
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  return source.slice(braceStart + 1);
}

function extractMethodNamesFromPreload(source: string): Set<string> {
  const block = extractBlock(
    source,
    "contextBridge.exposeInMainWorld('electronAPI', {"
  );
  const names = new Set<string>();
  const rx = /^\s*([A-Za-z0-9_]+)\s*:\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(block)) !== null) names.add(match[1]);
  return names;
}

function extractMethodNamesFromTypes(source: string): Set<string> {
  const block = extractBlock(source, 'electronAPI: {');
  const names = new Set<string>();
  const rx = /^\s*([A-Za-z0-9_]+)\??\s*:\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(block)) !== null) names.add(match[1]);
  return names;
}

describe('IPC contract: preload vs renderer type declarations', () => {
  it('keeps method names synchronized between preload bridge and Window.electronAPI', () => {
    const repo = process.cwd();
    const preloadPath = path.join(repo, 'electron', 'preload.ts');
    const typesPath = path.join(repo, 'src', 'types.d.ts');
    const preload = fs.readFileSync(preloadPath, 'utf8');
    const types = fs.readFileSync(typesPath, 'utf8');

    const preloadMethods = extractMethodNamesFromPreload(preload);
    const typeMethods = extractMethodNamesFromTypes(types);

    const missingInTypes = [...preloadMethods].filter((m) => !typeMethods.has(m));
    const missingInPreload = [...typeMethods].filter((m) => !preloadMethods.has(m));

    expect(missingInTypes).toEqual([]);
    expect(missingInPreload).toEqual([]);
  });
});
