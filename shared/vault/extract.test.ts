// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseWikilinks, linkTargets, extractTags, extractHeadings, extractFrontmatterKeys, linkPointsAt, decodeEntities } from './extract';
import { frontmatterToHtmlComment } from '../markdown/frontmatter';

describe('parseWikilinks', () => {
  it('reads plain, aliased and heading links', () => {
    expect(parseWikilinks('<p>[[Old]] and [[Old|the alias]] and [[Old#Setup]] and [[Old#Setup|both]]</p>')).toEqual([
      { target: 'Old' },
      { target: 'Old', alias: 'the alias' },
      { target: 'Old', heading: 'Setup' },
      { target: 'Old', heading: 'Setup', alias: 'both' },
    ]);
  });

  it('works on the editor\'s persisted form (a span carrying the [[text]])', () => {
    const html = '<p>see <span data-wikilink="Aurora — Q3" class="wikilink" role="link">[[Aurora — Q3]]</span></p>';
    expect(linkTargets(html)).toEqual(['Aurora — Q3']);
  });

  it('keeps folder paths, drops a trailing .md, trims whitespace', () => {
    expect(linkTargets('[[ Work/plan.md ]] [[Work/plan]]')).toEqual(['Work/plan']);
  });

  it('decodes HTML entities in the target', () => {
    expect(linkTargets('<p>[[Q&amp;A notes]] [[Tom&#39;s list]]</p>')).toEqual(['Q&A notes', "Tom's list"]);
  });

  it('ignores links that point at no other note', () => {
    expect(parseWikilinks('[[#Heading]] [[ ]] [[|alias]] [[]]')).toEqual([]);
  });

  it('keeps duplicates in parseWikilinks and dedupes in linkTargets', () => {
    expect(parseWikilinks('[[A]] [[A]]')).toHaveLength(2);
    expect(linkTargets('[[A]] [[B]] [[A]]')).toEqual(['A', 'B']);
  });

  it('does not run across lines or brackets', () => {
    expect(linkTargets('[[a\nb]] [[c]d]] [[ok]]')).toEqual(['ok']);
  });
});

describe('extractTags', () => {
  it('finds lowercased distinct tags and one namespace level', () => {
    expect(extractTags('<p>#Idea and #idea #project/Aurora/extra #x_y-z</p>')).toEqual(['#idea', '#project/aurora', '#x_y-z']);
  });

  it('ignores markup and character references', () => {
    expect(extractTags('<p style="color:#ff0000">red</p><a href="#top">x</a> Tom&#39;s &amp; co')).toEqual([]);
    expect(extractTags('<p>real #tag here &#39;</p>')).toEqual(['#tag']);
  });

  it('does not read a wikilink heading anchor as a tag', () => {
    expect(extractTags('<p>[[Plan#Setup]] and [[Plan#Setup|alias]] but a real #tag</p>')).toEqual(['#tag']);
  });

  it('accepts accented letters', () => {
    expect(extractTags('#perché #città')).toEqual(['#perché', '#città']);
  });
});

describe('extractHeadings', () => {
  it('reads HTML headings with levels, stripping inline markup and entities', () => {
    expect(extractHeadings('<h1>Plan</h1><p>x</p><h2>Q&amp;A <em>time</em></h2><h3 id="a">  Deep  </h3>')).toEqual([
      { level: 1, text: 'Plan' }, { level: 2, text: 'Q&A time' }, { level: 3, text: 'Deep' },
    ]);
  });

  it('reads Markdown headings but not those inside code fences', () => {
    expect(extractHeadings('# One\ntext\n```\n# not a heading\n```\n## Two ##\n#nospace\n')).toEqual([
      { level: 1, text: 'One' }, { level: 2, text: 'Two' },
    ]);
  });

  it('skips empty headings and returns [] for a note without any', () => {
    expect(extractHeadings('<h1></h1><p>x</p>')).toEqual([]);
    expect(extractHeadings('')).toEqual([]);
  });
});

describe('extractFrontmatterKeys', () => {
  it('reads keys from Markdown YAML frontmatter', () => {
    expect(extractFrontmatterKeys('---\ntitle: X\ntags: [a]\nstatus: draft\n---\n# body')).toEqual(['title', 'tags', 'status']);
  });

  it('reads keys from the HTML comment form the app stores', () => {
    const fm = '---\ntitle: X\nstatus: done\n---';
    expect(extractFrontmatterKeys(`${frontmatterToHtmlComment(fm)}<p>body</p>`)).toEqual(['title', 'status']);
  });

  it('is empty without frontmatter, and ignores indented/nested keys', () => {
    expect(extractFrontmatterKeys('<p>no front</p>')).toEqual([]);
    expect(extractFrontmatterKeys('---\nouter:\n  inner: 1\n---\n')).toEqual(['outer']);
  });
});

describe('linkPointsAt', () => {
  it('matches case-insensitively, with or without .md, and requires the full path', () => {
    expect(linkPointsAt('plan', 'Plan.md')).toBe(true);
    expect(linkPointsAt('Work/Plan.md', 'work/plan.md')).toBe(true);
    expect(linkPointsAt('plan', 'Work/plan.md')).toBe(false);
    expect(linkPointsAt('plan2', 'plan.md')).toBe(false);
  });
});

describe('decodeEntities', () => {
  it('decodes the entities the editor emits and leaves unknown ones alone', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &copy;')).toBe('a & b <c> "d" \'e\' &copy;');
  });
});

describe('with the vault format given', () => {
  it('a Markdown note that starts with "<" is not read as HTML', () => {
    const md = '<kbd>Ctrl</kbd> + C\n\n# Title\n\n#tag\n';
    expect(extractHeadings(md)).toEqual([]); // sniffed as HTML: no <h1>
    expect(extractHeadings(md, 'markdown')).toEqual([{ level: 1, text: 'Title' }]);
  });

  it('YAML frontmatter is not searched for tags in a Markdown note', () => {
    const md = '---\nnote: "#hidden"\n---\nbody #shown\n';
    expect(extractTags(md, 'markdown')).toEqual(['#shown']);
  });

  it('an HTML note is read as HTML when told so, whatever it starts with', () => {
    expect(extractHeadings('text<h2>Two</h2>', 'html')).toEqual([{ level: 2, text: 'Two' }]);
  });
});
