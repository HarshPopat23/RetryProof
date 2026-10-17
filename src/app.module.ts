import { McpApp, Module } from '@nitrostack/core';
import { RecoveryTools } from './mcp/tools.js';

@McpApp({ module: AppModule, server: { name: 'retryproof', version: '0.1.0', protocolVersion: 'legacy' },
  logging: { level: 'error' } })
@Module({ name: 'retryproof', controllers: [RecoveryTools] })
export class AppModule {}
