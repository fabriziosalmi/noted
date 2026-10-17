#!/usr/bin/env node
// Start a packaged Noted.app the way a user would, but on a throwaway profile and vault, and check that it works:
// the window loads with no error in the log, the app quits when asked, and the bundled MCP server answers. The user's
// own profile and logs must be left exactly as they were; the check fails if their modification times change.
//
// Usage: node scripts/smoke-packaged.mjs release/mac-arm64/Noted.app
//
// --user-data-dir is Chromium's own switch: the app then keeps its settings, session and log in that folder
// (electron/main.ts moves the log there too). NOTED_NOTES_DIR points the default vault at a temporary folder.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOAD_TIMEOUT_MS = 45_000;
const STAY_UP_MS = 3_000;
const QUIT_TIMEOUT_MS = 10_000;
const MCP_TIMEOUT_MS = 20_000;

/** What the app's log says: whether the window loaded, and every line that is an error or a lost renderer. */
export function readLog(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { events.push({ level: 'error', event: 'unparsable_log_line', line }); }
  }
  return {
    started: events.some(e => e.event === 'app_started'),
    loaded: events.some(e => e.event === 'renderer_loaded'),
    problems: events.filter(e => e.level === 'error' || e.event === 'renderer_gone' || e.event === 'renderer_load_failed'),
  };
}

/** Modification times of a folder and of what is directly in it; nothing is read. Null when it does not exist. */
export function snapshot(dir) {
  try {
    const out = { '.': fs.statSync(dir).mtimeMs };
    for (const name of fs.readdirSync(dir)) {
      try { out[name] = fs.lstatSync(path.join(dir, name)).mtimeMs; } catch { /* gone meanwhile */ }
    }
    return out;
  } catch {
    return null;
  }
}

/** The entries whose time changed, appeared or disappeared between two snapshots. */
export function changed(before, after) {
  if (before === null || after === null) return before === after ? [] : ['.'];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter(n => before[n] !== after[n]).sort();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = check();
    if (v) return v;
    await sleep(250);
  }
  return null;
}

/** Ask the bundled MCP server, over stdio, for its tools. Resolves to the tool names. */
function mcpTools(serverPath, vault) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, '--notes-dir', vault], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`no answer in ${MCP_TIMEOUT_MS} ms: ${err.slice(-300)}`)); }, MCP_TIMEOUT_MS);
    const send = msg => child.stdin.write(`${JSON.stringify(msg)}\n`);
    child.stderr.on('data', d => { err += d; });
    child.stdout.on('data', d => {
      out += d;
      for (const line of out.split('\n')) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1 && msg.result) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          if (msg.result?.tools) resolve(msg.result.tools.map(t => t.name));
          else reject(new Error(`tools/list failed: ${JSON.stringify(msg.error ?? msg)}`));
          return;
        }
      }
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'noted-smoke', version: '1' } } });
  });
}

async function main(appPath) {
  if (process.platform !== 'darwin') throw new Error('this check runs on macOS');
  const binary = path.join(appPath, 'Contents', 'MacOS', 'Noted');
  const mcp = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'dist-mcp', 'index.cjs');
  for (const f of [binary, mcp]) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);

  const home = os.homedir();
  const userDirs = [path.join(home, 'Library', 'Application Support', 'Noted'), path.join(home, 'Library', 'Logs', 'Noted')];
  const before = userDirs.map(snapshot);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-smoke-'));
  const profile = path.join(tmp, 'profile');
  const vault = path.join(tmp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'Hello.md'), '# Hello\n\nA note for the smoke test.\n');
  const logFile = path.join(profile, 'logs', 'main.log');
  const failures = [];

  const env = { ...process.env, NOTED_NOTES_DIR: vault };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(binary, [`--user-data-dir=${profile}`], { env, stdio: 'ignore' });
  let exited = null;
  app.on('exit', (code, signal) => { exited = { code, signal }; });
  try {
    const log = () => (fs.existsSync(logFile) ? readLog(fs.readFileSync(logFile, 'utf8')) : null);
    const loaded = await waitFor(() => {
      const l = log();
      if (exited) return l ?? { started: false, loaded: false, problems: [] }; // gone before (or without) a log
      return l && (l.loaded || l.problems.length) ? l : null;
    }, LOAD_TIMEOUT_MS);
    if (!loaded) failures.push(`the window did not load within ${LOAD_TIMEOUT_MS / 1000} s (log: ${fs.existsSync(logFile) ? 'present' : 'missing'})`);
    else if (!loaded.started || !loaded.loaded) failures.push('the log has no app_started and renderer_loaded');
    await sleep(STAY_UP_MS);
    if (exited) failures.push(`the app exited by itself (${JSON.stringify(exited)})`);
    const final = log();
    for (const p of final?.problems ?? []) failures.push(`log: ${JSON.stringify(p)}`);
  } finally {
    if (!exited) {
      app.kill('SIGTERM');
      if (!(await waitFor(() => exited, QUIT_TIMEOUT_MS))) { app.kill('SIGKILL'); failures.push(`the app did not quit within ${QUIT_TIMEOUT_MS / 1000} s`); }
    }
  }

  try {
    const tools = await mcpTools(mcp, vault);
    if (tools.length === 0) failures.push('the MCP server lists no tools');
    else console.log(`  MCP server: ${tools.length} tools`);
  } catch (e) {
    failures.push(`MCP server: ${e.message}`);
  }

  const after = userDirs.map(snapshot);
  userDirs.forEach((dir, i) => {
    const diff = changed(before[i], after[i]);
    if (diff.length) failures.push(`${dir} was touched: ${diff.join(', ')}`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.log('  ✓ packaged app: window loaded, no error logged, quit on request; your profile and logs untouched');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const appPath = process.argv[2];
  if (!appPath) { console.error('usage: node scripts/smoke-packaged.mjs <path to Noted.app>'); process.exit(2); }
  main(path.resolve(appPath)).then(code => process.exit(code), e => { console.error(`  ✗ ${e.message}`); process.exit(1); });
}
