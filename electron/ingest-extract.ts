// The readable part of a web page, as Markdown: what a person would call "the article", without the menus, the footers, the scripts and the
// advertisements around it. The page is parsed (jsdom) but nothing in it is run and nothing it refers to is loaded.

import TurndownService from 'turndown';

export const MAX_SOURCE_CHARS = 200_000;

export interface Article {
  title: string;
  markdown: string;
  /** The text was cut at MAX_SOURCE_CHARS. */
  truncated: boolean;
}

const NEVER = 'script, style, noscript, template, svg, canvas, iframe, object, embed, form, button, input, select, textarea, link, meta, dialog, picture, img, video, audio, map';
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [aria-hidden="true"], [hidden]';
// Things pages put around their text under many names. Narrow on purpose: wrongly dropping part of the article is worse than keeping a banner.
const NOISE = /(^|[\s_-])(cookie|consent|newsletter|subscribe|advert|ads?|sponsor|share|social|breadcrumbs?|comments?|related-posts|paywall|popup|modal)($|[\s_-])/i;

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const textOf = (el: Element): string => clean(el.textContent);

/** A block that is mostly links is navigation (a menu, a list of tags), not prose. */
function linkDense(el: Element): boolean {
  const total = textOf(el).length;
  if (total === 0 || total > 800) return false;
  const links = Array.from(el.querySelectorAll('a')).reduce((n, a) => n + textOf(a).length, 0);
  return links / total > 0.7;
}

export async function extractArticle(html: string, pageUrl: string): Promise<Article> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html, { url: pageUrl });
  const doc = dom.window.document;
  const host = (() => { try { return new URL(pageUrl).hostname; } catch { return pageUrl; } })();

  const title = clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'))
    || clean(doc.querySelector('title')?.textContent)
    || clean(doc.querySelector('h1')?.textContent)
    || host;

  // The links are made absolute while the page still knows where it is.
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (/^\s*(javascript|data|vbscript):/i.test(href)) a.removeAttribute('href');
    else { try { a.setAttribute('href', new URL(href, pageUrl).toString()); } catch { a.removeAttribute('href'); } }
  }

  for (const el of Array.from(doc.querySelectorAll(NEVER))) el.remove();
  const articles = Array.from(doc.querySelectorAll('article'));
  const biggest = articles.sort((a, b) => textOf(b).length - textOf(a).length)[0];
  const main = doc.querySelector('main, [role="main"]');
  const root = (biggest && textOf(biggest).length >= 500 ? biggest : null) ?? (main && textOf(main).length >= 500 ? main : null) ?? doc.body;
  if (!root) return { title, markdown: '', truncated: false };

  // The page's own furniture goes, except where the article itself is inside it (a page that wraps everything in a <header> or <aside>).
  for (const el of Array.from(root.querySelectorAll(CHROME))) if (!el.contains(root)) el.remove();
  for (const el of Array.from(root.querySelectorAll('[class], [id]'))) {
    if (el === root || el.contains(root) || el.querySelector('h1, h2, article')) continue;
    if (NOISE.test(`${el.getAttribute('class') ?? ''} ${el.id}`)) el.remove();
  }
  for (const el of Array.from(root.querySelectorAll('ul, ol, div, section'))) if (el !== root && linkDense(el)) el.remove();

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', linkStyle: 'inlined' });
  let markdown = td.turndown(root as unknown as HTMLElement)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = markdown.length > MAX_SOURCE_CHARS;
  if (truncated) markdown = markdown.slice(0, MAX_SOURCE_CHARS);
  return { title, markdown, truncated };
}
