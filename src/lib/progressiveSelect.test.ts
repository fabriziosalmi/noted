import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  findBlockRange,
  findSentenceRange,
  nextProgressiveSelection,
  ProgressiveSelectExtension,
} from './progressiveSelect';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: [StarterKit, ProgressiveSelectExtension], content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

// "Hello big world. Second one!" -> paragraph text starts at position 1.
const HTML = '<p>Hello big world. Second one!</p>';

describe('findSentenceRange', () => {
  it('returns the trimmed sentence containing the position', () => {
    const { doc } = make(HTML).state;
    expect(findSentenceRange(doc, 8)).toEqual({ from: 1, to: 17 });
    expect(findSentenceRange(doc, 20)).toEqual({ from: 18, to: 29 });
  });

  it('returns null in the whitespace between sentences', () => {
    const { doc } = make(HTML).state;
    expect(findSentenceRange(doc, 17)).toBeNull();
  });

  it('returns null outside textblocks, for empty blocks and out of range', () => {
    expect(findSentenceRange(make(HTML).state.doc, 0)).toBeNull();
    expect(findSentenceRange(make('<p></p>').state.doc, 1)).toBeNull();
    expect(findSentenceRange(make(HTML).state.doc, 99)).toBeNull();
  });
});

describe('findBlockRange', () => {
  it('returns the whole non-empty textblock', () => {
    const { doc } = make(HTML).state;
    expect(findBlockRange(doc, 8)).toEqual({ from: 1, to: 29 });
  });

  it('returns null for empty blocks and non-textblock positions', () => {
    expect(findBlockRange(make('<p></p>').state.doc, 1)).toBeNull();
    expect(findBlockRange(make(HTML).state.doc, 0)).toBeNull();
  });
});

describe('nextProgressiveSelection', () => {
  it('progresses word -> sentence -> block -> null', () => {
    const { doc } = make(HTML).state;

    const word = nextProgressiveSelection(doc, 8, 8);
    expect(word).toEqual({ from: 7, to: 10 });

    const sentence = nextProgressiveSelection(doc, word!.from, word!.to);
    expect(sentence).toEqual({ from: 1, to: 17 });

    const block = nextProgressiveSelection(doc, sentence!.from, sentence!.to);
    expect(block).toEqual({ from: 1, to: 29 });

    expect(nextProgressiveSelection(doc, block!.from, block!.to)).toBeNull();
  });

  it('grows a selected word to its sentence', () => {
    const { doc } = make(HTML).state;
    expect(nextProgressiveSelection(doc, 18, 24)).toEqual({ from: 18, to: 29 });
  });

  it('skips missing word and sentence steps', () => {
    const { doc } = make(HTML).state;
    expect(nextProgressiveSelection(doc, 17, 17)).toEqual({ from: 1, to: 29 });
  });

  it('returns null for empty blocks and invalid ranges', () => {
    expect(nextProgressiveSelection(make('<p></p>').state.doc, 1, 1)).toBeNull();
    expect(nextProgressiveSelection(make(HTML).state.doc, 10, 5)).toBeNull();
    expect(nextProgressiveSelection(make(HTML).state.doc, -1, 0)).toBeNull();
    expect(nextProgressiveSelection(make(HTML).state.doc, 0, 999)).toBeNull();
  });
});

describe('ProgressiveSelectExtension', () => {
  function shortcuts(ed: Editor): Record<string, () => boolean> {
    return ed.extensionManager.extensions
      .find((e) => e.name === 'progressiveSelect')!
      .config.addKeyboardShortcuts!.call({ editor: ed } as never) as Record<string, () => boolean>;
  }

  it('binds F8 to expand the selection up to the block', () => {
    const ed = make(HTML);
    const keys = shortcuts(ed);
    expect(Object.keys(keys)).toEqual(['F8']);

    ed.commands.setTextSelection(8);
    expect(keys.F8()).toBe(true);
    expect(ed.state.selection.from).toBe(7);
    expect(ed.state.selection.to).toBe(10);

    expect(keys.F8()).toBe(true);
    expect(ed.state.selection.from).toBe(1);
    expect(ed.state.selection.to).toBe(17);

    expect(keys.F8()).toBe(true);
    expect(ed.state.selection.from).toBe(1);
    expect(ed.state.selection.to).toBe(29);

    expect(keys.F8()).toBe(false);
    expect(ed.state.selection.from).toBe(1);
    expect(ed.state.selection.to).toBe(29);
  });
});
