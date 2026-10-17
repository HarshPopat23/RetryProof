import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubProvider } from '../dist/providers/github.js';

const marker = `rp_${'a'.repeat(64)}`;
function issue(overrides = {}) {
  return { id: 99, number: 7, title: 'Human-edited title', body: `content\n<!-- retryproof:${marker} -->`,
    html_url: 'https://github.com/owner/repo/issues/7', user: { id: 123 }, ...overrides };
}
function provider(pages, capture = []) {
  return new GithubProvider('unit-test-token', 'owner', 'repo', async (url, init) => {
    capture.push({ url, init });
    if (url.endsWith('/user')) return Response.json({ id: 123 });
    if (init.method === 'POST') return Response.json(issue(), { status: 201 });
    const page = Number(new URL(url).searchParams.get('page'));
    return Response.json(pages[page - 1] ?? []);
  });
}
test('GitHub lookup checks exact marker, creator, destination and excludes pull requests', async () => {
  const p = provider([[issue({ user: { id: 999 } }), issue({ pull_request: {} }), issue()]]);
  const r = await p.find(marker); assert.equal(r.outcome, 'found');
  assert.equal(r.effect.id, '7'); assert.equal(r.effect.title, 'Human-edited title');
});
test('GitHub ambiguous duplicate matches block adoption', async () => {
  const p = provider([[issue(), issue({ number: 8 })]]);
  assert.equal((await p.find(marker)).outcome, 'conflict');
});
test('GitHub pagination scans later pages and includes closed records via state=all', async () => {
  const capture = [], p = provider([Array.from({ length: 100 }, () => issue({ body: '' })), [issue()]], capture);
  assert.equal((await p.find(marker)).outcome, 'found');
  assert.ok(capture.some(c => c.url.includes('state=all') && c.url.includes('page=2')));
});
test('GitHub truncated pagination cannot falsely certify one candidate', async () => {
  const pages = Array.from({ length: 10 }, () => Array.from({ length: 100 }, () => issue({ body: '' })));
  pages[0][0] = issue(); assert.equal((await provider(pages).find(marker)).outcome, 'unavailable');
});
test('GitHub creation appends an operation marker and never silently retries requests', async () => {
  const capture = []; await provider([], capture).create(marker, { title: 'Title', body: 'Description', sourceId: '' });
  const calls = capture.filter(c => c.init.method === 'POST'); assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).body, `Description\n\n<!-- retryproof:${marker} -->`);
  assert.equal(calls[0].init.redirect, 'error');
});
test('GitHub HTTP errors and malformed responses cannot masquerade as absence', async () => {
  const offline = new GithubProvider('test', 'owner', 'repo', async () => Response.json({}, { status: 403 }));
  await assert.rejects(offline.find(marker), /403/);
  const malformed = new GithubProvider('test', 'owner', 'repo', async url => Response.json(url.endsWith('/user') ? { id: 1 } : { unexpected: true }));
  await assert.rejects(malformed.find(marker));
});
test('GitHub marker substring is not an exact operation marker match', async () => {
  assert.equal((await provider([[issue({ body: `<!-- retryproof:${marker}suffix -->` })]]).find(marker)).outcome, 'not_found');
});
