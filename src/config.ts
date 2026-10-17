import { resolve } from 'node:path';
import { DomainError } from './core/types.js';

export interface Config {
  dataDir: string; workspace: string; secret: string; issueTarget: string; trackerTarget: string;
  mode: 'sandbox' | 'github'; token: string; githubToken: string; githubOwner: string; githubRepo: string;
  timeoutMs: number; transport: 'stdio' | 'http'; host: string; port: number;
}
export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.RP_MODE ?? 'sandbox';
  if (mode !== 'sandbox' && mode !== 'github') throw new DomainError('CONFIG', 'RP_MODE must be sandbox or github.');
  const transport = env.RP_TRANSPORT ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') throw new DomainError('CONFIG', 'RP_TRANSPORT must be stdio or http.');
  const githubOwner = env.RP_GITHUB_OWNER ?? '';
  const githubRepo = env.RP_GITHUB_REPO ?? '';
  const githubToken = env.RP_GITHUB_TOKEN ?? '';
  const secret = env.RP_MARKER_SECRET ?? (mode === 'sandbox' ? 'sandbox-only-marker-key-do-not-use-live' : '');
  if (mode === 'github' && (!/^[A-Za-z0-9-]{1,39}$/.test(githubOwner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(githubRepo) || !githubToken || secret.length < 32))
    throw new DomainError('CONFIG', 'GitHub mode needs an explicit owner/repo, token, and stable RP_MARKER_SECRET of at least 32 characters.');
  const token = env.RP_AUTH_TOKEN ?? '';
  const host = env.RP_HOST ?? '127.0.0.1';
  if (transport === 'http' && !['127.0.0.1', 'localhost', '::1'].includes(host) &&
      (token.length < 32 || token === 'sandbox-production-auth-token-min-32-chars-long'))
    throw new DomainError('CONFIG', 'Non-loopback HTTP requires RP_AUTH_TOKEN of at least 32 characters.');
  const timeoutMs = Number(env.RP_TIMEOUT_MS ?? 10000);
  const port = Number(env.PORT ?? env.RP_PORT ?? 3000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new DomainError('CONFIG', 'Invalid port or timeout.');
  const workspace = env.RP_WORKSPACE ?? 'local-demo';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workspace)) throw new DomainError('CONFIG', 'Invalid workspace.');
  return { dataDir: resolve(env.RP_DATA_DIR ?? './data'), workspace, secret,
    issueTarget: mode === 'github' ? `github:${githubOwner}/${githubRepo}` : 'sandbox:issues',
    trackerTarget: 'local:release-board', mode, token, githubToken, githubOwner, githubRepo,
    timeoutMs, transport, host, port };
}
