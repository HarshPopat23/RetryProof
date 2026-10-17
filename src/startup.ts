import { mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Config } from './config.js';

/** Explicit STDIO wins, including for client/provider subprocesses. */
export function startupEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  const hosted = env.NODE_ENV === 'production' || Boolean(env.PORT);
  const transport = env.RP_TRANSPORT ?? (hosted ? 'http' : 'stdio');
  result.RP_TRANSPORT = transport;
  result.RP_HOST = env.RP_HOST ?? (hosted && transport === 'http' ? '0.0.0.0' : '127.0.0.1');
  // Authentication is operator configuration. Never invent a public shared key.
  return result;
}
export function assertWritableData(config: Config): void {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const probe = join(config.dataDir, `.write-check-${randomBytes(8).toString('hex')}`);
  let fd: number | undefined;
  try { fd = openSync(probe, 'wx', 0o600); }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(probe); } }
}
