import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startupEnvironment } from '../dist/startup.js';
import { configuration } from '../dist/config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { unpack } from '../dist/mcp/client.js';

test('hosted defaults select HTTP while explicit STDIO and caller environment are preserved', () => {
  const env = { NODE_ENV: 'production', PORT: '3000' }, hosted = startupEnvironment(env);
  assert.equal(hosted.RP_TRANSPORT, 'http'); assert.equal(hosted.RP_HOST, '0.0.0.0'); assert.equal(hosted.RP_AUTH_TOKEN, undefined);
  assert.equal(env.RP_TRANSPORT, undefined);
  const explicit = startupEnvironment({ ...env, RP_TRANSPORT: 'stdio' });
  assert.equal(explicit.RP_TRANSPORT, 'stdio'); assert.equal(explicit.RP_HOST, '127.0.0.1');
  assert.equal(startupEnvironment({}).RP_TRANSPORT, 'stdio');
  assert.throws(() => configuration(hosted), /RP_AUTH_TOKEN/);
  assert.throws(() => configuration({ ...hosted, RP_AUTH_TOKEN: 'sandbox-production-auth-token-min-32-chars-long' }), /RP_AUTH_TOKEN/);
});

test('production startup fails clearly without printing a token or silently allowing public writes', () => {
  const result = spawnSync(process.execPath, ['dist/index.js'], { encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', RP_AUTH_TOKEN: '', RP_DATA_DIR: '/not-used' } });
  assert.equal(result.status, 1); assert.match(result.stderr, /RetryProof startup failed.*CONFIG/);
  assert.match(result.stderr, /RP_AUTH_TOKEN/); assert.ok(!result.stderr.includes('sandbox-production-auth-token-min-32-chars-long'));
});

test('production npm-start entry survives closed stdin, serves health/root and completes a real authenticated handoff', async t => {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-cloud-start-'));
  const token = 'private-cloud-test-token-at-least-32-characters';
  const child = spawn(process.execPath, ['dist/index.js'], { stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), RP_DATA_DIR: dir, RP_AUTH_TOKEN: token, RP_MODE: 'sandbox' } });
  const exit = once(child, 'exit'); let diagnostics = '', client;
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  t.after(async () => {
    await client?.close(); if (child.exitCode === null) child.kill('SIGTERM'); await exit;
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`http://127.0.0.1:${port}/mcp/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 30));
  }
  assert.ok(ready, diagnostics); assert.match(diagnostics, /RetryProof ready/); assert.ok(!diagnostics.includes(token));
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  client = new Client({ name: 'cloud-start-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const completed = unpack(await client.callTool({ name: 'rp_start_workflow', arguments: { request_id: 'cloud-start', title: 'Cloud startup check', body: '' } }));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.operations[1].evidence.effect.sourceId, completed.operations[0].evidence.effect.id);
  assert.equal(readFileSync(join(dir, 'gateway.sqlite')).subarray(0, 16).toString(), 'SQLite format 3\u0000');
});
