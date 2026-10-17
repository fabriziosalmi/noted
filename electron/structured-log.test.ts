// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLogFile, logEvent, setLogFile } from './structured-log';

// An installed app has nowhere for stdout to go: the events must also be in a file the user can attach to a report.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-log-'));
const file = path.join(dir, 'logs', 'main.log');
afterAll(() => { setLogFile(null); fs.rmSync(dir, { recursive: true, force: true }); });
vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

describe('logEvent', () => {
  it('appends each event as a JSON line to the log file, creating its folder', () => {
    setLogFile(file);
    expect(getLogFile()).toBe(file);
    logEvent('warn', 'vault_watch_failed', { reason: 'ENOSYS' });
    logEvent('info', 'app_started', { version: '1.7.1' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines.map(l => [l.level, l.event])).toEqual([['warn', 'vault_watch_failed'], ['info', 'app_started']]);
    expect(lines[0].reason).toBe('ENOSYS');
  });

  it('keeps the log to two files of 5 MB', () => {
    setLogFile(file);
    const big = 'x'.repeat(3 * 1024 * 1024);
    logEvent('info', 'first', { big });
    logEvent('info', 'second', { big }); // over 5 MB: the file moves to main.log.1, this one starts a new file
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('"event":"second"');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('"event":"first"');
  });

  it('never throws when the file cannot be written', () => {
    fs.writeFileSync(path.join(dir, 'not-a-folder.txt'), '');
    setLogFile(path.join(dir, 'not-a-folder.txt', 'main.log'));
    expect(() => logEvent('error', 'still_fine')).not.toThrow();
  });
});
