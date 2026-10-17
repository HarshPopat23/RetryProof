import 'reflect-metadata';
import 'dotenv/config';
import { McpApplicationFactory } from '@nitrostack/core';
import { configuration } from './config.js';
import { initialize } from './mcp/runtime.js';
import { AppModule } from './app.module.js';
import { startupEnvironment, assertWritableData } from './startup.js';
import { sqliteDriver } from './core/db.js';

process.umask(0o077);

let config: ReturnType<typeof configuration>;
let r: ReturnType<typeof initialize>;
let app: Awaited<ReturnType<typeof McpApplicationFactory.create>>;
try {
  config = configuration(startupEnvironment(process.env));
  assertWritableData(config);
  r = initialize(config);
  app = await McpApplicationFactory.create(AppModule);
  await app.start({ transport: config.transport, host: config.host, port: config.port, enableCors: false });
} catch (error) {
  // Exclude raw environment values, credentials and provider payloads.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STARTUP';
  const reason = code === 'CONFIG' ? 'Check transport, port, GitHub settings and RP_AUTH_TOKEN (32+ characters for public HTTP).'
    : ['EACCES', 'EPERM', 'EROFS'].includes(code) ? 'RP_DATA_DIR is not writable by the container user. Select a writable persistent mount.'
    : 'Check Node version, SQLite driver installation and RP_DATA_DIR. Existing databases are never overwritten.';
  process.stderr.write(`[RetryProof startup failed] ${code}: ${reason}\n`);
  process.exit(1);
}
if (config.transport === 'http') process.stderr.write(`[RetryProof ready] Node ${process.versions.node}; ${sqliteDriver}; http://${config.host}:${config.port}/mcp; health=/mcp/health\n`);
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await r.close();
  await app.stop();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown().finally(() => process.exit(0)); });
if (config.transport === 'stdio') {
  process.stdin.on('end', () => { void shutdown().finally(() => process.exit(0)); });
}
