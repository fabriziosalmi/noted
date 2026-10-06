// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { findMentions, linkMention, snippetAround, usablePhrase } from './mentions';

const texts = (raw: string, phrases: string[], format: 'markdown' | 'html' = 'markdown'): string[] => findMentions(raw, phrases, format).map(m => m.text);

describe('findMentions (Markdown)', () => {
  it('finds a name written as plain text, in any case, as a whole word', () => {
    expect(texts('We need the Quarterly Plan soon. also the quarterly   plan again.', ['Quarterly plan'])).toEqual(['Quarterly Plan', 'quarterly   plan']);
    expect(texts('planning, plans, replan, Plan!', ['plan'])).toEqual(['Plan']);
    expect(texts('Café au lait and cafés', ['Café'])).toEqual(['Café']);
  });

  it('never inside a link, a wikilink, an embed, code, a URL, a tag or an email', () => {
    const raw = [
      'See [[Plan]] and [[Other|the Plan]] and ![[Plan]].',
      'A [Plan](https://example.com/plan) and ![Plan](plan.png) and <https://plan.example.com>.',
      'Inline `Plan` and ``Plan``, then https://plan.example.com/Plan and #Plan and user@plan.org.',
      '```',
      'Plan in a fence',
      '```',
      'Math $Plan$ and %%Plan%% and a <b>Plan</b> tag.',
      '[Plan]: https://x.test',
    ].join('\n');
    expect(texts(raw, ['Plan'])).toEqual(['Plan']); // only the one between <b> and </b>: the tags are markup, what they hold is prose
  });

  it('is not fooled by front matter', () => {
    const raw = '---\ntitle: Plan\naliases: [Plan]\n---\nThe Plan is set.\n';
    expect(findMentions(raw, ['Plan'], 'markdown').map(m => raw.slice(m.start, m.end))).toEqual(['Plan']);
    expect(findMentions(raw, ['Plan'], 'markdown')[0].start).toBeGreaterThan(raw.indexOf('---', 4));
  });

  it('a fence is closed by a fence of the same kind, and an unclosed one runs to the end', () => {
    expect(texts('```\nPlan\n~~~\nPlan\n```\nPlan outside\n', ['Plan'])).toEqual(['Plan']);
    expect(texts('before Plan\n```\nPlan forever\n', ['Plan'])).toEqual(['Plan']);
  });

  it('the longest name wins at one spot, and each place is reported once', () => {
    expect(findMentions('the Quarterly Plan', ['Plan', 'Quarterly Plan'], 'markdown').map(m => m.phrase)).toEqual(['Quarterly Plan']);
  });

  it('skips names too short or too plain to be a mention', () => {
    expect(texts('a of to the', ['a', 'of', 'to'])).toEqual([]);
    expect(usablePhrase('Q4')).toBe(false);
    expect(usablePhrase('Q4 plan')).toBe(true);
    expect(usablePhrase('  ')).toBe(false);
    expect(usablePhrase('a&b plan')).toBe(false);
  });

  it('finds nothing for no names or no text, and takes a name literally even if it looks like a regular expression', () => {
    expect(texts('anything', [])).toEqual([]);
    expect(texts('', ['Plan'])).toEqual([]);
    expect(texts('cost (draft) and a+b but not aab or draft', ['(draft)', 'a+b'])).toEqual(['(draft)', 'a+b']);
  });
});

describe('findMentions (HTML)', () => {
  it('finds a name in text, and not in a tag, an attribute, code, a link, or the editor\'s link span', () => {
    const raw = '<h1>Plan notes</h1><p>The Plan <a href="/Plan">Plan</a> <code>Plan</code> <span data-wikilink="Plan" class="wikilink">[[Plan]]</span> [[Plan]] <img alt="Plan" src="x.png"> Plan again</p><pre>Plan</pre>';
    expect(texts(raw, ['Plan'], 'html')).toEqual(['Plan', 'Plan', 'Plan']); // the heading, "The Plan", "Plan again"
  });

  it('skips the front matter comment', () => {
    const raw = `<!--noted-frontmatter:${encodeURIComponent('---\ntitle: Plan\n---')}-->\n<p>Plan</p>`;
    expect(texts(raw, ['Plan'], 'html')).toEqual(['Plan']);
  });
});

describe('linkMention', () => {
  it('writes [[Target]] when the text is the target, and [[Target|text]] when it differs', () => {
    const raw = 'The quarterly plan and the Quarterly Plan.';
    const [first, second] = findMentions(raw, ['Quarterly Plan'], 'markdown');
    expect(linkMention(raw, first, 'Quarterly Plan', 'markdown')).toBe('The [[Quarterly Plan|quarterly plan]] and the Quarterly Plan.');
    expect(linkMention(raw, second, 'Quarterly Plan', 'markdown')).toBe('The quarterly plan and the [[Quarterly Plan]].');
  });

  it('an alias is written as the shown text', () => {
    const raw = 'See the Roadmap.';
    expect(linkMention(raw, findMentions(raw, ['Roadmap'], 'markdown')[0], 'Plan', 'markdown')).toBe('See the [[Plan|Roadmap]].');
  });

  it('an HTML note gets the editor\'s own link span, escaped', () => {
    const raw = '<p>Tom & Jerry plan</p>';
    const m = findMentions(raw, ['Jerry plan'], 'html')[0];
    expect(linkMention(raw, m, 'Jerry plan', 'html')).toBe('<p>Tom & <span data-wikilink="Jerry plan" class="wikilink">[[Jerry plan]]</span></p>');
  });

  it('leaves everything else byte for byte, and the mention is gone afterwards', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('Plan', 'plan', 'planet', 'x', '`Plan`', '[[Plan]]', '\n', ' ', '**', '#Plan'), { maxLength: 12 }), words => {
      const raw = words.join(' ');
      const found = findMentions(raw, ['Plan'], 'markdown');
      if (found.length === 0) return;
      const out = linkMention(raw, found[0], 'Plan', 'markdown');
      expect(out.slice(0, found[0].start)).toBe(raw.slice(0, found[0].start));
      expect(out.endsWith(raw.slice(found[0].end))).toBe(true);
      expect(findMentions(out, ['Plan'], 'markdown')).toHaveLength(found.length - 1);
    }), { numRuns: 300 });
  });
});

describe('snippetAround', () => {
  it('is a line of plain context around the match', () => {
    const raw = 'Intro with **bold** words. The Plan is approved by everyone, and more text follows after it.';
    const m = findMentions(raw, ['Plan'], 'markdown')[0];
    const s = snippetAround(raw, m, 'markdown', 30);
    expect(s.match).toBe('Plan');
    expect(s.before.endsWith('The ')).toBe(true);
    expect(s.before.startsWith('…')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
    expect(s.before + s.match + s.after).not.toContain('**');
  });

  it('strips tags and keeps entities readable in an HTML note', () => {
    const raw = '<p>Cats &amp; the <b>Plan</b> here</p>';
    const m = findMentions(raw, ['Plan'], 'html')[0];
    const s = snippetAround(raw, m, 'html');
    expect(s.before).toBe('Cats & the ');
    expect(s.after).toBe(' here');
  });
});
