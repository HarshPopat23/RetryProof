import { timingSafeEqual } from 'node:crypto';
import type { ExecutionContext, Guard } from '@nitrostack/core';
import { runtime } from './runtime.js';

export class WorkspaceGuard implements Guard {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = runtime().config.token;
    if (!expected) return true; // permitted only for local STDIO or loopback HTTP
    const raw = ctx.metadata?.authorization;
    const supplied = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    const a = Buffer.from(supplied); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Unauthorized');
    // Workspace is server configuration. Never use an unsigned JWT sub, an
    // argument, or caller metadata as a tenant selector.
    return true;
  }
}
