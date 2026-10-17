// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { afterRendererGone, RELOAD_WINDOW_MS } from './rendererCrash';

describe('afterRendererGone', () => {
  it('reloads a window whose renderer crashed or was killed', () => {
    expect(afterRendererGone('crashed', null, 1_000)).toBe('reload');
    expect(afterRendererGone('oom', null, 1_000)).toBe('reload');
    expect(afterRendererGone('killed', null, 1_000)).toBe('reload');
  });

  it('leaves a clean exit alone (the app is closing)', () => {
    expect(afterRendererGone('clean-exit', null, 1_000)).toBe('leave');
  });

  it('does not reload again within a minute of the last reload, so a renderer that dies at start cannot loop', () => {
    expect(afterRendererGone('crashed', 1_000, 1_000 + RELOAD_WINDOW_MS - 1)).toBe('leave');
    expect(afterRendererGone('crashed', 1_000, 1_000 + RELOAD_WINDOW_MS)).toBe('reload');
  });
});
