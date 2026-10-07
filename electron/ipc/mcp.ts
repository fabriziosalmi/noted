import { app, ipcMain, utilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { logEvent, newRequestId } from '../structured-log';
import { getTargetDir } from '../core/paths';

function getMcpServerPathInternal(): string {
  let candidate = path.join(__dirname, '..', 'dist-mcp', 'index.cjs');
  const asarSeg = `${path.sep}app.asar${path.sep}`;
  if (app.isPackaged && candidate.includes(asarSeg)) {
    candidate = candidate.replace(asarSeg, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return candidate;
}

let mcpSseChild: Electron.UtilityProcess | null = null;
let currentMcpPort: number | null = null;
let currentMcpSyncDir: string | null = null;
let currentLegacySse = false;

export function stopMcpSseServer() {
  if (mcpSseChild) {
    logEvent('info', 'mcp_sse_stopping', {
      port: currentMcpPort ?? undefined,
      syncDir: currentMcpSyncDir ?? undefined,
    });
    mcpSseChild.kill();
    mcpSseChild = null;
    currentMcpPort = null;
    currentMcpSyncDir = null;
  }
}

// A stable per-install token that authenticates the local SSE handshake. Kept
// in userData so a saved client config keeps working across restarts; the SSE
// server refuses connections that don't present it.
let mcpSseToken: string | null = null;
function getMcpSseToken(): string {
  if (mcpSseToken) return mcpSseToken;
  const tokenPath = path.join(app.getPath('userData'), 'mcp-sse-token');
  try {
    if (fs.existsSync(tokenPath)) {
      const saved = fs.readFileSync(tokenPath, 'utf8').trim();
      if (saved) return (mcpSseToken = saved);
    }
  } catch { /* regenerate below */ }
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  } catch { /* fall back to an in-memory token for this session */ }
  return (mcpSseToken = token);
}

function startMcpSseServer(port: number, syncDir?: string, legacySse = false) {
  stopMcpSseServer();
  const reqId = newRequestId('mcp-sse');

  const mcpPath = getMcpServerPathInternal();
  if (!fs.existsSync(mcpPath)) {
    logEvent('error', 'mcp_sse_binary_missing', { reqId, mcpPath });
    return;
  }

  const targetDir = getTargetDir(syncDir);
  logEvent('info', 'mcp_sse_starting', { reqId, port, notesDir: targetDir });

  try {
    // utilityProcess runs the script on the bundled Electron's own Node, so a
    // packaged app on a clean machine needs no `node` on PATH, and it works with
    // the RunAsNode fuse turned off (ELECTRON_RUN_AS_NODE would be ignored).
    mcpSseChild = utilityProcess.fork(mcpPath, [
      '--transport',
      'http', // Streamable HTTP at /mcp; the older /sse only when asked for
      '--port',
      String(port),
      '--notes-dir',
      targetDir,
      ...(legacySse ? ['--legacy-sse'] : []),
    ], {
      serviceName: 'noted-mcp-sse',
      // Pass the auth token via the environment, not argv — argv is readable by
      // any same-user process via the process list.
      env: { ...process.env, NOTED_MCP_AUTH_TOKEN: getMcpSseToken() },
      stdio: 'pipe'
    });

    currentMcpPort = port;
    currentMcpSyncDir = targetDir;
    currentLegacySse = legacySse;

    mcpSseChild.stdout?.on('data', data => {
      const message = data.toString().trim();
      if (!message) return;
      logEvent('info', 'mcp_sse_child_stdout', { reqId, message });
    });

    mcpSseChild.stderr?.on('data', data => {
      const message = data.toString().trim();
      if (!message) return;
      logEvent('error', 'mcp_sse_child_stderr', { reqId, message });
    });

    const child = mcpSseChild;
    child.on('exit', code => {
      logEvent('info', 'mcp_sse_child_exited', { reqId, code: code ?? null });
      // Only clear the slot if it still holds *this* child; a restart may have
      // already replaced it.
      if (mcpSseChild === child) mcpSseChild = null;
    });
  } catch (err) {
    logEvent('error', 'mcp_sse_spawn_failed', { reqId, error: (err as Error).message });
  }
}

// Where Claude Desktop keeps claude_desktop_config.json, per platform. Windows
// has no HOME, so the home directory comes from Electron rather than the env.
export function resolveClaudeConfigDir(home: string, platform: NodeJS.Platform, appData?: string): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude');
  if (platform === 'win32') return path.join(appData || path.join(home, 'AppData', 'Roaming'), 'Claude');
  return path.join(home, '.config', 'Claude');
}

export function registerMcpHandlers(): void {
  // MCP server location — resolved relative to dist-electron/main.cjs so it works
  // both in dev (cloned repo) and in packaged builds that ship dist-mcp/.
  // Used by Settings → MCP tab to populate accurate copy-paste client configs.
  ipcMain.handle('get-mcp-server-path', () => {
    const candidate = getMcpServerPathInternal();
    return { path: candidate, exists: fs.existsSync(candidate) };
  });

  // The SSE auth token, so Settings can render a ready-to-paste authenticated URL.
  ipcMain.handle('get-mcp-sse-token', () => getMcpSseToken());

  ipcMain.handle('update-mcp-sse-config', (_, config: { enabled: boolean; port: number; syncDir?: string; legacySse?: boolean }) => {
    const reqId = newRequestId('mcp-sse-config');
    try {
      const { enabled, port, syncDir } = config;
      const legacySse = config.legacySse === true;
      const targetDir = getTargetDir(syncDir);

      if (!enabled) {
        stopMcpSseServer();
        return { success: true };
      }

      if (mcpSseChild && currentMcpPort === port && currentMcpSyncDir === targetDir && currentLegacySse === legacySse) {
        return { success: true };
      }

      startMcpSseServer(port, syncDir, legacySse);
      return { success: true };
    } catch (err) {
      logEvent('error', 'mcp_sse_config_update_failed', { reqId, error: (err as Error).message });
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('setup-claude-mcp', async () => {
    try {
      const homeDir = app.getPath('home');
      if (!homeDir) throw new Error('Could not determine the home directory');
      const configDir = resolveClaudeConfigDir(homeDir, process.platform, process.env.APPDATA);
      const configPath = path.join(configDir, 'claude_desktop_config.json');

      // Get the actual MCP server path
      const mcpPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-mcp', 'index.cjs')
        : path.join(__dirname, '../dist-mcp/index.cjs');

      if (!fs.existsSync(mcpPath)) {
        throw new Error(`MCP server not found at ${mcpPath}. Build it first.`);
      }

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = { mcpServers: {} };
      if (fs.existsSync(configPath)) {
        try {
          const raw = fs.readFileSync(configPath, 'utf-8');
          config = JSON.parse(raw);
        } catch {
          // if file is corrupted, preserve empty structure
          config = { mcpServers: {} };
        }
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      config.mcpServers.noted = {
        command: 'node',
        args: [mcpPath]
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
