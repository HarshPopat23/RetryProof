import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, sqliteDriver } from '../dist/core/db.js';

// Managed NitroCloud builds ignore the repository Dockerfile. Make the default
// writable directory in the builder so COPY --chown=node:node transfers it to
// the non-root runtime, and verify the selected SQLite driver before pruning.
const data = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(data, { recursive: true, mode: 0o700 });
if (!existsSync(new URL('../dist/providers/server.js', import.meta.url))) throw new Error('Compiled MCP provider entry is missing');
const db = new DatabaseSync(':memory:');
try {
  db.exec('CREATE TABLE build_check(id INTEGER PRIMARY KEY); BEGIN IMMEDIATE; INSERT INTO build_check VALUES(1); ROLLBACK;');
  if (db.prepare('SELECT COUNT(*) AS count FROM build_check').get().count !== 0) throw new Error('SQLite transaction check failed');
} finally { db.close(); }
console.log(`[RetryProof build] Node ${process.versions.node}; SQLite ${sqliteDriver}; runtime directory prepared.`);
