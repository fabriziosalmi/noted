import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '../components/ConfirmProvider';

/**
 * Drop-in replacement for RTL's `render` that wraps the tree in the app-wide
 * providers components rely on at runtime (currently ConfirmProvider, which
 * backs useConfirm/usePrompt). Re-exports the rest of RTL so test files can
 * import everything from here.
 */
function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: ConfirmProvider, ...options });
}

// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';
export { render };
