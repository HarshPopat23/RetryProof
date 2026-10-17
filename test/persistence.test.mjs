import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabProvider } from '../dist/providers/lab.js';

test('SQLite startup waits for a competing lock before switching journal mode', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-lock-')), path = join(dir, 'domain.sqlite');
  const code = `import { DatabaseSync } from ${JSON.stringify(new URL('../dist/core/db.js', import.meta.url).href)};
    const db = new DatabaseSync(process.argv[1]);
    db.exec('CREATE TABLE lock_owner(x); BEGIN EXCLUSIVE');
    console.log('locked');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, 800);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], { stdio: ['ignore','pipe','pipe'] });
  const exited = once(child, 'exit'); let provider;
  t.after(async () => { provider?.close(); if (child.exitCode === null) child.kill('SIGTERM'); await exited; rmSync(dir, { recursive: true, force: true }); });
  const [ready] = await once(child.stdout, 'data'); assert.match(ready.toString(), /locked/);
  provider = new LabProvider(path, 'sandbox:issues');
  assert.deepEqual(provider.list(), []); assert.deepEqual(await exited, [0, null]);
});
