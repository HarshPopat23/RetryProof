import 'reflect-metadata';
import 'dotenv/config';
import { McpApplicationFactory } from '@nitrostack/core';
import { configuration } from './config.js';
import { initialize } from './mcp/runtime.js';
import { AppModule } from './app.module.js';

process.umask(0o077);
const config = configuration();
const r = initialize(config);
const app = await McpApplicationFactory.create(AppModule);
await app.start({ transport: config.transport, host: config.host, port: config.port, enableCors: false });
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await r.close();
  await app.stop();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown().finally(() => process.exit(0)); });
if (config.transport === 'stdio') process.stdin.on('end', () => { void shutdown().finally(() => process.exit(0)); });
