import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { createWikilinkHighlightPlugin, extractWikilinks, WikilinkMark } from './WikilinkExtension';

describe('extractWikilinks', () => {
  it('extracts unique wikilinks from text', () => {
    const text = 'See [[Note A]] and [[Note B]] and again [[Note A]].';
    expect(extractWikilinks(text)).toEqual(['Note A', 'Note B']);
  });

  it('trims targets and ignores malformed links', () => {
    const text = '[[  Note C  ]] [[]] [[broken] plain';
    expect(extractWikilinks(text)).toEqual(['Note C']);
  });
});

describe('WikilinkExtension structural behavior', () => {
  it('exposes attributes, parseHTML and renderHTML contract', () => {
    const extension = WikilinkMark as unknown as {
      config: {
        addAttributes: () => Record<string, unknown>;
        parseHTML: () => { tag: string }[];
        renderHTML: (args: { HTMLAttributes: { target: string } }) => unknown[];
      };
    };
    const attrs = extension.config.addAttributes();
    const parseRules = extension.config.parseHTML();
    const rendered = extension.config.renderHTML({ HTMLAttributes: { target: 'Note-X' } });

    expect(attrs).toEqual({ target: { default: null } });
    expect(parseRules).toEqual([{ tag: 'span[data-wikilink]' }]);
    expect(rendered[0]).toBe('span');
    expect(rendered[2]).toBe(0);
    expect(rendered[1]).toMatchObject({
      'data-wikilink': 'Note-X',
      class: 'wikilink',
      role: 'link',
      title: 'Open note: Note-X',
      'aria-label': 'Open note: Note-X',
    });
  });

  it('creates inline decorations for raw [[wikilink]] syntax', () => {
    const plugin = createWikilinkHighlightPlugin();
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', group: 'block' },
        text: { group: 'inline' },
      },
      marks: {},
    });
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Hello [[Note A]] and [[Note B]]')]),
    ]);
    const decoSet = plugin.props.decorations?.({ doc } as never);
    const decos = decoSet?.find() ?? [];
    expect(decos.length).toBe(2);
  });

  it('insertWikilink command inserts marked text then trailing space', () => {
    const extension = WikilinkMark as unknown as { config: { addCommands: () => Record<string, unknown> } };
    const addCommands = extension.config.addCommands;
    const ctx = { name: 'wikilink' };
    const commands = addCommands.call(ctx) as {
      insertWikilink: (name: string) => (args: { chain: () => { insertContent: ReturnType<typeof vi.fn>; run: () => boolean } }) => boolean;
    };

    const insertContent = vi.fn().mockReturnThis();
    const run = vi.fn().mockReturnValue(true);
    const chain = vi.fn().mockReturnValue({ insertContent, run });

    const res = commands.insertWikilink('My Note')({ chain });
    expect(res).toBe(true);
    expect(insertContent).toHaveBeenNthCalledWith(1, {
      type: 'text',
      marks: [{ type: 'wikilink', attrs: { target: 'My Note' } }],
      text: '[[My Note]]',
    });
    expect(insertContent).toHaveBeenNthCalledWith(2, { type: 'text', text: ' ' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
