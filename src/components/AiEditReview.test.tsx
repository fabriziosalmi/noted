import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiEditReview } from './AiEditReview';
import { ConfirmProvider } from './ConfirmProvider';

const open = (onCancel = vi.fn()) => {
  render(
    <ConfirmProvider>
      <AiEditReview title="Refine" original={'The plan ships Friday.\n'} proposed={'The plan ships on Friday.\n'} onApply={vi.fn()} onCancel={onCancel} />
    </ConfirmProvider>,
  );
  return onCancel;
};

describe('AiEditReview', () => {
  it('Escape asks before throwing the proposal away, and Cancel keeps it', async () => {
    const onCancel = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Close and discard the proposed changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Close and discard the proposed changes?')).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    const ask = (await screen.findByText('Close and discard the proposed changes?')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(ask).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});
