import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../test/test-utils';
import { ShareMenu } from './ShareMenu';

const open = () => {
  render(
    <ShareMenu getCurrentNoteContent={() => '# Note'} getCurrentNoteTitle={() => 'Note'} getCurrentNoteFileName={() => 'Note.md'}
      getCurrentNoteHtml={() => '<h1>Note</h1>'} onToast={vi.fn()} hasNote={true} />,
  );
  const trigger = screen.getByRole('button', { name: /share/i });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  fireEvent.click(trigger);
  return trigger;
};

describe('ShareMenu', () => {
  it('is a menu: the first action has the focus, the arrows move, Escape closes back on the button', () => {
    const trigger = open();
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(3);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    fireEvent.keyDown(items[0], { key: 'ArrowUp' }); // wraps to the last
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
