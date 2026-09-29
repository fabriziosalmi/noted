// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { installStdioEpipeGuard } from './stdio-guard';

describe('installStdioEpipeGuard', () => {
  it('swallows EPIPE instead of letting it kill the process', () => {
    const stream = new EventEmitter();
    installStdioEpipeGuard([stream]);
    expect(() => stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow();
  });

  it('lets non-EPIPE stream errors throw as before', () => {
    const stream = new EventEmitter();
    installStdioEpipeGuard([stream]);
    expect(() => stream.emit('error', Object.assign(new Error('boom'), { code: 'EIO' }))).toThrow('boom');
  });
});
