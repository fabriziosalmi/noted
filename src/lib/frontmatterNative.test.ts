import { describe, expect, it } from 'vitest';
import { convertHtmlNote } from '../../shared/markdown/migrate';
import { frontmatterToHtmlComment } from '../../shared/markdown/frontmatter';
import { diskToWire, wireToDisk } from './noteIo';

// Issue #61: frontmatter is a standard YAML block on disk. The `noted-frontmatter` comment is only the
// editor-side carrier (the editor is fed HTML) and what vaults written before the Markdown format hold.
const ODD = [
  '---',
  'title:   Spaced   out',
  '# a comment the user wrote',
  'tags: [a,   b]',
  'x-custom:',
  '  nested: {k: v}',
  "quoted: 'it''s'",
  'multi: |',
  '  line one',
  '    indented two',
  '---',
].join('\n');

describe('native YAML frontmatter (#61)', () => {
  it('a Markdown note keeps its YAML block byte for byte through the editor and back', () => {
    const disk = `${ODD}\n\n# Title\n\nbody text\n`;
    const wire = diskToWire(disk, 'markdown');
    expect(wire).toContain('<!--noted-frontmatter:'); // the carrier inside the app only
    expect(wireToDisk(wire, 'markdown')).toBe(disk);
  });

  it('unknown keys, comments and odd spacing are not interpreted or reformatted', () => {
    const disk = `${ODD}\n\n# T\n`;
    const out = wireToDisk(diskToWire(disk, 'markdown'), 'markdown');
    expect(out.startsWith(`${ODD}\n`)).toBe(true);
    expect(out).toContain('# a comment the user wrote');
    expect(out).toContain('nested: {k: v}');
  });

  it('a note saved to a Markdown vault never holds the comment', () => {
    const wire = `${frontmatterToHtmlComment(ODD)}\n<h1>T</h1><p>x</p>`;
    const disk = wireToDisk(wire, 'markdown');
    expect(disk).not.toContain('noted-frontmatter');
    expect(disk).toBe(`${ODD}\n\n# T\n\nx\n`);
  });

  it('a note written by an earlier version (the comment) is converted to a YAML block', () => {
    const legacy = `${frontmatterToHtmlComment(ODD)}\n<h1>Old</h1><p>text</p>`;
    const converted = convertHtmlNote(legacy, { document, DOMParser });
    expect(converted.text).toBe(`${ODD}\n\n# Old\n\ntext\n`);
    expect(converted.verdict).toBe('exact');
  });

  it('a note without frontmatter gains none', () => {
    expect(wireToDisk(diskToWire('# T\n', 'markdown'), 'markdown')).toBe('# T\n');
  });
});
