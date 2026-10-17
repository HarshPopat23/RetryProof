import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { unpack } from '../dist/mcp/client.js';

test('HTTP MCP transport accepts the bearer credential and rejects unauthorized tool calls', async t => {
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(r => portServer.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-http-'));
  const token = 'http-test-bearer-key-at-least-thirty-two-characters';
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
    env: { PATH: process.env.PATH ?? '', RP_DATA_DIR: dir, RP_TRANSPORT: 'http', RP_HOST: '127.0.0.1',
      RP_PORT: String(port), RP_AUTH_TOKEN: token, RP_MODE: 'sandbox', NITRO_MCP_PROTOCOL_VERSION: 'legacy' },
    stdio: ['ignore','ignore','pipe'],
  });
  let diagnostics = ''; child.stderr.on('data', d => { diagnostics += d.toString(); });
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(c => c.close()));
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/mcp/health`); if (r.ok) { ready = true; break; } } catch {}
    await delay(30);
  }
  assert.ok(ready, diagnostics);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  async function connect(headers) {
    const c = new Client({ name: 'retryproof-http-test', version: '0.1.0' }); clients.push(c);
    await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } })); return c;
  }
  const anonymous = await connect({});
  assert.equal((await anonymous.callTool({ name: 'rp_discover_capabilities', arguments: {} })).isError, true);
  const authorized = await connect({ Authorization: `Bearer ${token}` });
  const r = unpack(await authorized.callTool({ name: 'rp_start_workflow', arguments: { request_id: 'http-run', title: 'HTTP works', body: '' } }));
  assert.equal(r.status, 'completed');
});
