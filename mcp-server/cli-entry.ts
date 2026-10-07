#!/usr/bin/env node
// The entry of the `noted` command line bundle.
import { runCli } from './cli';

const stdin = (): Promise<string | null> => new Promise(resolve => {
  if (process.stdin.isTTY) { resolve(null); return; }
  const chunks: Buffer[] = [];
  process.stdin.on('data', c => chunks.push(c as Buffer));
  process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', () => resolve(null));
});

runCli(process.argv.slice(2), {
  out: t => process.stdout.write(t),
  err: t => process.stderr.write(t),
  stdin,
  env: process.env,
  cwd: process.cwd(),
}).then(code => { process.exitCode = code; }).catch(err => {
  process.stderr.write(`noted: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
