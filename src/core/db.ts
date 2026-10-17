import { createRequire } from 'node:module';

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
export interface DatabaseOptions { readOnly?: boolean; timeout?: number }
interface NativeConstructor { new (path: string, options?: DatabaseOptions): IDatabaseSync }
interface BetterConstructor {
  new (path: string, options: { readonly: boolean; timeout: number; fileMustExist: boolean }): IDatabaseSync;
}
const require = createRequire(import.meta.url);
let native: NativeConstructor | undefined;
try {
  const sqlite = require('node:sqlite') as { DatabaseSync?: NativeConstructor };
  native = sqlite.DatabaseSync;
} catch (error) {
  // Only Node's absent module selects the compatibility driver. File or SQL
  // errors must surface, never become an empty database or simulated success.
  if ((error as NodeJS.ErrnoException).code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
}

/** Node 20 compatibility using real SQLite transactions and process locks. */
export class FallbackDatabaseSync implements IDatabaseSync {
  private readonly db: IDatabaseSync;
  constructor(path: string, options: DatabaseOptions = {}) {
    const BetterSqlite = require('better-sqlite3') as BetterConstructor;
    this.db = new BetterSqlite(path, { readonly: options.readOnly ?? false,
      timeout: options.timeout ?? 0, fileMustExist: options.readOnly ?? false });
    // Opening creates the file before callers chmod it. There is no JSON
    // emulation, swallowed write error or silently ignored SQL statement.
    try { this.db.exec('PRAGMA foreign_keys=ON'); }
    catch (error) { this.db.close(); throw error; }
  }
  exec(sql: string): void { this.db.exec(sql); }
  prepare(sql: string): StatementSync { return this.db.prepare(sql); }
  close(): void { this.db.close(); }
}

export class DatabaseSync implements IDatabaseSync {
  private readonly db: IDatabaseSync;
  constructor(path: string, options: DatabaseOptions = {}) {
    this.db = native ? new native(path, options) : new FallbackDatabaseSync(path, options);
  }
  exec(sql: string): void { this.db.exec(sql); }
  prepare(sql: string): StatementSync { return this.db.prepare(sql); }
  close(): void { this.db.close(); }
}
export const sqliteDriver = native ? 'node:sqlite' : 'better-sqlite3';
