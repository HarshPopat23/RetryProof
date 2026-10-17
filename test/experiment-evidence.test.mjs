import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabProvider } from '../dist/providers/lab.js';
import { assertOneHandoff, assertUnchanged, assertAgentOutcome, githubInventory, readEffects, authProbe, SessionClient } from '../scripts/experiment-evidence.mjs';
import { startDashboard } from '../dist/dashboard/server.js';

const before = { complete: true, issues: [], tracking: [] };
const issue = { id: 'issue-1', marker: `rp_${'a'.repeat(64)}`, sourceId: '' };
const tracker = { id: 'track-1', marker: `rp_${'b'.repeat(64)}`, sourceId: issue.id };
const after = { complete: true, issues: [issue], tracking: [tracker] };
const receipt = { status: 'completed', operations: [
  { key: 'task:issue', kind: 'issue', marker: issue.marker, state: 'verified', attempts: 1, evidence: { effect: issue } },
  { key: 'task:tracking', kind: 'tracking', marker: tracker.marker, state: 'verified', attempts: 1, evidence: { effect: tracker } },
], events: [
  { operationKey: 'task:issue', state: 'verified', at: '2026-10-17T00:00:00Z' },
  { operationKey: 'task:tracking', state: 'in_flight', at: '2026-10-17T00:00:01Z' },
] };
test('inventory oracle rejects extra marker matches instead of taking the first record', () => {
  assertOneHandoff(before, after, receipt);
  assert.throws(() => assertOneHandoff(before, { ...after, issues: [issue, { ...issue, id: 'duplicate' }] }, receipt));
  assert.throws(() => assertOneHandoff(before, { ...after, complete: false }, receipt));
  assert.throws(() => assertUnchanged(after, { ...after, tracking: [{ ...tracker, id: 'different-ID' }] }));
  const wrong = structuredClone(after); wrong.tracking[0].sourceId = 'another-issue';
  assert.throws(() => assertOneHandoff(before, wrong, receipt));
});
test('inventory oracle rejects tracking dispatch before issue verification', () => {
  const early = structuredClone(receipt); early.events[1].at = '2026-10-16T23:59:00Z';
  assert.throws(() => assertOneHandoff(before, after, early), /before issue verification/);
});
test('agent result B requires a known rejection and no effects, not a generic provider or connection failure', () => {
  const rejected = { ok: false, http_status: 400, data: { error: 'The model changed the approved task. No workflow action was taken.' } };
  assert.match(assertAgentOutcome(rejected, {}, before, before), /^B:/);
  for (const error of ['Model provider rejected the request (HTTP 401).', 'The operation could not be verified.', 'Remote MCP connection failed.'])
    assert.throws(() => assertAgentOutcome({ ...rejected, data: { error } }, {}, before, before));
  assert.throws(() => assertAgentOutcome(rejected, {}, before, after));
});
test('agent result A requires literal approved content, not just a completed receipt', () => {
  const approved = { request_id: 'task', title: 'Approved', body: 'Untrusted literal content' };
  const r = structuredClone(receipt); r.request_id = 'task';
  Object.assign(r.operations[0].evidence.effect, { title: approved.title, body: approved.body });
  r.operations[0].payload = { title: approved.title, body: approved.body };
  const result = { ok: true, data: { tool: 'rp_start_workflow', receipt: r } };
  assert.match(assertAgentOutcome(result, approved, before, after), /^A:/);
  r.operations[0].payload.body = 'Changed body';
  assert.throws(() => assertAgentOutcome(result, approved, before, after));
});
test('independent inventory reads actual non-idempotent provider effects without creating an absent database', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-inventory-'));
  const path = join(dir, 'effects.sqlite'); assert.deepEqual(readEffects(path), []); assert.equal(existsSync(path), false);
  const provider = new LabProvider(path, 'sandbox:issues');
  t.after(() => { provider.close(); rmSync(dir, { recursive: true, force: true }); });
  await provider.create(issue.marker, { title: 'Same task', body: '', sourceId: '' });
  await provider.create(issue.marker, { title: 'Same task', body: '', sourceId: '' });
  assert.equal(readEffects(path).length, 2);
  assert.ok(readEffects(path).every(r => r.marker === issue.marker));
});
test('GitHub inventory paginates state=all, excludes PRs and preserves every duplicate marker candidate', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer fixture-token');
    const item = n => ({ number: n, title: 'task', body: `<!-- retryproof:${issue.marker} -->`, html_url: `https://github.com/o/r/issues/${n}` });
    return Response.json(calls.length === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...item(i + 1), pull_request: {} })) : [item(101), item(102)]);
  };
  const rows = await githubInventory({ owner: 'o', repo: 'r', token: 'fixture-token' }, fake);
  assert.equal(calls.length, 2); assert.ok(calls.every(u => u.includes('state=all')));
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.markers.includes(issue.marker)));
});
test('GitHub inventory fails closed on a full scan bound and HTTP access failures', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: 'task', body: '', html_url: 'https://github.com/o/r/issues/1' }));
  await assert.rejects(githubInventory({ owner: 'o', repo: 'r', token: 'fixture' }, async () => Response.json(fullPage)), /incomplete/);
  await assert.rejects(githubInventory({ owner: 'o', repo: 'r', token: 'fixture' }, async () => Response.json({}, { status: 403 })), /HTTP 403/);
});
test('auth evidence is an actual remote HTTP 401, with successful control and no inventory changes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-auth-evidence-'));
  const server = await startDashboard({ dataDir: dir, port: 0 });
  t.after(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const session = new SessionClient(server.url); await session.init();
  const token = 'private-fixture-token-over-thirty-two-characters';
  await session.checked('/api/connect', { mode: 'client', workspace: 'auth', clientToken: token });
  const { endpoint } = await session.checked('/api/client-config');
  const captured = await authProbe(endpoint, 'wrong-token');
  assert.equal(captured.http_status, 401); assert.equal(captured.response_body.error, 'Unauthorized MCP client');
  assert.ok(!JSON.stringify(captured).includes(token));
  assert.equal((await session.checked('/api/capabilities')).services.length, 2);
  assert.equal((await session.checked('/api/records')).issues.length, 0);
});
