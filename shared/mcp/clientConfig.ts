// How MCP clients start the Noted server. The app writes these (Claude Desktop) or shows them to copy (Settings → MCP),
// and both must name the vault the user has open: a server started without --notes-dir opens the default vault, so an
// assistant would read and write notes the app does not show.

export interface McpServerEntry {
  command: string;
  args: string[];
}

/** The server's arguments: its script, and the vault when it is not the default one. */
export function mcpServerArgs(serverPath: string, vaultDir?: string | null): string[] {
  return vaultDir ? [serverPath, '--notes-dir', vaultDir] : [serverPath];
}

/** A word for a POSIX shell command line, quoted so a path with spaces or quotes stays one argument. */
export function shellWord(word: string): string {
  return /^[\w./:@%+=-]+$/.test(word) ? word : `"${word.replace(/(["\\$`])/g, '\\$1')}"`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A Claude Desktop configuration with the Noted server added (or replaced), everything else kept as it was. null when
 * the existing text is not a JSON object with an object `mcpServers`: that file belongs to another application, and
 * replacing what cannot be read would delete the user's other servers and settings.
 */
export function withNotedServer(raw: string | null, entry: McpServerEntry): string | null {
  let config: Record<string, unknown> = {};
  if (raw !== null && raw.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!isObject(parsed)) return null;
    config = parsed;
  }
  const servers = config.mcpServers ?? {};
  if (!isObject(servers)) return null;
  return `${JSON.stringify({ ...config, mcpServers: { ...servers, noted: entry } }, null, 2)}\n`;
}
