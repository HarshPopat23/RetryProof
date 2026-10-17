import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/core/store.js';
import { Engine } from '../dist/core/engine.js';
import { fingerprint } from '../dist/core/identity.js';
import { configuration } from '../dist/config.js';

class FakePort {
  effects = []; writes = 0; fault = 'none';
  async create(op) {
    this.writes++;
    this.effects.push({ id: String(this.writes), marker: op.marker, target: op.target,
      ...op.payload, url: `https://example.invalid/${this.writes}` });
    if (this.fault === 'lost') throw new Error('Response lost after commit');
    if (this.fault === 'delay') await new Promise(r => setTimeout(r, 20));
  }
  async find(op) {
    if (this.fault === 'unavailable') throw new Error('Offline');
    if (this.fault === 'hidden') return { outcome: 'not_found' };
    if (this.fault === 'duplicate') return { outcome: 'conflict', reason: 'Two candidates' };
    const effect = this.effects.find(e => e.marker === op.marker);
    return effect ? { outcome: 'found', effect: { ...effect } } : { outcome: 'not_found' };
  }
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-core-'));
  const path = join(dir, 'state.sqlite');
  const stores = [];
  const issue = new FakePort(), tracking = new FakePort();
  const config = { secret: 'test-secret', issueTarget: 'sandbox:issues', trackerTarget: 'local:release-board' };
  function engine(workspace = 'test', overrides = {}) {
    const store = new Store(path, workspace); stores.push(store);
    return new Engine(store, { issue, tracking }, { ...config, ...overrides });
  }
  t.after(() => { for (const s of stores) s.close(); rmSync(dir, { recursive: true, force: true }); });
  return { issue, tracking, config, engine };
}

