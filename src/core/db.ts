import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

export interface StatementSync {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface IDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

interface NativeDatabaseSyncConstructor {
  new (path: string, options?: { readOnly?: boolean; timeout?: number }): IDatabaseSync;
}

let NativeDatabaseSync: NativeDatabaseSyncConstructor | null = null;
try {
  const req = createRequire(import.meta.url);
  // Using dynamic require prevents module translators from throwing ERR_UNKNOWN_BUILTIN_MODULE at import time on Node 20
  const sqliteModule = req('node:sqlite');
  if (sqliteModule && typeof sqliteModule.DatabaseSync === 'function') {
    NativeDatabaseSync = sqliteModule.DatabaseSync as NativeDatabaseSyncConstructor;
  }
} catch {
  NativeDatabaseSync = null;
}

class FallbackStatementSync implements StatementSync {
  constructor(private readonly executor: (mode: 'run' | 'get' | 'all', params: unknown[]) => unknown) {}

  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint } {
    return this.executor('run', params) as { changes?: number; lastInsertRowid?: number | bigint };
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.executor('get', params) as Record<string, unknown> | undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.executor('all', params) as Record<string, unknown>[];
  }
}

export class FallbackDatabaseSync implements IDatabaseSync {
  private tables = new Map<string, Record<string, unknown>[]>();
  private seqCounter = 0;
  private inTransaction = false;
  private snapshot: { tables: Map<string, Record<string, unknown>[]>; seq: number } | null = null;
  private lastMtime = 0;
  private isClosed = false;

  constructor(
    private readonly filePath: string,
    private readonly options?: { readOnly?: boolean; timeout?: number }
  ) {
    this.syncFromDisk();
  }

