import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { render, act } from '../test/test-utils';
import { useStore } from '../store/useStore';
import { flushPendingSaves } from '../lib/pendingSave';

vi.mock('@tiptap/react/menus', () => ({ BubbleMenu: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../lib/llm', () => ({ askLLM: vi.fn() }));
vi.mock('../lib/inlineSuggest', () => ({ fetchInlineCompletion: vi.fn().mockResolvedValue('') }));

import { NoteEditor } from './NoteEditor';

describe('NoteEditor autosave flush serialization (#243)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (!Element.prototype.getClientRects) {
      Element.prototype.getClientRects = (() => [] as unknown as DOMRectList);
    }
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = (() => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    }
    useStore.setState({
      activeNoteName: 'draft.md',
      activeNoteContent: '<p>Initial</p>',
      activeNoteFrontmatter: null,
      notes: [{ name: 'draft.md', path: '/vault/draft.md' }],
      flushPendingLinkRewrite: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for an in-flight autosave instead of writing the same note twice concurrently', async () => {
    let resolveSave!: (val: string | null) => void;
    const saveActiveNote = vi.fn().mockImplementation(
      () => new Promise<string | null>((resolve) => { resolveSave = resolve; }),
    );
    const flushNoteToDisk = vi.fn().mockResolvedValue(null);
    useStore.setState({ flushNoteToDisk } as never);

    let editorInst: Editor | null = null;
    render(
      <NoteEditor
        activeNoteName="draft.md"
        activeNoteContent="<p>Initial</p>"
        saveActiveNote={saveActiveNote}
        onEditorReady={(e) => { editorInst = e; }}
      />,
    );

    expect(editorInst).not.toBeNull();

    // Edit 1 -> debounce fires -> saveActiveNote is in flight
    await act(async () => {
      editorInst!.commands.setContent('<p>Edited once</p>', { emitUpdate: true });
      vi.advanceTimersByTime(650);
    });

    expect(saveActiveNote).toHaveBeenCalledTimes(1);

    // While saveActiveNote is STILL in flight, trigger flushPendingSaves()
    let flushDone = false;
    const flushPromise = flushPendingSaves().then(() => { flushDone = true; });
    await Promise.resolve();

    // Must NOT start a concurrent flushNoteToDisk write, and must wait for in-flight save
    expect(flushNoteToDisk).not.toHaveBeenCalled();
    expect(flushDone).toBe(false);

    // Resolve the in-flight autosave -> flushPendingSaves settles cleanly without a duplicate write
    await act(async () => {
      resolveSave(null);
      await flushPromise;
    });

    expect(flushDone).toBe(true);
    expect(flushNoteToDisk).not.toHaveBeenCalled();
  });

  it('serializes a newer pending edit strictly after an in-flight autosave finishes', async () => {
    const events: string[] = [];
    let resolveFirstSave!: (val: string | null) => void;
    const saveActiveNote = vi.fn().mockImplementation(() => {
      events.push('save1:start');
      return new Promise<string | null>((resolve) => {
        resolveFirstSave = (v) => {
          events.push('save1:end');
          resolve(v);
        };
      });
    });
    const flushNoteToDisk = vi.fn().mockImplementation(async () => {
      events.push('flush2:start');
      return null;
    });
    useStore.setState({ flushNoteToDisk } as never);

    let editorInst: Editor | null = null;
    render(
      <NoteEditor
        activeNoteName="draft.md"
        activeNoteContent="<p>Initial</p>"
        saveActiveNote={saveActiveNote}
        onEditorReady={(e) => { editorInst = e; }}
      />,
    );

    expect(editorInst).not.toBeNull();

    // Edit 1 -> debounce fires -> save1 is in flight
    await act(async () => {
      editorInst!.commands.setContent('<p>Edited one</p>', { emitUpdate: true });
      vi.advanceTimersByTime(650);
    });
    expect(saveActiveNote).toHaveBeenCalledTimes(1);

    // Edit 2 arrives WHILE save1 is still in flight -> armed in pendingSaveRef
    await act(async () => {
      editorInst!.commands.setContent('<p>Edited two</p>', { emitUpdate: true });
    });

    // Immediate flush while save1 is still in flight
    const flushPromise = flushPendingSaves();
    await Promise.resolve();
    expect(flushNoteToDisk).not.toHaveBeenCalled();

    // Finish save1 -> flush2 runs strictly AFTER save1:end
    await act(async () => {
      resolveFirstSave(null);
      await flushPromise;
    });

    expect(flushNoteToDisk).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['save1:start', 'save1:end', 'flush2:start']);
  });
});
