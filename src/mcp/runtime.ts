import { join } from 'node:path';
import { Store } from '../core/store.js';
import { Engine } from '../core/engine.js';
import { ProviderClient } from './client.js';
import type { Config } from '../config.js';

export interface Runtime { config: Config; engine: Engine; issue: ProviderClient; tracking: ProviderClient; close(): Promise<void> }
let instance: Runtime | undefined;
export function initialize(config: Config): Runtime {
  if (instance) throw new Error('Runtime already initialized');
  const store = new Store(join(config.dataDir, 'gateway.sqlite'), config.workspace);
  const issue = new ProviderClient('issue', config);
  const tracking = new ProviderClient('tracking', config);
  const engine = new Engine(store, { issue, tracking }, config);
  instance = { config, engine, issue, tracking, async close() {
    await Promise.allSettled([issue.close(), tracking.close()]); store.close(); instance = undefined;
  } };
  return instance;
}
export function runtime(): Runtime {
  if (!instance) throw new Error('Runtime is not initialized');
  return instance;
}
