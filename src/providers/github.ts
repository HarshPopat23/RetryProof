import { z } from 'zod';
import type { Effect, Lookup, Payload } from '../core/types.js';

const issueSchema = z.object({ id: z.number().int(), number: z.number().int(), title: z.string(),
  body: z.string().nullable(), html_url: z.string().url(), user: z.object({ id: z.number().int() }),
  pull_request: z.unknown().optional(),
});
export class GithubProvider {
  private actorId: number | undefined;
  constructor(readonly token: string, readonly owner: string, readonly repo: string,
    readonly fetcher: typeof fetch = fetch) {}
  private async request(path: string, method = 'GET', body?: Record<string, string>): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'RetryProof/0.1.0' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}); outcome must be verified`);
    return response.json();
  }
  private async actor(): Promise<number> {
    this.actorId ??= z.object({ id: z.number().int() }).parse(await this.request('/user')).id;
    return this.actorId;
  }
  async create(marker: string, payload: Payload): Promise<{ accepted: boolean }> {
    await this.actor();
    await this.request(`/repos/${this.owner}/${this.repo}/issues`, 'POST', {
      title: payload.title, body: `${payload.body}\n\n<!-- retryproof:${marker} -->`,
    });
    return { accepted: true };
  }
  async find(marker: string): Promise<Lookup> {
    const actor = await this.actor();
    const matches: Effect[] = [];
    // Repository listing avoids relying on the asynchronously indexed search API.
    // A bounded scan with no match returns unavailable, never proof of absence.
    for (let page = 1; page <= 10; page++) {
      const issues = z.array(issueSchema).parse(await this.request(
        `/repos/${this.owner}/${this.repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`));
      for (const issue of issues) {
        if (issue.pull_request !== undefined || issue.user.id !== actor ||
            !issue.body?.includes(`<!-- retryproof:${marker} -->`)) continue;
        matches.push({ id: String(issue.number), marker, target: `github:${this.owner}/${this.repo}`,
          title: issue.title, body: issue.body, sourceId: '', url: issue.html_url });
      }
      if (matches.length > 1) return { outcome: 'conflict', reason: 'Multiple matching issues' };
      if (issues.length < 100) return matches.length === 1 ? { outcome: 'found', effect: matches[0]! } : { outcome: 'not_found' };
    }
    // Even a found candidate is not adopted if the scan could hide a duplicate.
    return { outcome: 'unavailable', reason: 'Repository scan exceeded its verification bound' };
  }
}
