// Reading the YAML of a note's frontmatter block. Read-only: nothing here writes YAML, so the block itself stays exact bytes.
import { parse as parseYaml } from 'yaml';

/** Parse the YAML between the `---` lines of a frontmatter block. Never throws: a bad block is reported, not fatal. */
export function parseFrontmatterBlock(block: string): { data: Record<string, unknown> | null; error?: string } {
  const inner = block.replace(/^---[ \t]*\r?\n/, '').replace(/(?:^|\r?\n)---[ \t]*\r?\n?$/, '');
  try {
    const value: unknown = parseYaml(inner, { maxAliasCount: 100 });
    if (value === null || value === undefined) return { data: {} };
    if (typeof value !== 'object' || Array.isArray(value)) return { data: null, error: 'frontmatter is not a mapping' };
    return { data: value as Record<string, unknown> };
  } catch (err) {
    return { data: null, error: (err as Error).message.split('\n')[0] };
  }
}

