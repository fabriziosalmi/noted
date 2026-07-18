export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') process.stderr.write(line + '\n');
  else if (level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}
