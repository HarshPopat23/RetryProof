import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProviderClient, unpack } from '../dist/mcp/client.js';
import { configuration } from '../dist/config.js';
import { gateway } from './helpers.mjs';

async function setup(t, extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-mcp-'));
  const config = configuration({ RP_DATA_DIR: dir, RP_TIMEOUT_MS: '500' });
  const issue = new ProviderClient('issue', config), tracking = new ProviderClient('tracking', config);
  let g = await gateway(dir, extras);
  t.after(async () => { await Promise.allSettled([g.close(), issue.close(), tracking.close()]); rmSync(dir, { recursive: true, force: true }); });
  return { dir, issue, tracking, get g() { return g; }, async restart() { await g.close(); g = await gateway(dir, extras); } };
}
test('actual NitroStack MCP server discovers two downstream services and runs end to end', async t => {
  const f = await setup(t);
  const tools = await f.g.client.listTools();
  assert.deepEqual(tools.tools.map(x => x.name).sort(), ['rp_discover_capabilities','rp_get_receipt','rp_resume_workflow','rp_start_workflow']);
  const discovered = await f.g.call('rp_discover_capabilities', {});
  assert.equal(discovered.services.length, 2);
  assert.ok(discovered.services.every(s => s.tools.length === 2));
  assert.equal((await f.g.call('rp_start_workflow', { request_id: 'real-wire', title: 'Wire test', body: '' })).status, 'completed');
  assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
  assert.equal((await f.tracking.call('lab_list_records', {})).records.length, 1);
});
test('real MCP timeout after commit recovers after gateway process recreation', async t => {
  const f = await setup(t); await f.issue.call('lab_set_fault', { fault: 'lost_response' });
  const paused = await f.g.call('rp_start_workflow', { request_id: 'timeout', title: 'Keep this issue', body: '' });
  assert.equal(paused.status, 'paused'); assert.equal(paused.operations[0].state, 'unknown');
  const records = (await f.issue.call('lab_list_records', {})).records;
  assert.equal(records.length, 1);
  await f.issue.call('lab_edit_record', { id: records[0].id, title: 'Edited by a maintainer' });
  await f.restart();
  const recovered = await f.g.call('rp_resume_workflow', { request_id: 'timeout' });
  assert.equal(recovered.status, 'completed');
  assert.equal((await f.issue.call('lab_list_records', {})).records[0].title, 'Edited by a maintainer');
  assert.equal((await f.tracking.call('lab_list_records', {})).records.length, 1);
});
test('real MCP hidden read stays paused through repeated recoveries', async t => {
  const f = await setup(t); await f.issue.call('lab_set_fault', { fault: 'hidden_read' });
  await f.g.call('rp_start_workflow', { request_id: 'hidden', title: 'Title', body: '' });
  for (let i = 0; i < 3; i++) assert.equal((await f.g.call('rp_resume_workflow', { request_id: 'hidden' })).status, 'paused');
  assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
  assert.equal((await f.tracking.call('lab_list_records', {})).records.length, 0);
});
for (const fault of ['unavailable','duplicate','wrong_target','malformed']) {
  test(`real MCP ${fault} evidence cannot complete the workflow`, async t => {
    const f = await setup(t); await f.issue.call('lab_set_fault', { fault });
    const r = await f.g.call('rp_start_workflow', { request_id: fault, title: 'Title', body: '' });
    assert.equal(r.status, 'paused'); assert.equal((await f.tracking.call('lab_list_records', {})).records.length, 0);
    await f.issue.call('lab_set_fault', { fault: 'none' });
    assert.equal((await f.g.call('rp_resume_workflow', { request_id: fault })).status, 'completed');
    assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
  });
}
test('unauthorized calls and attempted workspace spoofing are rejected', async t => {
  const token = 'test-authentication-key-at-least-32-characters';
  const f = await setup(t, { RP_AUTH_TOKEN: token });
  await assert.rejects(f.g.call('rp_start_workflow', { request_id: 'auth', title: 'Title', body: '' }), /error/);
  await assert.rejects(f.g.call('rp_start_workflow', { request_id: 'auth', title: 'Title', body: '' }, { authorization: 'Bearer invalid', tenant: 'admin' }), /error/);
  assert.equal((await f.g.call('rp_start_workflow', { request_id: 'auth', title: 'Title', body: '' }, { authorization: `Bearer ${token}` })).status, 'completed');
});
test('wire input validation rejects unknown keys, oversized content and invalid request identifiers', async t => {
  const f = await setup(t);
  for (const args of [
    { request_id: '../escape', title: 'Title', body: '' },
    { request_id: 'x', title: '', body: '' },
    { request_id: 'x', title: 'Title', body: 'x'.repeat(10001) },
    { request_id: 'x', title: 'Title', body: '', target: 'attacker/repo' },
  ]) await assert.rejects(f.g.call('rp_start_workflow', args));
  assert.equal((await f.issue.call('lab_list_records', {})).records.length, 0);
});
test('abrupt process kill after an ambiguous outcome still permits read-only reconciliation', async t => {
  const f = await setup(t); await f.issue.call('lab_set_fault', { fault: 'lost_response' });
  await f.g.call('rp_start_workflow', { request_id: 'killed', title: 'Title', body: '' });
  const pid = f.g.transport.pid; assert.ok(pid);
  process.kill(pid, 'SIGKILL'); await delay(80); await f.restart();
  assert.equal((await f.g.call('rp_resume_workflow', { request_id: 'killed' })).status, 'completed');
  assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
});
test('invalid and error MCP responses are not trusted', () => {
  assert.throws(() => unpack({ isError: true, content: [{ type: 'text', text: '{"accepted":true}' }] }));
  assert.throws(() => unpack({ content: [{ type: 'text', text: 'not JSON' }] }));
  assert.throws(() => unpack({ content: [] }));
});
test('two gateway OS processes sharing one ledger dispatch each operation once', async t => {
  const f = await setup(t), other = await gateway(f.dir);
  try {
    await Promise.all([f.g.call('rp_start_workflow', { request_id: 'process-race', title: 'Title', body: '' }),
      other.call('rp_start_workflow', { request_id: 'process-race', title: 'Title', body: '' })]);
    const recovered = await f.g.call('rp_resume_workflow', { request_id: 'process-race' });
    assert.equal(recovered.status, 'completed', JSON.stringify(recovered, null, 2));
    assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
    assert.equal((await f.tracking.call('lab_list_records', {})).records.length, 1);
  } finally {
    await other.close();
  }
});
test('SIGKILL between external commit and timeout leaves in_flight intent recoverable', async t => {
  const f = await setup(t, { RP_TIMEOUT_MS: '5000' });
  await f.issue.call('lab_set_fault', { fault: 'lost_response' });
  const pending = f.g.call('rp_start_workflow', { request_id: 'commit-crash', title: 'Title', body: '' })
    .then(value => ({ value }), error => ({ error }));
  let committed = false;
  for (let i = 0; i < 100; i++) {
    if ((await f.issue.call('lab_list_records', {})).records.length === 1) { committed = true; break; }
    await delay(20);
  }
  assert.equal(committed, true); process.kill(f.g.transport.pid, 'SIGKILL'); await pending;
  await f.restart();
  const before = await f.g.call('rp_get_receipt', { request_id: 'commit-crash' });
  assert.equal(before.operations[0].state, 'in_flight');
  assert.equal((await f.g.call('rp_resume_workflow', { request_id: 'commit-crash' })).status, 'completed');
  assert.equal((await f.issue.call('lab_list_records', {})).records.length, 1);
});
