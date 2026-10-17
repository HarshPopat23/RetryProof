import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError, type Event, type Evidence, type Operation, type Run, type State } from './types.js';

type Row = Record<string, unknown>;
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, readonly workspace: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS runs (
        workspace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(workspace,id));
      CREATE TABLE IF NOT EXISTS operations (
        workspace TEXT NOT NULL, key TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, PRIMARY KEY(workspace,key));
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, operation_key TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  registerRun(run: Run): Run {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT fingerprint,data FROM runs WHERE workspace=? AND id=?')
        .get(this.workspace, run.id) as Row | undefined;
      if (row) {
        if (row.fingerprint !== run.fingerprint) throw new DomainError('KEY_CONFLICT', 'This request_id already belongs to different content or targets. Use a new request_id for intentional new work.');
        return JSON.parse(String(row.data)) as Run;
      }
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(this.workspace, run.id, run.fingerprint, JSON.stringify(run));
      return run;
    });
  }
  run(id: string): Run {
    const row = this.db.prepare('SELECT data FROM runs WHERE workspace=? AND id=?').get(this.workspace, id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Unknown request_id in this workspace.');
    return JSON.parse(String(row.data)) as Run;
  }
  get(key: string): Operation | undefined {
    const row = this.db.prepare('SELECT data FROM operations WHERE workspace=? AND key=?').get(this.workspace, key) as Row | undefined;
    return row ? JSON.parse(String(row.data)) as Operation : undefined;
  }
  prepare(operation: Operation): Operation {
    return this.atomic(() => {
      const existing = this.get(operation.key);
      if (existing) {
        if (existing.fingerprint !== operation.fingerprint || existing.marker !== operation.marker)
          throw new DomainError('IDENTITY_CHANGED', 'Operation content or signing secret changed. Restore the original configuration; do not repeat the write.');
        return existing;
      }
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(
        this.workspace, operation.key, operation.runId, operation.state, 0, JSON.stringify(operation));
      this.event(operation.key, 'prepared', 'Intent persisted before dispatch');
      return operation;
    });
  }
  transition(operation: Operation, state: State, reason: string, evidence: Evidence | null = null): Operation {
    return this.atomic(() => {
      const current = this.get(operation.key);
      if (!current) throw new DomainError('NOT_FOUND', 'Operation disappeared.');
      // Concurrent reconciliation can finish while an original call is returning.
      // A stale worker may never overwrite a newer receipt or increment attempts.
      if (current.version !== operation.version) return current;
      const allowed: Record<State, State[]> = {
        prepared: ['in_flight'], in_flight: ['unknown', 'verified', 'blocked'],
        unknown: ['unknown', 'verified', 'blocked'], blocked: ['unknown', 'verified', 'blocked'], verified: [],
      };
      if (!allowed[current.state].includes(state)) throw new DomainError('INVALID_TRANSITION', `${current.state} -> ${state}`);
      const next: Operation = { ...current, state, reason, evidence, version: current.version + 1,
        attempts: current.attempts + (state === 'in_flight' ? 1 : 0) };
      this.db.prepare('UPDATE operations SET state=?,version=?,data=? WHERE workspace=? AND key=? AND version=?')
        .run(state, next.version, JSON.stringify(next), this.workspace, next.key, current.version);
      this.event(next.key, state, reason);
      return next;
    });
  }
  // An atomic claim is separate from transition(): the caller must know whether
  // it owns this dispatch. Seeing somebody else's in_flight state is not ownership.
  claim(operation: Operation): { owned: boolean; operation: Operation } {
    return this.atomic(() => {
      const current = this.get(operation.key);
      if (!current) throw new DomainError('NOT_FOUND', 'Operation disappeared.');
      if (current.state !== 'prepared' || current.version !== operation.version) return { owned: false, operation: current };
      const next: Operation = { ...current, state: 'in_flight', attempts: 1, version: current.version + 1, reason: 'Dispatch ownership committed before the external call' };
      this.db.prepare('UPDATE operations SET state=?,version=?,data=? WHERE workspace=? AND key=?').run(
        next.state, next.version, JSON.stringify(next), this.workspace, next.key);
      this.event(next.key, next.state, next.reason);
      return { owned: true, operation: next };
    });
  }
  operations(runId: string): Operation[] {
    return (this.db.prepare('SELECT data FROM operations WHERE workspace=? AND run_id=? ORDER BY key')
      .all(this.workspace, runId) as Row[]).map(row => JSON.parse(String(row.data)) as Operation);
  }
  events(runId: string): Event[] {
    return (this.db.prepare(`SELECT e.seq,e.operation_key,e.state,e.reason,e.at FROM events e
      JOIN operations o ON e.workspace=o.workspace AND e.operation_key=o.key
      WHERE e.workspace=? AND o.run_id=? ORDER BY e.seq DESC LIMIT 200`).all(this.workspace, runId) as Row[])
      .reverse().map(r => ({ seq: Number(r.seq), operationKey: String(r.operation_key), state: String(r.state) as State, reason: String(r.reason), at: String(r.at) }));
  }
  eventCount(runId: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM events e JOIN operations o
      ON e.workspace=o.workspace AND e.operation_key=o.key WHERE e.workspace=? AND o.run_id=?`)
      .get(this.workspace, runId) as Row).count);
  }
  private event(key: string, state: State, reason: string): void {
    this.db.prepare('INSERT INTO events(workspace,operation_key,state,reason,at) VALUES(?,?,?,?,?)')
      .run(this.workspace, key, state, reason, new Date().toISOString());
  }
  close(): void { this.db.close(); }
}
