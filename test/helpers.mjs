import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { unpack } from '../dist/mcp/client.js';

export async function gateway(dataDir, extras = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '',
      TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '', RP_DATA_DIR: dataDir, RP_TIMEOUT_MS: '500',
      RP_MODE: 'sandbox', RP_TRANSPORT: 'stdio', NITRO_MCP_PROTOCOL_VERSION: 'legacy', ...extras }, stderr: 'pipe' });
  let diagnostics = ''; transport.stderr?.on('data', d => { diagnostics += d.toString(); });
  const client = new Client({ name: 'retryproof-test-client', version: '0.1.0' });
  try { await client.connect(transport); } catch (e) { await transport.close(); throw new Error(`${e.message}\n${diagnostics}`); }
  return { client, transport, call: async (name, args, metadata = {}) => unpack(await client.callTool({ name, arguments: args, _meta: metadata })),
    close: () => client.close() };
}
