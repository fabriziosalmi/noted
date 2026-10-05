// Verifies CHANGELOG.md link references. Used by scripts/release.sh and CI.
//
//   node scripts/check-changelog.mjs              # structure only
//   node scripts/check-changelog.mjs --release    # also: package.json's version has a section
//
// Rules, per Keep a Changelog:
//   - every "## [x.y.z]" heading has a "[x.y.z]: <url>" reference, and no stray refs
//   - "[Unreleased]" compares from the newest released version
//   - each version's compare link ends at its own tag
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** @returns {string[]} human-readable problems; empty when the changelog is consistent. */
export function checkChangelog(text, { releaseVersion } = {}) {
  const problems = [];
  const headings = [...text.matchAll(/^## \[([^\]]+)\]/gm)].map(m => m[1]);
  const refs = new Map([...text.matchAll(/^\[([^\]]+)\]:\s*(\S+)\s*$/gm)].map(m => [m[1], m[2]]));

  const versions = headings.filter(h => VERSION.test(h));
  for (const h of headings) {
    if (h !== 'Unreleased' && !VERSION.test(h)) problems.push(`heading "[${h}]" is neither Unreleased nor a x.y.z version`);
  }
  if (!headings.includes('Unreleased')) problems.push('missing "## [Unreleased]" section');
  for (const v of new Set(versions)) {
    if (!refs.has(v)) problems.push(`missing link reference for [${v}]`);
  }
  if (!refs.has('Unreleased')) problems.push('missing link reference for [Unreleased]');
  for (const k of refs.keys()) {
    if (k !== 'Unreleased' && !headings.includes(k)) problems.push(`link reference [${k}] has no matching "## [${k}]" section`);
  }
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  for (const v of new Set(dupes)) problems.push(`duplicate section [${v}]`);

  const sorted = [...versions].sort((a, b) => cmp(b, a));
  if (versions.join() !== sorted.join()) problems.push('version sections are not in descending order');

  const newest = sorted[0];
  const unreleased = refs.get('Unreleased');
  if (unreleased && newest && !unreleased.endsWith(`/compare/v${newest}...HEAD`)) {
    problems.push(`[Unreleased] should compare from v${newest}: got ${unreleased}`);
  }
  for (const v of versions) {
    const url = refs.get(v);
    if (url && !url.endsWith(`...v${v}`) && !url.endsWith(`/tag/v${v}`)) problems.push(`[${v}] link should end at tag v${v}: got ${url}`);
  }
  if (releaseVersion && !versions.includes(releaseVersion)) {
    problems.push(`package.json is at ${releaseVersion} but CHANGELOG.md has no "## [${releaseVersion}]" section`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const releaseVersion = process.argv.includes('--release')
    ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    : undefined;
  const problems = checkChangelog(text, { releaseVersion });
  if (problems.length) {
    console.error('CHANGELOG.md problems:\n' + problems.map(p => `  ✗ ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('CHANGELOG.md OK');
}
