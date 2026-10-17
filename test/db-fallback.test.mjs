import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FallbackDatabaseSync } from '../dist/core/db.js';

test('Node 20 compatibility driver uses real SQLite queries, rollback and persistence', t => {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-fallback-'));
  const path = join(dir, 'test.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const db = new FallbackDatabaseSync(path);
  assert.equal(existsSync(path), true, 'Database file must exist before Store calls chmod');
  db.exec(`
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS runs (workspace TEXT, id TEXT, fingerprint TEXT, data TEXT, PRIMARY KEY(workspace,id));
    CREATE TABLE IF NOT EXISTS operations (workspace TEXT, key TEXT, run_id TEXT, state TEXT, version INTEGER, data TEXT, PRIMARY KEY(workspace,key));
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT, operation_key TEXT, state TEXT, reason TEXT, at TEXT);
  `);

  // Insert Run
  const run1 = { workspace: 'ws1', id: 'run1', fingerprint: 'fp1', data: JSON.stringify({ id: 'run1' }) };
  const insRun = db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(run1.workspace, run1.id, run1.fingerprint, run1.data);
  assert.equal(insRun.changes, 1);
  assert.throws(() => db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(run1.workspace, run1.id, 'changed', '{}'), /UNIQUE/);
  assert.throws(() => db.prepare('THIS IS NOT SQL'), /syntax error/);

  // Select Run
  const selRun = db.prepare('SELECT fingerprint,data FROM runs WHERE workspace=? AND id=?').get('ws1', 'run1');
  assert.equal(selRun.fingerprint, 'fp1');
  assert.equal(selRun.data, run1.data);

  // Insert Operation
  const op1 = { workspace: 'ws1', key: 'op1', run_id: 'run1', state: 'prepared', version: 0, data: JSON.stringify({ key: 'op1' }) };
  db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(op1.workspace, op1.key, op1.run_id, op1.state, op1.version, op1.data);

  // Select Operation
  const selOp = db.prepare('SELECT data FROM operations WHERE workspace=? AND key=?').get('ws1', 'op1');
  assert.equal(selOp.data, op1.data);

  // Update Operation with version
  const upd1 = db.prepare('UPDATE operations SET state=?,version=?,data=? WHERE workspace=? AND key=? AND version=?')
    .run('in_flight', 1, JSON.stringify({ key: 'op1', state: 'in_flight' }), 'ws1', 'op1', 0);
  assert.equal(upd1.changes, 1);

  // Stale version update should fail
  const updStale = db.prepare('UPDATE operations SET state=?,version=?,data=? WHERE workspace=? AND key=? AND version=?')
    .run('verified', 2, JSON.stringify({ key: 'op1', state: 'verified' }), 'ws1', 'op1', 0);
  assert.equal(updStale.changes, 0);

  // Insert Events
  db.prepare('INSERT INTO events(workspace,operation_key,state,reason,at) VALUES(?,?,?,?,?)')
    .run('ws1', 'op1', 'prepared', 'Persisted', new Date().toISOString());
  db.prepare('INSERT INTO events(workspace,operation_key,state,reason,at) VALUES(?,?,?,?,?)')
    .run('ws1', 'op1', 'in_flight', 'Sent', new Date().toISOString());

  // Join Events with Operations
  const events = db.prepare(`SELECT e.seq,e.operation_key,e.state,e.reason,e.at FROM events e
    JOIN operations o ON e.workspace=o.workspace AND e.operation_key=o.key
    WHERE e.workspace=? AND o.run_id=? ORDER BY e.seq DESC LIMIT 200`).all('ws1', 'run1');
  assert.equal(events.length, 2);
  assert.equal(events[0].state, 'in_flight');
  assert.equal(events[1].state, 'prepared');

  // Event Count
  const count = db.prepare(`SELECT COUNT(*) AS count FROM events e JOIN operations o
    ON e.workspace=o.workspace AND e.operation_key=o.key WHERE e.workspace=? AND o.run_id=?`).get('ws1', 'run1');
  assert.equal(count.count, 2);

  // Transactions rollback test
  db.exec('BEGIN');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run('ws1', 'run2', 'fp2', '{}');
  assert.ok(db.prepare('SELECT data FROM runs WHERE workspace=? AND id=?').get('ws1', 'run2'));
  db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT data FROM runs WHERE workspace=? AND id=?').get('ws1', 'run2'), undefined);

  db.close();
  assert.equal(readFileSync(path).subarray(0, 16).toString(), 'SQLite format 3\u0000');

  // Test reload from disk in a fresh instance
  const db2 = new FallbackDatabaseSync(path);
  const reloadedRun = db2.prepare('SELECT fingerprint,data FROM runs WHERE workspace=? AND id=?').get('ws1', 'run1');
  assert.equal(reloadedRun.fingerprint, 'fp1');
  db2.close();
});

test('compatibility driver enforces read-only access and preserves invalid legacy JSON', t => {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-real-sqlite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'valid.sqlite'), missing = join(dir, 'missing.sqlite');
  const db = new FallbackDatabaseSync(path); db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY); INSERT INTO records VALUES(1)'); db.close();
  const readOnly = new FallbackDatabaseSync(path, { readOnly: true });
  assert.throws(() => readOnly.exec('INSERT INTO records VALUES(2)'), /readonly/); readOnly.close();
  assert.throws(() => new FallbackDatabaseSync(missing, { readOnly: true })); assert.equal(existsSync(missing), false);
  const legacy = join(dir, 'legacy.sqlite'), original = '{"tables":[],"seq":0}'; writeFileSync(legacy, original);
  assert.throws(() => { const invalid = new FallbackDatabaseSync(legacy); try { invalid.exec('CREATE TABLE x(id)'); } finally { invalid.close(); } });
  assert.equal(readFileSync(legacy, 'utf8'), original, 'Never replace a non-SQLite ledger with empty state');
});
