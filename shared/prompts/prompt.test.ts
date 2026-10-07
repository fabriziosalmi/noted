import { describe, it, expect } from 'vitest';
import { isPromptPath, isoDay, modeFor, parsePrompt, promptTemplateNote, renderPrompt, slugOf, variablesIn, varsFor } from './prompt';

const note = (front: string, body: string) => `---\n${front}\n---\n${body}`;

describe('parsePrompt', () => {
  it('reads the name, scope, mode and description from the frontmatter, and the instruction from the body', () => {
    const p = parsePrompt('prompts/Make it formal.md', note('name: Formal tone\nscope: selection\nmode: replace\ndescription: Rewrite in a formal tone', 'Rewrite this formally:\n\n{{selection}}\n'));
    expect(p).toEqual({ path: 'prompts/Make it formal.md', name: 'Formal tone', scope: 'selection', mode: 'replace', description: 'Rewrite in a formal tone', template: 'Rewrite this formally:\n\n{{selection}}' });
  });

  it('a note with no frontmatter is a prompt for any text, named by its file', () => {
    expect(parsePrompt('prompts/Work/Summarise.md', 'Summarise {{note}}')).toMatchObject({ name: 'Summarise', scope: 'any', mode: null, description: '', template: 'Summarise {{note}}' });
  });

  it('a scope or mode that is not one of the known ones is ignored, whatever its case', () => {
    expect(parsePrompt('prompts/x.md', note('scope: Selection\nmode: APPEND', 'go'))).toMatchObject({ scope: 'selection', mode: 'append' });
    expect(parsePrompt('prompts/x.md', note('scope: everything\nmode: explode', 'go'))).toMatchObject({ scope: 'any', mode: null });
  });

  it('a note with no instruction is not a prompt', () => {
    expect(parsePrompt('prompts/empty.md', note('name: Empty', '  \n'))).toBeNull();
    expect(parsePrompt('prompts/empty.md', '')).toBeNull();
  });

  it('keeps the Markdown of the instruction as written', () => {
    const p = parsePrompt('prompts/list.md', note('name: List', '# Task\n\n- one\n- **two**\n\n```\ncode {{note}}\n```'));
    expect(p?.template).toBe('# Task\n\n- one\n- **two**\n\n```\ncode {{note}}\n```');
  });

  it('reads a prompt from a vault that is still HTML: the words of the instruction, the properties from the comment', () => {
    const html = '<!--noted-frontmatter:name: Old style\nscope: note-->\n<h1>Task</h1><p>Summarise <b>this</b>:</p><p>{{note}}</p>';
    expect(parsePrompt('prompts/old.md', html)).toMatchObject({ name: 'Old style', scope: 'note', template: 'Task\nSummarise this:\n{{note}}' });
  });
});

describe('isPromptPath and slugOf', () => {
  it('a prompt is a Markdown note in prompts/, at any depth', () => {
    expect(['prompts/a.md', 'prompts/Work/b.md', 'Prompts/c.MD'].map(isPromptPath)).toEqual([true, true, true]);
    expect(['prompts.md', 'notes/prompts/a.md', 'prompts/a.txt', 'prompts/'].map(isPromptPath)).toEqual([false, false, false, false]);
  });
  it('the name typed after the slash is the file name in lower case with dashes', () => {
    expect(slugOf('prompts/Make it formal.md')).toBe('make-it-formal');
    expect(slugOf('prompts/Résumé — court.md')).toBe('resume-court');
    expect(slugOf('prompts/Work/Q4 plan!.md')).toBe('q4-plan');
  });
});

describe('renderPrompt', () => {
  const vars = { selection: 'THE TEXT', note: 'WHOLE NOTE', date: '2026-10-07' };

  it('fills the three variables, with or without spaces inside the braces, as often as they appear', () => {
    expect(renderPrompt('A {{selection}} B {{ note }} C {{date}} D {{selection}}', vars)).toBe('A THE TEXT B WHOLE NOTE C 2026-10-07 D THE TEXT');
  });

  it('never fills in what it just filled in: a selection that contains a variable stays as it was typed', () => {
    expect(renderPrompt('{{selection}} and {{note}}', { selection: 'see {{note}} and {{date}}', note: 'n {{selection}}', date: 'd' })).toBe('see {{note}} and {{date}} and n {{selection}}');
  });

  it('leaves unknown variables alone, and writes a variable as itself when a backslash comes before it', () => {
    expect(renderPrompt('{{title}} {{Selection}} \\{{selection}}', vars)).toBe('{{title}} {{Selection}} {{selection}}');
  });

  it('a dollar sign or backslash in the text is not special', () => {
    expect(renderPrompt('x {{selection}}', { ...vars, selection: 'price $& $1 \\n' })).toBe('x price $& $1 \\n');
  });

  it('lists the variables a template uses, in a fixed order, not counting the escaped ones', () => {
    expect(variablesIn('{{date}} {{selection}} {{selection}} \\{{note}}')).toEqual(['selection', 'date']);
    expect(variablesIn('no variables')).toEqual([]);
  });
});

describe('varsFor and modeFor', () => {
  const now = new Date(2026, 9, 7, 23, 59);
  it('a selection prompt needs a selection', () => {
    expect(varsFor({ scope: 'selection' }, { selection: '  ', note: 'N', now })).toEqual({ ok: false, reason: 'needs-selection' });
    expect(varsFor({ scope: 'selection' }, { selection: 'S', note: 'N', now })).toEqual({ ok: true, vars: { selection: 'S', note: 'N', date: '2026-10-07' } });
  });
  it('a note prompt works on the note, whatever is selected', () => {
    expect(varsFor({ scope: 'note' }, { selection: 'S', note: 'N', now })).toEqual({ ok: true, vars: { selection: '', note: 'N', date: '2026-10-07' } });
  });
  it('an "any" prompt takes the selection if there is one, else the note', () => {
    expect(varsFor({ scope: 'any' }, { selection: 'S', note: 'N', now })).toMatchObject({ vars: { selection: 'S' } });
    expect(varsFor({ scope: 'any' }, { selection: '', note: 'N', now })).toMatchObject({ vars: { selection: 'N' } });
  });
  it('the date is the local day, not UTC', () => {
    expect(isoDay(new Date(2026, 0, 3, 0, 5))).toBe('2026-01-03');
  });

  it('the answer replaces the selection when one was used, goes at the caret otherwise, and the note can say otherwise', () => {
    expect(modeFor({ mode: null, scope: 'any' }, true)).toBe('replace');
    expect(modeFor({ mode: null, scope: 'any' }, false)).toBe('insert');
    expect(modeFor({ mode: null, scope: 'note' }, true)).toBe('insert');
    expect(modeFor({ mode: 'append', scope: 'any' }, true)).toBe('append');
    expect(modeFor({ mode: 'replace', scope: 'any' }, false)).toBe('insert'); // nothing to replace
  });
});

describe('promptTemplateNote', () => {
  it('is itself a valid prompt, and the way to start a new one', () => {
    const p = parsePrompt('prompts/New.md', promptTemplateNote('New'));
    expect(p).toMatchObject({ name: 'New', scope: 'selection' });
    expect(variablesIn(p!.template)).toEqual(['selection']);
  });
});
