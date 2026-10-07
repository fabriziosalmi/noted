// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractArticle, MAX_SOURCE_CHARS } from './ingest-extract';

const prose = (n: number, word = 'word') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
const page = (body: string, head = '<title>Page title</title>') => `<!doctype html><html><head>${head}<script>var tracking = 1;</script><style>body{color:red}</style></head><body>${body}</body></html>`;

describe('extractArticle', () => {
  const html = page(`
    <header><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/blog">Blog</a></nav></header>
    <div class="cookie-banner">We use cookies. <button>Accept</button></div>
    <main>
      <article>
        <h1>A Real Title</h1>
        <p>${prose(60)}</p>
        <h2>Section</h2>
        <p>Read <a href="/docs/guide">the guide</a> and <a href="https://other.example/x">another</a>, <a href="javascript:alert(1)">trick</a>.</p>
        <ul><li>one item of a list</li><li>another item of a list</li></ul>
        <pre><code>const x = 1;</code></pre>
        <p>${prose(60, 'more')}</p>
        <figure><img src="x.png" alt="a picture"><figcaption>A caption.</figcaption></figure>
        <div class="share-buttons"><a href="#">Share</a> <a href="#">Tweet</a></div>
      </article>
      <aside>Related: <a href="/a">A</a> <a href="/b">B</a></aside>
    </main>
    <footer>Copyright <a href="/legal">Legal</a></footer>
    <script>document.write('evil')</script>`);

  it('takes the article, as Markdown, without the page around it or what runs in it', async () => {
    const a = await extractArticle(html, 'https://site.example/posts/one');
    expect(a.markdown).toContain('# A Real Title');
    expect(a.markdown).toContain('## Section');
    expect(a.markdown).toContain('word59');
    expect(a.markdown).toContain('more59');
    expect(a.markdown).toContain('-   one item of a list');
    expect(a.markdown).toContain('```\nconst x = 1;\n```');
    expect(a.markdown).toContain('A caption.');
    for (const gone of ['Home', 'About', 'cookies', 'Accept', 'Copyright', 'Related:', 'tracking', 'evil', 'Tweet', 'a picture', 'color:red']) expect(a.markdown, gone).not.toContain(gone);
    expect(a.truncated).toBe(false);
  });

  it('makes links absolute, and drops one that runs code', async () => {
    const a = await extractArticle(html, 'https://site.example/posts/one');
    expect(a.markdown).toContain('[the guide](https://site.example/docs/guide)');
    expect(a.markdown).toContain('[another](https://other.example/x)');
    expect(a.markdown).not.toContain('javascript:');
    expect(a.markdown).toContain('trick');
  });

  it('names it by the page: social title first, then the title element, then the first heading, then the site', async () => {
    const body = `<article><p>${prose(120)}</p></article>`;
    expect((await extractArticle(page(body, '<title>Plain</title><meta property="og:title" content="  Social   title ">'), 'https://s.example/')).title).toBe('Social title');
    expect((await extractArticle(page(body, '<title> Plain\n title </title>'), 'https://s.example/')).title).toBe('Plain title');
    expect((await extractArticle(page(`<h1>Heading title</h1>${body}`, ''), 'https://s.example/')).title).toBe('Heading title');
    expect((await extractArticle(page(body, ''), 'https://s.example/x')).title).toBe('s.example');
  });

  it('a page with no article takes the main part, or failing that the body, and still leaves out menus', async () => {
    const withMain = await extractArticle(page(`<nav><a href="/a">A</a> <a href="/b">B</a></nav><main><p>${prose(120)}</p></main>`), 'https://s.example/');
    expect(withMain.markdown).toContain('word119');
    expect(withMain.markdown).not.toContain('[A]');
    const bodyOnly = await extractArticle(page(`<div><a href="/x">Menu one</a> | <a href="/y">Menu two</a> | <a href="/z">Menu three</a></div><p>${prose(40)} A paragraph in the body.</p>`), 'https://s.example/');
    expect(bodyOnly.markdown).toContain('A paragraph in the body.');
    expect(bodyOnly.markdown).not.toContain('Menu one');
  });

  it('does not drop article text for being inside a header or an element that happens to be called something like noise', async () => {
    const a = await extractArticle(page(`<header><article><h1>Inside a header</h1><p>${prose(120)}</p></article></header>`), 'https://s.example/');
    expect(a.markdown).toContain('Inside a header');
    expect(a.markdown).toContain('word119');
    const b = await extractArticle(page(`<article><div class="comments-intro"><h2>About comments</h2><p>${prose(120)}</p></div></article>`), 'https://s.example/');
    expect(b.markdown).toContain('About comments'); // contains a heading: kept
  });

  it('runs nothing and loads nothing: scripts do not execute, images are not fetched', async () => {
    const a = await extractArticle(page(`<article><p>${prose(120)}</p><img src="http://127.0.0.1:1/never"><script>document.title='changed';throw new Error('ran')</script></article>`, '<title>Original</title>'), 'https://s.example/');
    expect(a.title).toBe('Original');
  });

  it('cuts a very long page, and says so', async () => {
    const a = await extractArticle(page(`<article>${Array.from({ length: 3000 }, (_, i) => `<p>${prose(30, `p${i}x`)}</p>`).join('')}</article>`), 'https://s.example/');
    expect(a.truncated).toBe(true);
    expect(a.markdown.length).toBe(MAX_SOURCE_CHARS);
  });

  it('an empty page gives nothing, not an error', async () => {
    expect(await extractArticle('', 'https://s.example/')).toMatchObject({ markdown: '', truncated: false });
    expect((await extractArticle('<html></html>', 'https://s.example/')).markdown).toBe('');
  });
});