test('successful handoff verifies both actual effects and records ordered events', async t => {
  const f = fixture(t), e = f.engine();
  const r = await e.start('job', 'Fix parser', 'Reproduction attached');
  assert.equal(r.status, 'completed'); assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 1);
  assert.equal(f.tracking.effects[0].sourceId, f.issue.effects[0].id);
  assert.deepEqual(r.events.map(x => x.state), ['prepared','in_flight','verified','prepared','in_flight','verified']);
});
test('lost write response pauses before downstream action, then recovery reuses the effect', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'lost';
  assert.equal((await e.start('job', 'Title', '')).status, 'paused');
  assert.equal(f.tracking.writes, 0);
  f.issue.fault = 'none';
  const recovered = await e.resume('job');
  assert.equal(recovered.status, 'completed'); assert.equal(f.issue.writes, 1);
  assert.equal(recovered.operations[0].evidence.method, 'reconciled_read');
});
test('gateway recreation over the same database recovers uncertain work', async t => {
  const f = fixture(t), first = f.engine(); f.issue.fault = 'lost';
  await first.start('job', 'Title', '');
  const second = f.engine(); f.issue.fault = 'none';
  assert.equal((await second.resume('job')).status, 'completed'); assert.equal(f.issue.writes, 1);
});
test('record not observed after dispatch does not authorize a second write', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'hidden';
  for (let i = 0; i < 12; i++) assert.equal((await e.start('job', 'Title', '')).status, 'paused');
  assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 0);
});
test('verification outage never permits progress or a repeat write', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'unavailable';
  await e.start('job', 'Title', ''); await e.resume('job');
  assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 0);
  f.issue.fault = 'none'; assert.equal((await e.resume('job')).status, 'completed');
});
test('duplicate matches block recovery until independently resolved', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'duplicate';
  const r = await e.start('job', 'Title', '');
  assert.equal(r.operations[0].state, 'blocked'); assert.equal(f.tracking.writes, 0);
  f.issue.fault = 'none'; assert.equal((await e.resume('job')).status, 'completed');
});
test('human edits made before recovery are preserved and included in the receipt', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'lost';
  await e.start('job', 'Original title', ''); f.issue.effects[0].title = 'Human correction';
  f.issue.fault = 'none';
  const r = await e.resume('job');
  assert.equal(r.status, 'completed'); assert.equal(f.issue.effects[0].title, 'Human correction');
  assert.equal(r.operations[0].evidence.effect.title, 'Human correction');
});
test('same key with changed content is rejected before any new effect', async t => {
  const f = fixture(t), e = f.engine(); await e.start('job', 'A', '');
  await assert.rejects(e.start('job', 'B', ''), /different content/);
  assert.equal(f.issue.writes, 1);
});
test('intentional identical tasks with different request ids both execute', async t => {
  const f = fixture(t), e = f.engine();
  await e.start('one', 'Same', ''); await e.start('two', 'Same', '');
  assert.equal(f.issue.writes, 2); assert.notEqual(f.issue.effects[0].marker, f.issue.effects[1].marker);
});
test('concurrent calls sharing one engine dispatch once', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'delay';
  await Promise.all(Array.from({ length: 30 }, () => e.start('job', 'Title', '')));
  await e.resume('job'); assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 1);
});
test('two engines and SQLite connections cannot both claim the same dispatch', async t => {
  const f = fixture(t), a = f.engine(), b = f.engine(); f.issue.fault = 'delay';
  await Promise.all([a.start('job', 'Title', ''), b.start('job', 'Title', '')]);
  await b.resume('job'); assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 1);
});
test('workspace namespace prevents key collisions and receipt access', async t => {
  const f = fixture(t), a = f.engine('A'), b = f.engine('B');
  await a.start('job', 'A', '');
  assert.throws(() => b.status('job'), /Unknown request_id/);
  await b.start('job', 'B', ''); assert.equal(f.issue.writes, 2);
  assert.notEqual(f.issue.effects[0].marker, f.issue.effects[1].marker);
});
test('changed signing key cannot silently rebind an uncertain operation', async t => {
  const f = fixture(t), a = f.engine(); f.issue.fault = 'lost'; await a.start('job', 'Title', '');
  const b = f.engine('test', { secret: 'changed-secret' });
  await assert.rejects(b.resume('job'), /signing secret changed/); assert.equal(f.issue.writes, 1);
});
test('changed destination cannot redirect a persisted workflow', async t => {
  const f = fixture(t), a = f.engine(); f.issue.fault = 'lost'; await a.start('job', 'Title', '');
  const b = f.engine('test', { issueTarget: 'github:other/repo' });
  await assert.rejects(b.resume('job'), /original targets/); assert.equal(f.issue.writes, 1);
});
for (const field of ['marker', 'target', 'sourceId', 'id', 'url']) {
  test(`mismatched ${field} cannot become a verified receipt`, async t => {
    const f = fixture(t), e = f.engine(); f.issue.fault = 'lost'; await e.start('job', 'Title', '');
    f.issue.effects[0][field] = field === 'id' || field === 'url' ? '' : 'untrusted'; f.issue.fault = 'none';
    const r = await e.resume('job');
    assert.notEqual(r.status, 'completed'); assert.equal(f.tracking.writes, 0); assert.equal(f.issue.writes, 1);
  });
}
test('tracking-step timeout recovers without recreating the source issue', async t => {
  const f = fixture(t), e = f.engine(); f.tracking.fault = 'lost';
  assert.equal((await e.start('job', 'Title', '')).status, 'paused');
  f.tracking.fault = 'none'; assert.equal((await e.resume('job')).status, 'completed');
  assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 1);
});
test('repeat completion is stable and has no new dispatches', async t => {
  const f = fixture(t), e = f.engine(); const original = await e.start('job', 'Title', '');
  for (let i = 0; i < 100; i++) assert.deepEqual(await e.resume('job'), original);
  assert.equal(f.issue.writes, 1); assert.equal(f.tracking.writes, 1);
});
test('crash window after dispatch claim but before send pauses instead of guessing', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'lost'; await e.start('job', 'Title', '');
  // Model a process that persisted in_flight then died before issuing the write.
  const op = e.store.operations('job')[0];
  const next = { ...op, state: 'in_flight', version: op.version + 1 };
  e.store.db.prepare('UPDATE operations SET state=?,version=?,data=? WHERE workspace=? AND key=?')
    .run(next.state, next.version, JSON.stringify(next), 'test', next.key);
  f.issue.effects = []; f.issue.fault = 'none';
  assert.equal((await f.engine().resume('job')).status, 'paused'); assert.equal(f.issue.writes, 1);
});
test('stale worker cannot downgrade a receipt written by another worker', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'lost'; await e.start('job', 'Title', '');
  const stale = e.store.operations('job')[0]; f.issue.fault = 'none'; await f.engine().resume('job');
  assert.equal(e.store.transition(stale, 'unknown', 'late failure').state, 'verified');
});
test('unknown id and invalid state changes are explicit errors', async t => {
  const f = fixture(t), e = f.engine(); await assert.rejects(e.resume('missing'), /Unknown/);
  await e.start('job', 'Title', ''); const op = e.store.operations('job')[0];
  assert.throws(() => e.store.transition(op, 'in_flight', 'retry'), /verified -> in_flight/);
});
test('fingerprints ignore field ordering and distinguish values', () => {
  assert.equal(fingerprint({ b: '2', a: '1' }), fingerprint({ a: '1', b: '2' }));
  assert.notEqual(fingerprint({ a: '1' }), fingerprint({ a: '2' }));
});
test('configuration rejects public unauthenticated HTTP and invalid GitHub credentials', () => {
  assert.throws(() => configuration({ RP_TRANSPORT: 'http', RP_HOST: '0.0.0.0' }), /RP_AUTH_TOKEN/);
  assert.throws(() => configuration({ RP_MODE: 'github' }), /explicit owner/);
  assert.throws(() => configuration({ RP_TIMEOUT_MS: '-1' }), /timeout/);
  assert.throws(() => configuration({ RP_WORKSPACE: '../tenant' }), /workspace/);
  assert.throws(() => configuration({ RP_MODE: 'typo' }), /RP_MODE/);
});
test('repeated unknown outcomes keep the receipt bounded without deleting audit history', async t => {
  const f = fixture(t), e = f.engine(); f.issue.fault = 'hidden'; await e.start('job', 'Title', '');
  for (let i = 0; i < 220; i++) await e.resume('job');
  const r = e.status('job');
  assert.equal(r.events.length, 200); assert.equal(r.events_truncated, true);
  assert.equal(r.event_count, 223); assert.equal(f.issue.writes, 1);
  assert.ok(r.events.every((x, i) => i === 0 || r.events[i - 1].seq < x.seq));
});
test('run registered before step preparation resumes after a crash', async t => {
  const f = fixture(t), e = f.engine();
  e.store.registerRun({ id: 'before-prepare', title: 'Title', body: '', issueTarget: f.config.issueTarget,
    trackerTarget: f.config.trackerTarget, fingerprint: fingerprint({ title: 'Title', body: '',
      issueTarget: f.config.issueTarget, trackerTarget: f.config.trackerTarget }) });
  assert.equal((await f.engine().resume('before-prepare')).status, 'completed'); assert.equal(f.issue.writes, 1);
});
test('seeded mixed fault sequences preserve effect-count and source-link invariants', async t => {
  const f = fixture(t), e = f.engine(); let seed = 0x72ab17;
  function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
  const faults = ['none','lost','hidden','unavailable','duplicate'];
  for (let task = 0; task < 40; task++) {
    const id = `sequence-${task}`;
    for (let step = 0; step < 12; step++) {
      f.issue.fault = faults[Math.floor(random() * faults.length)];
      f.tracking.fault = faults[Math.floor(random() * faults.length)];
      const result = await e.start(id, 'Repeated visible title', '');
      for (const op of result.operations) {
        const effects = f[op.kind].effects.filter(x => x.marker === op.marker);
        assert.ok(effects.length <= 1, `${id}: ${op.kind} duplicated`);
        if (op.state === 'verified') assert.equal(effects.length, 1);
      }
      if (result.operations.some(o => o.kind === 'tracking'))
        assert.equal(result.operations.find(o => o.kind === 'issue').state, 'verified');
    }
    f.issue.fault = 'none'; f.tracking.fault = 'none';
    assert.equal((await e.resume(id)).status, 'completed');
  }
  assert.equal(f.issue.writes, 40); assert.equal(f.tracking.writes, 40);
});
test('read-only provider preflight failure leaves undispatched work safely retryable', async t => {
  const f = fixture(t), e = f.engine();
  f.issue.ready = async () => { throw new Error('Transport is not initialized'); };
  const paused = await e.start('preflight', 'Title', '');
  assert.equal(paused.status, 'paused'); assert.equal(paused.operations[0].state, 'prepared');
  assert.equal(paused.operations[0].attempts, 0); assert.equal(f.issue.writes, 0);
  f.issue.ready = async () => {};
  assert.equal((await e.resume('preflight')).status, 'completed'); assert.equal(f.issue.writes, 1);
});
