// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkChangelog } from './check-changelog.mjs';

const good = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-01-02

## [1.1.0] - 2026-01-01

[Unreleased]: https://github.com/o/r/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/o/r/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/o/r/releases/tag/v1.1.0
`;

describe('checkChangelog', () => {
  it('accepts a consistent changelog', () => {
    expect(checkChangelog(good)).toEqual([]);
    expect(checkChangelog(good, { releaseVersion: '1.2.0' })).toEqual([]);
  });

  it('reports a version section with no link reference', () => {
    const t = good.replace('[1.2.0]: https://github.com/o/r/compare/v1.1.0...v1.2.0\n', '');
    expect(checkChangelog(t)).toContain('missing link reference for [1.2.0]');
  });

  it('reports a stale [Unreleased] compare base', () => {
    const t = good.replace('compare/v1.2.0...HEAD', 'compare/v1.1.0...HEAD');
    expect(checkChangelog(t).join('\n')).toMatch(/\[Unreleased\] should compare from v1\.2\.0/);
  });

  it('reports a link that does not end at its own tag', () => {
    const t = good.replace('compare/v1.1.0...v1.2.0', 'compare/v1.1.0...v1.1.5');
    expect(checkChangelog(t).join('\n')).toMatch(/\[1\.2\.0\] link should end at tag v1\.2\.0/);
  });

  it('reports a reference with no section', () => {
    expect(checkChangelog(good + '[0.9.0]: https://github.com/o/r/releases/tag/v0.9.0\n').join('\n')).toMatch(/\[0\.9\.0\] has no matching/);
  });

  it('reports sections out of order and duplicates', () => {
    const swapped = good.replace('## [1.2.0] - 2026-01-02\n\n## [1.1.0] - 2026-01-01', '## [1.1.0] - 2026-01-01\n\n## [1.2.0] - 2026-01-02');
    expect(checkChangelog(swapped).join('\n')).toMatch(/descending order/);
    expect(checkChangelog(good.replace('## [1.1.0]', '## [1.2.0]')).join('\n')).toMatch(/duplicate section \[1\.2\.0\]/);
  });

  it('in release mode, requires a section for the version being released', () => {
    expect(checkChangelog(good, { releaseVersion: '1.3.0' }).join('\n')).toMatch(/no "## \[1\.3\.0\]" section/);
  });

  it('requires the Unreleased section and reference', () => {
    expect(checkChangelog('# Changelog\n\n## [1.0.0]\n\n[1.0.0]: https://x/releases/tag/v1.0.0\n')).toEqual(
      expect.arrayContaining(['missing "## [Unreleased]" section', 'missing link reference for [Unreleased]']),
    );
  });
});
