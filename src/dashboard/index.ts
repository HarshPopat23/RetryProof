import 'dotenv/config';
import { resolve } from 'node:path';
import { startDashboard } from './server.js';

process.umask(0o077);
const port = Number(process.env.RP_UI_PORT ?? 3400);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid RP_UI_PORT');
const dashboard = await startDashboard({ dataDir: resolve(process.env.RP_DATA_DIR ?? './data'), port,
  allowedOrigins: (process.env.RP_UI_REMOTE_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean) });
console.log(`RetryProof dashboard: ${dashboard.url}`);
let stopping = false;
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => {
  if (stopping) return; stopping = true; void dashboard.close().finally(() => process.exit(0));
});
