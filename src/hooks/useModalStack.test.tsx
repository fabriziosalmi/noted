import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import type * as ReactModule from 'react';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useEffect: (effect: any, deps: any) => {
      if ((globalThis as any).__mockUseEffect) {
        (globalThis as any).__mockUseEffect(effect);
      } else {
        actual.useEffect(effect, deps);
      }
    },
  };
});

import { useModalStack } from './useModalStack';

function TestModal({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  useModalStack(id, open, onClose);
  return open ? <div data-testid={`modal-${id}`}>Modal {id}</div> : null;
}

function TestStackContainer() {
  const [m1, setM1] = useState(true);
  const [m2, setM2] = useState(true);

  return (
    <div>
      <TestModal id="m1" open={m1} onClose={() => setM1(false)} />
      <TestModal id="m2" open={m2} onClose={() => setM2(false)} />
    </div>
  );
}

describe('useModalStack hook', () => {
  it('manages Escape key down events sequentially (closes top of stack first)', () => {
    const { getByTestId, queryByTestId } = render(<TestStackContainer />);

    expect(getByTestId('modal-m1')).toBeInTheDocument();
    expect(getByTestId('modal-m2')).toBeInTheDocument();

    // Trigger an Escape key press.
    // It should close modal m2 (the last one pushed/mounted), but keep m1 open.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(queryByTestId('modal-m2')).not.toBeInTheDocument();
    expect(getByTestId('modal-m1')).toBeInTheDocument();

    // Press Escape again. It should close m1.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(queryByTestId('modal-m1')).not.toBeInTheDocument();
  });

  it('ignores other keys than Escape', () => {
    const closeSpy = vi.fn();
    render(<TestModal id="test" open={true} onClose={closeSpy} />);

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(closeSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores composing, repeat, or defaultPrevented key events', () => {
    const closeSpy = vi.fn();
    render(<TestModal id="test" open={true} onClose={closeSpy} />);

    // defaultPrevented
    const preventEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    preventEvent.preventDefault();
    document.dispatchEvent(preventEvent);
    expect(closeSpy).not.toHaveBeenCalled();

    // isComposing
    const composeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(composeEvent, 'isComposing', { value: true });
    document.dispatchEvent(composeEvent);
    expect(closeSpy).not.toHaveBeenCalled();

    // repeat
    const repeatEvent = new KeyboardEvent('keydown', { key: 'Escape', repeat: true });
    document.dispatchEvent(repeatEvent);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('ignores Escape key if the top of the stack is empty (falsy) to cover !top branch', () => {
    const closeSpy = vi.fn();
    // Render modal with empty string ID, which pushes "" to the stack
    render(<TestModal id="" open={true} onClose={closeSpy} />);

    // Dispatch Escape key down
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('handles duplicate IDs and missing closers cleanly', () => {
    const closeSpy1 = vi.fn();
    const closeSpy2 = vi.fn();

    // Render first modal
    const { unmount: unmount1 } = render(
      <TestModal id="dup" open={true} onClose={closeSpy1} />
    );
    // Render second modal with the same ID (this overrides the closer)
    const { unmount: unmount2 } = render(
      <TestModal id="dup" open={true} onClose={closeSpy2} />
    );

    // Unmount the second one first (splicing it out, deleting the closer for 'dup')
    unmount2();

    // Now stack contains ['dup'], but closer is deleted
    // Dispatch Escape key down: cb will be undefined (line 27 of useModalStack.ts)
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSpy1).not.toHaveBeenCalled();
    expect(closeSpy2).not.toHaveBeenCalled();

    // Clean up the first modal
    unmount1();
  });

  it('handles ID not found in stack during cleanup (i === -1)', () => {
    let cleanup: (() => void) | undefined;
    
    (globalThis as any).__mockUseEffect = (effect: any) => {
      cleanup = effect();
    };

    useModalStack('not-found-id', true, vi.fn());

    expect(cleanup).toBeTypeOf('function');
    if (cleanup) {
      cleanup(); // First cleanup: removes it, stack becomes empty
      cleanup(); // Second cleanup: index is now -1, does nothing gracefully
    }
    
    (globalThis as any).__mockUseEffect = undefined;
  });
});
