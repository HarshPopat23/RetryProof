import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createProfile, setupSchema, type Profile, type ProfileOptions } from './profiles.js';
import { PUBLIC_TOOLS } from './gateway.js';
import { runAgent, taskSchema } from './agent.js';
import { unpack } from '../mcp/client.js';

interface Session { id: string; csrf: string; touched: number; busy: boolean; profile: Profile | null }
interface ProxySession { owner: string; server: Server; transport: StreamableHTTPServerTransport }
export interface DashboardOptions { dataDir: string; port?: number; allowedOrigins?: string[]; fetcher?: typeof fetch }
const idSchema = z.object({ request_id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }).strict();
const recordSchema = z.object({ operations: z.array(z.object({ kind: z.string(), evidence: z.object({ effect: z.unknown() }).nullable() }).passthrough()) }).passthrough();

function equal(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function reply(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
}
async function json(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('JSON content type required');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 65536) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function startDashboard(options: DashboardOptions) {
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const keyPath = join(options.dataDir, 'dashboard.key');
  try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const masterKey = readFileSync(keyPath);
  if (masterKey.length !== 32) throw new Error('Invalid dashboard key file');
  const profileOptions: ProfileOptions = { dataDir: options.dataDir, masterKey,
    allowedOrigins: options.allowedOrigins ?? [], ...(options.fetcher ? { fetcher: options.fetcher } : {}) };
  const sessions = new Map<string, Session>(), proxySessions = new Map<string, ProxySession>();
  const staticRoot = fileURLToPath(new URL('../../web/', import.meta.url));
  let baseUrl = '';
  async function dropProfile(s: Session): Promise<void> {
    for (const [id, p] of proxySessions) if (p.owner === s.id) {
      proxySessions.delete(id); await p.server.close();
    }
    const old = s.profile; s.profile = null; await old?.close();
  }
  function session(req: IncomingMessage, res: ServerResponse, create = false): Session | undefined {
    const id = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('rp_ui='))?.slice(6);
    let s = id ? sessions.get(id) : undefined;
    if (!s && create) {
      if (sessions.size >= 32) throw new Error('Session limit reached. Restart the local dashboard to clear idle sessions.');
      s = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), touched: Date.now(), busy: false, profile: null };
      sessions.set(s.id, s); res.setHeader('Set-Cookie', `rp_ui=${s.id}; HttpOnly; SameSite=Strict; Path=/`);
    }
    if (s) s.touched = Date.now(); return s;
  }
  function summary(p: Profile | null) {
    return p ? { connected: true, mode: p.mode, backend: p.config?.mode ?? 'remote',
      workspace: p.config?.workspace ?? null, target: p.config?.issueTarget ?? 'Remote RetryProof server',
      faultsEnabled: p.config?.mode === 'sandbox', agentEnabled: !!p.agent, clientEnabled: p.mode === 'client',
      provider: p.agent?.provider ?? null, model: p.agent?.model ?? null } : { connected: false };
  }
  async function externalMcp(req: IncomingMessage, res: ServerResponse, exportId: string): Promise<void> {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const s = [...sessions.values()].find(s => s.profile?.mode === 'client' && s.profile.exportId === exportId && equal(s.profile.clientToken, bearer));
    if (!s?.profile) { reply(res, 401, { error: 'Unauthorized MCP client' }); return; }
    s.touched = Date.now(); const p = s.profile;
    const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : '';
    let proxy = sessionId ? proxySessions.get(sessionId) : undefined;
    if (proxy && proxy.owner !== s.id) { reply(res, 403, { error: 'MCP session belongs to another connection' }); return; }
    const body = req.method === 'POST' ? await json(req) : undefined;
    if (!proxy) {
      if (req.method !== 'POST' || !isInitializeRequest(body)) { reply(res, 400, { error: 'Initialize the MCP client first' }); return; }
      if ([...proxySessions.values()].filter(x => x.owner === s.id).length >= 8) { reply(res, 429, { error: 'MCP session limit reached' }); return; }
      const server = new Server({ name: 'retryproof-dashboard-bridge', version: '0.2.0' }, { capabilities: { tools: {} } });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
        onsessioninitialized: id => { proxySessions.set(id, { owner: s.id, server, transport }); } });
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        const catalog = await p.gateway.client.listTools(); return { tools: catalog.tools.filter(t => PUBLIC_TOOLS.has(t.name)) };
      });
      server.setRequestHandler(CallToolRequestSchema, async request => {
        if (!PUBLIC_TOOLS.has(request.params.name)) throw new Error('Unsupported tool');
        if (s.busy) throw new Error('Dashboard connection is busy; retry with the same task identity');
        s.busy = true;
        try {
          const result = await p.gateway.client.callTool({ name: request.params.name, arguments: request.params.arguments ?? {} }, undefined, { timeout: 60000 });
          if (!('isError' in result && result.isError) && request.params.name !== 'rp_discover_capabilities') p.lastReceipt = unpack(result);
          return result as CallToolResult;
        } finally { s.busy = false; }
      });
      await server.connect(transport as Transport);
      const oldClose = transport.onclose;
      transport.onclose = () => { oldClose?.(); if (transport.sessionId) proxySessions.delete(transport.sessionId); };
      proxy = { owner: s.id, server, transport };
    }
    await proxy.transport.handleRequest(req, res, body);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      if (`http://${req.headers.host}` !== baseUrl) { reply(res, 403, { error: 'Invalid host' }); return; }
      if (req.headers.origin && req.headers.origin !== baseUrl) { reply(res, 403, { error: 'Cross-origin access denied' }); return; }
      const url = new URL(req.url ?? '/', baseUrl);
      const mcp = /^\/mcp\/([a-f0-9]{64})$/.exec(url.pathname);
      if (mcp) { await externalMcp(req, res, mcp[1]!); return; }
      const assets: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
        '/app.js': ['app.js','application/javascript'], '/style.css': ['style.css','text/css'] };
      const asset = assets[url.pathname];
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(readFileSync(join(staticRoot, asset[0]))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const s = session(req, res, true)!;
        reply(res, 200, { csrf: s.csrf, connection: summary(s.profile), allowedOrigins: profileOptions.allowedOrigins }); return;
      }
      const s = session(req, res);
      if (!s) { reply(res, 401, { error: 'Open the dashboard before calling its API' }); return; }
      if (req.method === 'POST') {
        if (!equal(String(req.headers['x-rp-csrf'] ?? ''), s.csrf)) { reply(res, 403, { error: 'Invalid session token. Reload the dashboard.' }); return; }
        if (s.busy) { reply(res, 409, { error: 'An operation is still running. Keep the same request ID and wait for its result.' }); return; }
        s.busy = true;
        try {
          const input = await json(req);
          if (url.pathname === '/api/connect') {
            const candidate = await createProfile(setupSchema.parse(input), profileOptions);
            try { await dropProfile(s); s.profile = candidate; }
            catch { await candidate.close(); throw new Error('Could not replace the previous connection'); }
            reply(res, 200, summary(s.profile)); return;
          }
          if (url.pathname === '/api/disconnect') { z.object({}).strict().parse(input); await dropProfile(s); reply(res, 200, { connected: false }); return; }
          const p = s.profile; if (!p) { reply(res, 409, { error: 'Choose a setup option and connect first' }); return; }
          if (url.pathname === '/api/start' || url.pathname === '/api/resume') {
            const args = url.pathname === '/api/start' ? taskSchema.parse(input) : idSchema.parse(input);
            const receipt = await p.gateway.call(url.pathname === '/api/start' ? 'rp_start_workflow' : 'rp_resume_workflow', args);
            p.lastReceipt = receipt; reply(res, 200, receipt); return;
          }
          if (url.pathname === '/api/fault') {
            const parsed = z.object({ fault: z.enum(['none','lost_response','hidden_read','unavailable']) }).strict().parse(input);
            if (!p.issue) { reply(res, 409, { error: 'Fault injection is available only for a local sandbox' }); return; }
            await p.issue.call('lab_set_fault', parsed); reply(res, 200, { fault: parsed.fault }); return;
          }
          if (url.pathname === '/api/agent') {
            const args = z.object({ action: z.enum(['start','resume']), task: taskSchema }).strict().parse(input);
            if (!p.agent) { reply(res, 409, { error: 'Connect an API-powered agent first' }); return; }
            const result = await runAgent(p.gateway, p.agent, args.task, args.action, options.fetcher ?? fetch);
            p.lastReceipt = result.receipt; reply(res, 200, result); return;
          }
        } finally { s.busy = false; }
      }
      if (req.method === 'GET') {
        const p = s.profile; if (!p) { reply(res, 409, { error: 'Connect first' }); return; }
        if (url.pathname === '/api/capabilities') { reply(res, 200, await p.gateway.call('rp_discover_capabilities', {})); return; }
        if (url.pathname === '/api/receipt') {
          const args = idSchema.parse({ request_id: url.searchParams.get('request_id') });
          const receipt = await p.gateway.call('rp_get_receipt', args); p.lastReceipt = receipt; reply(res, 200, receipt); return;
        }
        if (url.pathname === '/api/records') {
          if (p.issue && p.tracking) {
            const [issues, tracking] = await Promise.all([p.issue.call('lab_list_records', {}), p.tracking.call('lab_list_records', {})]);
            const list = z.object({ records: z.array(z.unknown()) });
            reply(res, 200, { source: 'sandbox-ledger', issues: list.parse(issues).records, tracking: list.parse(tracking).records });
          } else {
            const receipt = p.lastReceipt ? recordSchema.parse(p.lastReceipt) : null;
            reply(res, 200, { source: 'verified-receipt', issues: receipt?.operations.filter(o => o.kind === 'issue' && o.evidence).map(o => o.evidence!.effect) ?? [],
              tracking: receipt?.operations.filter(o => o.kind === 'tracking' && o.evidence).map(o => o.evidence!.effect) ?? [] });
          }
          return;
        }
        if (url.pathname === '/api/client-config') {
          if (p.mode !== 'client') { reply(res, 409, { error: 'Connect using the MCP client setup option first' }); return; }
          const endpoint = `${baseUrl}/mcp/${p.exportId}`;
          reply(res, 200, { endpoint, configuration: { mcpServers: { retryproof: { url: endpoint,
            headers: { Authorization: 'Bearer <YOUR_CLIENT_TOKEN>' } } } },
            instructions: 'Use this URL in NitroStudio or your MCP client. Enter the client bearer token you chose. The dashboard must stay running.' }); return;
        }
      }
      reply(res, 404, { error: 'Unknown dashboard endpoint' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      // Never return upstream tool/model payloads or credential-containing stacks.
      const message = error instanceof z.ZodError ? 'Check the required fields and input limits.'
        : error instanceof Error ? error.message : 'Request failed';
      const safeMessages = ['Choose ', 'Use an MCP ', 'Remote origin ', 'Remote MCP ', 'Could not ', 'GitHub access ', 'Model provider ',
        'The model ', 'This endpoint ', 'JSON content ', 'Request too ', 'Invalid session'];
      reply(res, 400, { error: safeMessages.some(prefix => message.startsWith(prefix)) ? message : 'The operation could not be verified. Check the connection and receipt before retrying with the same request ID.' });
    }
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 3400, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Invalid listen address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const cleanup = setInterval(() => {
    for (const s of sessions.values()) if (!s.busy && Date.now() - s.touched > 45 * 60 * 1000) {
      sessions.delete(s.id); void dropProfile(s);
    }
  }, 60000); cleanup.unref();
  return { url: baseUrl, async close() {
    clearInterval(cleanup); await Promise.allSettled([...sessions.values()].map(dropProfile)); sessions.clear();
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
