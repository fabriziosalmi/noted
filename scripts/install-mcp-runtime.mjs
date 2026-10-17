// Installs what the bundled MCP server loads at run time (jsdom) into dist-mcp/, from the committed lockfile in
// mcp-server/runtime/: the same versions in every build, checked against their integrity hashes, no install scripts.
import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const from = path.join('mcp-server', 'runtime');
const to = 'dist-mcp';
mkdirSync(to, { recursive: true });
for (const file of ['package.json', 'package-lock.json']) copyFileSync(path.join(from, file), path.join(to, file));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: to, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(run.status ?? 1);
