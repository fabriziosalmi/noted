// The entry of the MCP server bundle: runs the server. The server itself (index.ts) can be imported without running, by the tests
// and by the command line tool.
import { main } from './index';
main().catch(err => {
  process.stderr.write(`[noted-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
