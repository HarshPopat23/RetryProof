import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DomainPort, Kind, Lookup, Operation } from '../core/types.js';

export const effectSchema = z.object({
  id: z.string().min(1).max(200), marker: z.string().regex(/^rp_[a-f0-9]{64}$/),
  target: z.string().min(1).max(200), title: z.string().max(1000), body: z.string().max(100000),
  sourceId: z.string().max(200), url: z.string().min(1).max(2000),
}).strict();
const lookupSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('found'), effect: effectSchema }).strict(),
  z.object({ outcome: z.literal('not_found') }).strict(),
  z.object({ outcome: z.literal('unavailable'), reason: z.string().max(1000) }).strict(),
  z.object({ outcome: z.literal('conflict'), reason: z.string().max(1000) }).strict(),
]);
export function unpack(result: unknown): unknown {
  const envelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough().parse(result);
  if (envelope.isError) throw new Error('Downstream MCP tool returned an error; outcome may be ambiguous.');
  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  const blocks = envelope.content?.filter(b => b.type === 'text');
  if (blocks?.length !== 1 || !blocks[0]?.text || blocks[0].text.length > 200000)
    throw new Error('Unsupported MCP tool result.');
  return JSON.parse(blocks[0].text) as unknown;
}

// These are deliberately two real MCP connections, not in-process domain calls.
// Downstream URLs and commands are operator configuration, never agent arguments.
export class ProviderClient implements DomainPort {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private connecting: Promise<Client> | undefined;
  constructor(readonly kind: Kind, readonly config: Config) {}
  async connection(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }
  private async connect(): Promise<Client> {
    const env: Record<string, string> = {};
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_EXTRA_CA_CERTS']) {
      const value = process.env[name]; if (value) env[name] = value;
    }
    Object.assign(env, {
      RP_PROVIDER_ROLE: this.kind, RP_PROVIDER_DB: join(this.config.dataDir, `${this.kind}.sqlite`),
      RP_PROVIDER_TARGET: this.kind === 'issue' ? this.config.issueTarget : this.config.trackerTarget,
      RP_PROVIDER_MODE: this.kind === 'issue' ? this.config.mode : 'sandbox',
      RP_TIMEOUT_MS: String(this.config.timeoutMs), NITRO_MCP_PROTOCOL_VERSION: 'legacy',
    });
    // The tracker never receives GitHub credentials; neither service receives
    // the gateway bearer token, marker secret, or complete parent environment.
    if (this.kind === 'issue' && this.config.mode === 'github') Object.assign(env, {
      RP_GITHUB_TOKEN: this.config.githubToken, RP_GITHUB_OWNER: this.config.githubOwner,
      RP_GITHUB_REPO: this.config.githubRepo,
    });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../providers/server.js', import.meta.url))], env, stderr: 'pipe' });
    transport.stderr?.on('data', () => { /* provider diagnostics stay out of MCP stdout */ });
    const client = new Client({ name: 'retryproof-gateway', version: '0.1.0' });
    try {
      await client.connect(transport);
      const catalog = await client.listTools();
      for (const name of [`${this.kind}_create`, `${this.kind}_find`]) {
        if (!catalog.tools.some(tool => tool.name === name)) throw new Error(`Missing supported tool ${name}`);
      }
      this.transport = transport;
      this.client = client;
      const protocolOnClose = transport.onclose;
      transport.onclose = () => {
        // Preserve SDK cleanup: it rejects pending requests and clears protocol
        // timers. Replacing it leaked handles after provider shutdown.
        protocolOnClose?.();
        if (this.transport === transport) { this.client = undefined; this.transport = undefined; }
      };
      return client;
    } catch (error) { await transport.close(); throw error; }
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connection();
    return unpack(await client.callTool({ name, arguments: args }, undefined, { timeout: this.config.timeoutMs }));
  }
  async create(operation: Operation): Promise<void> {
    // A creation response is not proof of completion. The engine always reads back.
    await this.call(`${this.kind}_create`, { marker: operation.marker, ...operation.payload });
  }
  async ready(): Promise<void> { await this.connection(); }
  async find(operation: Operation): Promise<Lookup> {
    return lookupSchema.parse(await this.call(`${this.kind}_find`, { marker: operation.marker }));
  }
  async catalog() {
    const client = await this.connection();
    const catalog = await client.listTools();
    return { service: this.kind, tools: catalog.tools.filter(t => !t.name.startsWith('lab_')).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
  }
  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = undefined; this.transport = undefined;
  }
}
