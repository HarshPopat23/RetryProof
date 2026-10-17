import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderClient } from '../dist/mcp/client.js';
import { configuration } from '../dist/config.js';
import { gateway } from '../test/helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'retryproof-demo-'));
const config = configuration({ RP_DATA_DIR: dir, RP_TIMEOUT_MS: '500' });
const issue = new ProviderClient('issue', config), tracking = new ProviderClient('tracking', config);
let g;
const out = resolve(process.argv[2] ?? 'evidence/demo-results.json');
const transcript = { generated_at: new Date().toISOString(), node: process.version,
  evidence_type: 'Executed sandbox MCP interactions; no real GitHub writes and no LLM inference',
  scenarios: [] };
async function count(port) { return (await port.call('lab_list_records', {})).records.length; }
try {
  const marker = `rp_${'b'.repeat(64)}`;
  await issue.call('lab_set_fault', { fault: 'lost_response' });
  let timedOut = false;
  try { await issue.call('issue_create', { marker, title: 'Unsafe baseline', body: '', sourceId: '' }); }
  catch { timedOut = true; }
  assert.equal(timedOut, true);
  await issue.call('issue_create', { marker, title: 'Unsafe baseline', body: '', sourceId: '' });
  assert.equal(await count(issue), 2);
  transcript.scenarios.push({ name: 'baseline_blind_retry', response_lost: timedOut, issue_records: 2, verdict: 'duplicate_reproduced' });
  console.log('BASELINE: real MCP timeout + blind retry created 2 records for 1 task.');

  g = await gateway(dir);
  const capabilities = await g.call('rp_discover_capabilities', {});
  await issue.call('lab_set_fault', { fault: 'lost_response' });
  const paused = await g.call('rp_start_workflow', { request_id: 'protected', title: 'Fix parser crash', body: 'Reproduction: parse an empty configuration.' });
  assert.equal(paused.status, 'paused');
  const records = (await issue.call('lab_list_records', {})).records;
  const created = records.find(r => r.title === 'Fix parser crash'); assert.ok(created);
  await issue.call('lab_edit_record', { id: created.id, title: 'Maintainer: preserve this correction' });
  await g.close(); g = await gateway(dir);
  const receipt = await g.call('rp_resume_workflow', { request_id: 'protected' });
  assert.equal(receipt.status, 'completed');
  assert.equal(await count(issue), 3); assert.equal(await count(tracking), 1);
  assert.equal(receipt.operations[0].evidence.effect.title, 'Maintainer: preserve this correction');
  const replay = await g.call('rp_resume_workflow', { request_id: 'protected' });
  assert.deepEqual(replay, receipt);
  transcript.scenarios.push({ name: 'verified_recovery_after_restart', issue_records_for_this_task: 1,
    tracking_records: 1, human_edit_preserved: true, replay_no_new_writes: true, capabilities, paused_receipt: paused, recovered_receipt: receipt });
  console.log('PROTECTED: restart + reconciliation reused 1 issue, created 1 tracking record, preserved the human edit.');

  await issue.call('lab_set_fault', { fault: 'hidden_read' });
  const hidden = await g.call('rp_start_workflow', { request_id: 'unknown', title: 'Read is temporarily stale', body: '' });
  const before = await count(issue);
  for (let i = 0; i < 5; i++) assert.equal((await g.call('rp_resume_workflow', { request_id: 'unknown' })).status, 'paused');
  assert.equal(await count(issue), before); assert.equal(await count(tracking), 1);
  transcript.scenarios.push({ name: 'absence_is_not_non_execution', retries: 5, repeated_writes: 0, status: hidden.status, receipt: hidden });
  console.log('UNKNOWN: 5 recovery requests while reads hid the record caused 0 repeated writes.');
  mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(out, JSON.stringify(transcript, null, 2) + '\n');
  console.log(`Saved executed evidence: ${out}`);
} finally {
  await Promise.allSettled([g?.close(), issue.close(), tracking.close()]); rmSync(dir, { recursive: true, force: true });
}
