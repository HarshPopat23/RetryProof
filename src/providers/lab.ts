import { DatabaseSync } from '../core/db.js';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Effect, Lookup, Payload } from '../core/types.js';

export type Fault = 'none' | 'lost_response' | 'unavailable' | 'hidden_read' | 'duplicate' | 'wrong_target' | 'malformed';
export class LabProvider {
  readonly db: DatabaseSync;
  constructor(path: string, readonly target: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path, { timeout: 5000 }); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,marker TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS effects_marker ON effects(marker);
      CREATE TABLE IF NOT EXISTS control(name TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  fault(value?: Fault): Fault {
    if (value) this.db.prepare('INSERT OR REPLACE INTO control VALUES(?,?)').run('fault', value);
    return ((this.db.prepare('SELECT value FROM control WHERE name=?').get('fault') as { value: string } | undefined)?.value ?? 'none') as Fault;
  }
  async create(marker: string, payload: Payload): Promise<{ accepted: boolean }> {
    const effect: Effect = { id: randomUUID(), marker, target: this.target, ...payload, url: '' };
    effect.url = `https://sandbox.retryproof.invalid/records/${effect.id}`;
    this.db.prepare('INSERT INTO effects VALUES(?,?,?)').run(effect.id, marker, JSON.stringify(effect));
    // Intentionally non-idempotent. This makes the unsafe baseline meaningful.
    if (this.fault() === 'lost_response') {
      this.fault('none');
      // Keep the side effect, but withhold the actual MCP response past the
      // configured client timeout. The response is late, not a fabricated ledger.
      await new Promise<void>(resolve => setTimeout(resolve, Number(process.env.RP_TIMEOUT_MS ?? 10000) + 500));
    }
    return { accepted: true };
  }
  find(marker: string): Lookup {
    const fault = this.fault();
    if (fault === 'unavailable') return { outcome: 'unavailable', reason: 'Injected verification outage' };
    if (fault === 'hidden_read') return { outcome: 'not_found' };
    const rows = this.db.prepare('SELECT data FROM effects WHERE marker=?').all(marker) as { data: string }[];
    if (!rows.length) return { outcome: 'not_found' };
    if (rows.length > 1 || fault === 'duplicate') return { outcome: 'conflict', reason: 'More than one candidate' };
    const effect = JSON.parse(rows[0]!.data) as Effect;
    if (fault === 'wrong_target') effect.target = 'different:workspace';
    return { outcome: 'found', effect };
  }
  list(): Effect[] {
    return (this.db.prepare('SELECT data FROM effects ORDER BY rowid').all() as { data: string }[]).map(r => JSON.parse(r.data) as Effect);
  }
  edit(id: string, title: string): void {
    const row = this.db.prepare('SELECT data FROM effects WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new Error('Record not found');
    const effect = { ...JSON.parse(row.data) as Effect, title };
    this.db.prepare('UPDATE effects SET data=? WHERE id=?').run(JSON.stringify(effect), id);
  }
  close(): void { this.db.close(); }
}
