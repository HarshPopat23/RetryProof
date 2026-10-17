import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

test('n8n example is a connected import design with no embedded credentials', () => {
  const text = readFileSync('examples/n8n-workflow.json', 'utf8'), w = JSON.parse(text);
  assert.equal(w.active, false); assert.equal(w.nodes.length, 6);
  const names = new Set(w.nodes.map(n => n.name));
  for (const [source, connection] of Object.entries(w.connections)) {
    assert.ok(names.has(source));
    for (const outputs of connection.main) for (const target of outputs) assert.ok(names.has(target.node));
  }
  for (const node of w.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')) {
    assert.equal(node.parameters.method, 'POST'); assert.equal(node.credentials, undefined);
    assert.ok(node.parameters.headerParameters.parameters.some(h => h.name === 'Accept' && h.value === 'application/json'));
  }
  assert.equal(/ghp_|github_pat_|sk-proj-/.test(text), false);
});

test('all relative markdown file links resolve inside the project', () => {
  function walk(dir) {
    return readdirSync(dir).flatMap(name => { const p = resolve(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
  }
  const files = [resolve('README.md'), ...walk('docs').filter(p => p.endsWith('.md'))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const path = resolve(dirname(file), target);
      assert.ok(path.startsWith(resolve('.') + '/'), `Escaping link in ${file}: ${target}`);
      assert.doesNotThrow(() => statSync(path), `Missing link in ${file}: ${target}`);
    }
  }
});