  private syncFromDisk(): void {
    if (this.filePath === ':memory:' || this.inTransaction || !existsSync(this.filePath)) return;
    try {
      const stats = statSync(this.filePath);
      if (stats.mtimeMs > this.lastMtime) {
        const raw = readFileSync(this.filePath, 'utf8');
        if (raw.trim().startsWith('{')) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.tables)) {
            this.tables = new Map(parsed.tables);
            this.seqCounter = typeof parsed.seq === 'number' ? parsed.seq : 0;
            this.lastMtime = stats.mtimeMs;
          }
        }
      }
    } catch {
      // Continue with in-memory state
    }
  }

  private persist(): void {
    if (this.filePath === ':memory:' || this.inTransaction || this.options?.readOnly) return;
    try {
      const payload = JSON.stringify({
        tables: Array.from(this.tables.entries()),
        seq: this.seqCounter
      });
      writeFileSync(this.filePath, payload, 'utf8');
      const stats = statSync(this.filePath);
      this.lastMtime = stats.mtimeMs;
    } catch {
      // Ignore write errors in fallback mode
    }
  }

  private getTable(name: string): Record<string, unknown>[] {
    let table = this.tables.get(name);
    if (!table) {
      table = [];
      this.tables.set(name, table);
    }
    return table;
  }

  exec(sql: string): void {
    if (this.isClosed) throw new Error('Database is closed');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      const upper = stmt.toUpperCase();
      if (upper.startsWith('PRAGMA') || upper.startsWith('CREATE INDEX')) {
        continue;
      }
      if (upper.startsWith('BEGIN')) {
        this.inTransaction = true;
        const cloned = new Map<string, Record<string, unknown>[]>();
        for (const [k, v] of this.tables.entries()) {
          cloned.set(k, v.map(row => ({ ...row })));
        }
        this.snapshot = { tables: cloned, seq: this.seqCounter };
        continue;
      }
      if (upper.startsWith('COMMIT')) {
        this.inTransaction = false;
        this.snapshot = null;
        this.persist();
        continue;
      }
      if (upper.startsWith('ROLLBACK')) {
        if (this.snapshot) {
          this.tables = this.snapshot.tables;
          this.seqCounter = this.snapshot.seq;
          this.snapshot = null;
        }
        this.inTransaction = false;
        continue;
      }
      if (upper.startsWith('CREATE TABLE')) {
        const match = stmt.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/i);
        if (match && match[1]) {
          const tableName = match[1];
          if (!this.tables.has(tableName)) {
            this.tables.set(tableName, []);
            this.persist();
          }
        }
        continue;
      }
    }
  }

  prepare(sql: string): StatementSync {
    if (this.isClosed) throw new Error('Database is closed');
    const normalized = sql.replace(/\s+/g, ' ').trim();

    // Runs
    if (/^INSERT INTO runs/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, id, fingerprint, data] = params;
        const runs = this.getTable('runs');
        runs.push({ workspace, id, fingerprint, data });
        this.persist();
        return { changes: 1 };
      });
    }

    if (/SELECT.*fingerprint.*FROM runs WHERE workspace=\?\s+AND id=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, id] = params;
        const runs = this.getTable('runs');
        const row = runs.find(r => r['workspace'] === workspace && r['id'] === id);
        if (!row) return undefined;
        return { fingerprint: row['fingerprint'], data: row['data'] };
      });
    }

    if (/SELECT data FROM runs WHERE workspace=\?\s+AND id=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, id] = params;
        const runs = this.getTable('runs');
        const row = runs.find(r => r['workspace'] === workspace && r['id'] === id);
        if (!row) return undefined;
        return { data: row['data'] };
      });
    }

    // Operations
    if (/SELECT data FROM operations WHERE workspace=\?\s+AND key=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, key] = params;
        const ops = this.getTable('operations');
        const row = ops.find(r => r['workspace'] === workspace && r['key'] === key);
        if (!row) return undefined;
        return { data: row['data'] };
      });
    }

    if (/^INSERT INTO operations/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, key, run_id, state, version, data] = params;
        const ops = this.getTable('operations');
        ops.push({ workspace, key, run_id, state, version: Number(version), data });
        this.persist();
        return { changes: 1 };
      });
    }

    if (/UPDATE operations SET.*WHERE workspace=\?\s+AND key=\?\s+AND version=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [state, version, data, workspace, key, expectedVer] = params;
        const ops = this.getTable('operations');
        const row = ops.find(r => r['workspace'] === workspace && r['key'] === key && Number(r['version']) === Number(expectedVer));
        if (row) {
          row['state'] = state;
          row['version'] = Number(version);
          row['data'] = data;
          this.persist();
          return { changes: 1 };
        }
        return { changes: 0 };
      });
    }

    if (/UPDATE operations SET.*WHERE workspace=\?\s+AND key=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [state, version, data, workspace, key] = params;
        const ops = this.getTable('operations');
        const row = ops.find(r => r['workspace'] === workspace && r['key'] === key);
        if (row) {
          row['state'] = state;
          row['version'] = Number(version);
          row['data'] = data;
          this.persist();
          return { changes: 1 };
        }
        return { changes: 0 };
      });
    }

    if (/SELECT data FROM operations WHERE workspace=\?\s+AND run_id=\? ORDER BY key/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, run_id] = params;
        const ops = this.getTable('operations');
        const filtered = ops
          .filter(r => r['workspace'] === workspace && r['run_id'] === run_id)
          .sort((a, b) => String(a['key']).localeCompare(String(b['key'])));
        return filtered.map(r => ({ data: r['data'] }));
      });
    }

    // Events
    if (/^INSERT INTO events/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, operation_key, state, reason, at] = params;
        this.seqCounter++;
        const seq = this.seqCounter;
        const evs = this.getTable('events');
        evs.push({ seq, workspace, operation_key, state, reason, at });
        this.persist();
        return { changes: 1, lastInsertRowid: seq };
      });
    }

    if (/SELECT.*FROM events.*JOIN operations.*WHERE.*LIMIT 200/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, run_id] = params;
        const ops = this.getTable('operations');
        const matchedKeys = new Set(
          ops.filter(o => o['workspace'] === workspace && o['run_id'] === run_id).map(o => String(o['key']))
        );
        const evs = this.getTable('events');
        const matching = evs.filter(e => e['workspace'] === workspace && matchedKeys.has(String(e['operation_key'])));
        matching.sort((a, b) => Number(b['seq']) - Number(a['seq']));
        const sliced = matching.slice(0, 200);
        return sliced.map(r => ({
          seq: r['seq'],
          operation_key: r['operation_key'],
          state: r['state'],
          reason: r['reason'],
          at: r['at']
        }));
      });
    }

    if (/SELECT COUNT\(\*\) AS count FROM events.*JOIN operations/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [workspace, run_id] = params;
        const ops = this.getTable('operations');
        const matchedKeys = new Set(
          ops.filter(o => o['workspace'] === workspace && o['run_id'] === run_id).map(o => String(o['key']))
        );
        const evs = this.getTable('events');
        const count = evs.filter(e => e['workspace'] === workspace && matchedKeys.has(String(e['operation_key']))).length;
        return { count };
      });
    }

    // Effects & Control (LabProvider)
    if (/^INSERT INTO effects/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [id, marker, data] = params;
        const effects = this.getTable('effects');
        effects.push({ id, marker, data });
        this.persist();
        return { changes: 1 };
      });
    }

    if (/SELECT data FROM effects WHERE marker=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [marker] = params;
        const effects = this.getTable('effects');
        const rows = effects.filter(e => e['marker'] === marker);
        return rows.map(r => ({ data: r['data'] }));
      });
    }

    if (/SELECT data FROM effects ORDER BY/i.test(normalized)) {
      return new FallbackStatementSync((_mode) => {
        this.syncFromDisk();
        const effects = this.getTable('effects');
        return effects.map(r => ({ data: r['data'] }));
      });
    }

    if (/SELECT data FROM effects WHERE id=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [id] = params;
        const effects = this.getTable('effects');
        const row = effects.find(e => e['id'] === id);
        if (!row) return undefined;
        return { data: row['data'] };
      });
    }

    if (/UPDATE effects SET data=\?\s+WHERE id=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [data, id] = params;
        const effects = this.getTable('effects');
        const row = effects.find(e => e['id'] === id);
        if (row) {
          row['data'] = data;
          this.persist();
          return { changes: 1 };
        }
        return { changes: 0 };
      });
    }

    if (/INSERT OR REPLACE INTO control/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [name, value] = params;
        const control = this.getTable('control');
        const existing = control.find(c => c['name'] === name);
        if (existing) {
          existing['value'] = value;
        } else {
          control.push({ name, value });
        }
        this.persist();
        return { changes: 1 };
      });
    }

    if (/SELECT value FROM control WHERE name=\?/i.test(normalized)) {
      return new FallbackStatementSync((_mode, params) => {
        this.syncFromDisk();
        const [name] = params;
        const control = this.getTable('control');
        const row = control.find(c => c['name'] === name);
        if (!row) return undefined;
        return { value: row['value'] };
      });
    }

    // Default catch-all statement
    return new FallbackStatementSync((mode) => {
      if (mode === 'all') return [];
      if (mode === 'get') return undefined;
      return { changes: 0 };
    });
  }

  close(): void {
    this.persist();
    this.isClosed = true;
  }
}

export class DatabaseSync implements IDatabaseSync {
  private readonly delegate: IDatabaseSync;

  constructor(path: string, options?: { readOnly?: boolean; timeout?: number }) {
    if (NativeDatabaseSync) {
      this.delegate = new NativeDatabaseSync(path, options);
    } else {
      this.delegate = new FallbackDatabaseSync(path, options);
    }
  }

  exec(sql: string): void {
    this.delegate.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.delegate.prepare(sql);
  }

  close(): void {
    this.delegate.close();
  }
}
