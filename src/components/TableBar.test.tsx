import { describe, it, expect, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { render, screen, fireEvent } from '../test/test-utils';
import { TableBar } from './TableBar';

const COMMANDS = [
  ['Add row', 'addRowAfter'],
  ['Delete row', 'deleteRow'],
  ['Add column', 'addColumnAfter'],
  ['Delete column', 'deleteColumn'],
  ['Delete table', 'deleteTable'],
] as const;

function makeEditor(inTable: boolean) {
  const run = vi.fn().mockReturnValue(true);
  const commands: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainObj: Record<string, unknown> = { run };
  chainObj.focus = vi.fn(() => chainObj);
  for (const [, name] of COMMANDS) {
    commands[name] = vi.fn(() => chainObj);
    chainObj[name] = commands[name];
  }
  const editor = {
    isActive: vi.fn((name: string) => inTable && name === 'table'),
    chain: vi.fn(() => chainObj),
  };
  return { editor: editor as unknown as Editor, commands, run, focus: chainObj.focus as ReturnType<typeof vi.fn> };
}

describe('TableBar', () => {
  it('renders nothing without an editor', () => {
    render(<TableBar editor={null} />);
    expect(screen.queryByTestId('table-bar')).not.toBeInTheDocument();
  });

  it('renders nothing when the selection is not in a table', () => {
    const { editor } = makeEditor(false);
    render(<TableBar editor={editor} />);
    expect(screen.queryByTestId('table-bar')).not.toBeInTheDocument();
  });

  it('renders the toolbar with all five buttons inside a table', () => {
    const { editor } = makeEditor(true);
    render(<TableBar editor={editor} />);
    expect(screen.getByRole('toolbar', { name: 'Table actions' })).toBeInTheDocument();
    expect(screen.getByTestId('table-bar')).toBeInTheDocument();
    for (const [label] of COMMANDS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it.each(COMMANDS)('%s invokes %s and run()', (label, command) => {
    const { editor, commands, run, focus } = makeEditor(true);
    render(<TableBar editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(commands[command]).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    for (const [, other] of COMMANDS) {
      if (other !== command) expect(commands[other]).not.toHaveBeenCalled();
    }
  });
});
