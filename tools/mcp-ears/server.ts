// MCP server `mcp-ears`: lets a coding agent teach sounds, listen to a recording and score a folder.
// Run with `npm run mcp`. Importing this file starts nothing. The server writes nothing to the standard output
// except protocol messages.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toToolError } from './errors';
import { createPathGuard } from './paths';
import { TOOLS } from './tools';

const SERVER_NAME = 'mcp-ears';
const SERVER_VERSION = '1.0.0';
const EXIT_FAILURE = 1;

export interface ServerOptions { root?: string }

export function createServer(options: ServerOptions = {}): McpServer {
  const guard = createPathGuard(options.root ?? process.cwd());
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of TOOLS) {
    // The one registration call. The cast is here because the list holds tools of different input shapes.
    (server.registerTool as (name: string, config: unknown, cb: (args: Record<string, unknown>) => Promise<unknown>) => unknown).call(
      server,
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          return { content: await tool.run(args, { guard }) };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: toToolError(error) }] };
        }
      },
    );
  }
  return server;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  createServer()
    .connect(new StdioServerTransport())
    .catch((error: unknown) => {
      process.stderr.write(`mcp-ears failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_FAILURE;
    });
}