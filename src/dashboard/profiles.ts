import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { configuration, type Config } from '../config.js';
import { ProviderClient } from '../mcp/client.js';
import { ConnectedGateway, type Gateway } from './gateway.js';
import { type AgentConfig } from './agent.js';

export const setupSchema = z.object({ mode: z.enum(['sandbox','github','client','remote','agent']),
  workspace: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('dashboard'),
  backend: z.enum(['sandbox','github']).default('sandbox'),
  githubOwner: z.string().max(39).optional(), githubRepo: z.string().max(100).optional(),
  githubToken: z.string().max(4096).optional(), markerSecret: z.string().max(4096).optional(),
  remoteUrl: z.string().max(2048).optional(), remoteToken: z.string().max(4096).optional(),
  clientToken: z.string().max(4096).optional(),
  provider: z.enum(['openai','groq','gemini']).optional(), model: z.string().min(1).max(120).optional(),
  apiKey: z.string().max(4096).optional(),
}).strict();
export type Setup = z.infer<typeof setupSchema>;
export interface Profile {
  mode: Setup['mode']; gateway: Gateway; config: Config | null; agent: AgentConfig | null;
  issue: ProviderClient | null; tracking: ProviderClient | null;
  clientToken: string; exportId: string; lastReceipt: unknown;
  close(): Promise<void>;
}
export interface ProfileOptions { dataDir: string; masterKey: Buffer; allowedOrigins: string[]; fetcher?: typeof fetch }
export function remoteEndpoint(raw: string, allowedOrigins: string[]): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.hash || url.search) throw new Error('Use an MCP endpoint without embedded credentials, query parameters or fragments.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(loopback && ['http:', 'https:'].includes(url.protocol)) &&
      !(url.protocol === 'https:' && allowedOrigins.includes(url.origin)))
    throw new Error('Remote origin is not allowed. Add its exact HTTPS origin to RP_UI_REMOTE_ORIGINS, then restart the dashboard.');
  return url;
}
export async function createProfile(input: Setup, options: ProfileOptions): Promise<Profile> {
  const useGithub = input.mode === 'github' || (['client','agent'].includes(input.mode) && input.backend === 'github');
  if (input.mode === 'client' && (!input.clientToken || input.clientToken.length < 32))
    throw new Error('Choose a client bearer token of at least 32 characters.');
  if (input.mode === 'agent' && (!input.provider || !input.model || !input.apiKey?.trim()))
    throw new Error('Choose an LLM provider, a tool-capable model and its API key.');
  const dataKey = createHmac('sha256', options.masterKey).update(JSON.stringify([
    input.workspace, useGithub ? `github:${input.githubOwner}/${input.githubRepo}` : 'sandbox',
  ])).digest('hex');
  let config: Config | null = null, gateway: Gateway;
  if (input.mode === 'remote') {
    const url = remoteEndpoint(input.remoteUrl ?? '', options.allowedOrigins);
    gateway = await ConnectedGateway.remote(url, input.remoteToken ?? '');
  } else {
    config = configuration({ RP_DATA_DIR: join(options.dataDir, 'profiles', dataKey), RP_WORKSPACE: input.workspace,
      RP_MODE: useGithub ? 'github' : 'sandbox', RP_GITHUB_OWNER: input.githubOwner ?? '',
      RP_GITHUB_REPO: input.githubRepo ?? '', RP_GITHUB_TOKEN: input.githubToken ?? '',
      ...(useGithub ? { RP_MARKER_SECRET: input.markerSecret ?? '' } : {}) });
    if (useGithub) {
      // Validate access through reads; connecting never creates a GitHub issue.
      const fetcher = options.fetcher ?? fetch;
      for (const path of ['/user', `/repos/${config.githubOwner}/${config.githubRepo}`]) {
        const response = await fetcher(`https://api.github.com${path}`, { headers: {
          Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'RetryProof-Dashboard' },
          signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (!response.ok) throw new Error('GitHub access check failed. Check your user token and repository access.');
        await response.body?.cancel();
      }
    }
    gateway = await ConnectedGateway.local(config);
  }
  const issue = config?.mode === 'sandbox' ? new ProviderClient('issue', config) : null;
  const tracking = config?.mode === 'sandbox' ? new ProviderClient('tracking', config) : null;
  return { mode: input.mode, gateway, config,
    agent: input.mode === 'agent' ? { provider: input.provider!, model: input.model!, apiKey: input.apiKey! } : null,
    issue, tracking, clientToken: input.mode === 'client' ? input.clientToken! : '', exportId: dataKey,
    lastReceipt: null, async close() { await Promise.allSettled([gateway.close(), issue?.close(), tracking?.close()]); } };
}
