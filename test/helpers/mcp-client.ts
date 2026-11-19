// Test helper: connects createServer({ root }) and an MCP Client through the SDK's in-memory transport.
// No child process is started.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../tools/mcp-ears/server';

const CLIENT_NAME = 'mcp-ears-test';
const CLIENT_VERSION = '0.0.0';

export interface Connected { client: Client; close: () => Promise<void> }

export async function connect(root: string): Promise<Connected> {
  const server = createServer({ root });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface ToolText { isError: boolean; text: string }

// Calls a tool and returns the first text item. A protocol error (thrown by the client) is reported as an error too.
export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolText> {
  try {
    const r = await client.callTool({ name, arguments: args });
    const content = (r.content ?? []) as { type: string; text?: string }[];
    return { isError: r.isError === true, text: content.find((c) => c.type === 'text')?.text ?? '' };
  } catch (e) {
    return { isError: true, text: e instanceof Error ? e.message : String(e) };
  }
}
