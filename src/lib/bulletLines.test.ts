// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toggleBulletLines } from './bulletLines';

describe('toggleBulletLines', () => {
  it('bullets non-empty lines, preserving empty lines', () => {
    expect(toggleBulletLines('apple\n\nfig\npear')).toBe('- apple\n\n- fig\n- pear');
  });

  it("unbullets '- ' prefixes when every non-empty line is already bulleted", () => {
    expect(toggleBulletLines('- apple\n- fig')).toBe('apple\nfig');
  });

  it("unbullets '* ' prefixes when every non-empty line is already bulleted", () => {
    expect(toggleBulletLines('* apple\n* fig')).toBe('apple\nfig');
  });

  it('keeps empty lines in place when unbulleting', () => {
    expect(toggleBulletLines('- apple\n\n- fig')).toBe('apple\n\nfig');
  });

  it('bullets all lines when only some are already bulleted', () => {
    expect(toggleBulletLines('- apple\nfig')).toBe('- - apple\n- fig');
  });

  it('toggles back to the original on a second pass', () => {
    expect(toggleBulletLines(toggleBulletLines('a\n\nb'))).toBe('a\n\nb');
  });

  it('handles empty input and single lines', () => {
    expect(toggleBulletLines('')).toBe('');
    expect(toggleBulletLines('\n\n')).toBe('\n\n');
    expect(toggleBulletLines('only')).toBe('- only');
    expect(toggleBulletLines('- only')).toBe('only');
    expect(toggleBulletLines('* only')).toBe('only');
  });
});
