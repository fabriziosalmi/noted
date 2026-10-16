import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TemplatesModal } from './TemplatesModal';
import { ConfirmProvider } from './ConfirmProvider';
import type { NoteTemplate } from '../lib/templates';

const mine = { id: 'custom_1', name: 'Weekly review', content: '<h1>Weekly review</h1>', icon: 'FileText' } as unknown as NoteTemplate;

const open = (onDelete = vi.fn()) => {
  render(
    <ConfirmProvider>
      <TemplatesModal customTemplates={[mine]} activeNoteContent="" activeNoteName={null} onApply={vi.fn()} onSaveCurrent={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />
    </ConfirmProvider>,
  );
  return onDelete;
};

describe('TemplatesModal', () => {
  it('asks before deleting a template of your own, and Cancel keeps it', async () => {
    const onDelete = open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete template' }));
    const ask = (await screen.findByText('Delete the template "Weekly review"? This cannot be undone.')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(/Delete the template/)).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete template' }));
    const again = (await screen.findByText(/Delete the template/)).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(again).getByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('custom_1'));
  });
});
