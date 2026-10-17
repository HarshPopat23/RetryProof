import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fileURLToPath } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Config } from '../config.js';
import { unpack } from '../mcp/client.js';

export const PUBLIC_TOOLS = new Set(['rp_start_workflow', 'rp_resume_workflow', 'rp_get_receipt', 'rp_discover_capabilities']);
export interface Gateway {
  client: Client;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export class ConnectedGateway implements Gateway {
  readonly client = new Client({ name: 'retryproof-dashboard', version: '0.2.0' });
  private constructor() {}
  static async local(config: Config): Promise<ConnectedGateway> {
    const gateway = new ConnectedGateway();
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    Object.assign(env, { RP_MODE: config.mode, RP_DATA_DIR: config.dataDir, RP_WORKSPACE: config.workspace,
      RP_MARKER_SECRET: config.secret, RP_GITHUB_OWNER: config.githubOwner, RP_GITHUB_REPO: config.githubRepo,
      RP_GITHUB_TOKEN: config.githubToken, RP_TIMEOUT_MS: String(config.timeoutMs),
      RP_TRANSPORT: 'stdio', RP_AUTH_TOKEN: '', NITRO_MCP_PROTOCOL_VERSION: 'legacy' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../index.js', import.meta.url))], env, stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    try { await gateway.client.connect(transport); await gateway.check(); return gateway; }
    catch { await transport.close(); throw new Error('Could not initialize the local MCP gateway. Check Node 24+, build output and directory permissions.'); }
  }
  static async remote(url: URL, token: string): Promise<ConnectedGateway> {
    const gateway = new ConnectedGateway();
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'error' },
      // Reject all redirects, including GET/SSE redirects, before a bearer can move.
      fetch: (input, init) => {
        const target = new URL(input instanceof Request ? input.url : String(input));
        if (target.origin !== url.origin || target.pathname !== url.pathname) throw new Error('Remote endpoint changed');
        return fetch(input, { ...init, redirect: 'error' });
      }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    // SDK transport declarations use `property | undefined` for optional members;
    // normalize only this SDK boundary while keeping application types strict.
    try { await gateway.client.connect(transport as Transport, { timeout: 15000 }); await gateway.check(); return gateway; }
    catch { await transport.close(); throw new Error('Remote MCP connection failed. Check its URL, bearer token and RetryProof tool availability.'); }
  }
  private async check(): Promise<void> {
    const result = await this.client.listTools(undefined, { timeout: 15000 });
    if (![...PUBLIC_TOOLS].every(name => result.tools.some(t => t.name === name)))
      throw new Error('This endpoint does not expose all four RetryProof tools');
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!PUBLIC_TOOLS.has(name)) throw new Error('Unsupported tool');
    return unpack(await this.client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }) as CallToolResult);
  }
  async close(): Promise<void> { await this.client.close(); }
}
