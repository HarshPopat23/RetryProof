import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const checks = [];
function sourceHash() {
  const hash = createHash('sha256');
  function walk(relative) {
    for (const name of readdirSync(`${root}/${relative}`).sort()) {
      const path = `${relative}/${name}`;
      if (statSync(`${root}/${path}`).isDirectory()) walk(path);
      else hash.update(path + '\0').update(readFileSync(`${root}/${path}`));
    }
  }
  for (const path of ['src', 'test', 'scripts', 'web']) walk(path);
  return hash.digest('hex');
}
function run(name, executable, args) {
  console.log(`Checking ${name}...`);
  const r = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  const result = { name, passed: r.status === 0 && !r.error, exit_code: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`, ...(r.error ? { error: r.error.message } : {}) };
  checks.push(result); if (!result.passed) console.error(result.output);
  return result;
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run('strict TypeScript build', npm, ['run', 'build']);
if (checks.every(c => c.passed)) {
  const tests = run('automated core, adapter and real MCP transport tests', process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/assets.test.mjs', 'test/core.test.mjs', 'test/github.test.mjs', 'test/http.test.mjs', 'test/mcp.test.mjs', 'test/persistence.test.mjs', 'test/dashboard.test.mjs']);
  mkdirSync(`${root}/evidence`, { recursive: true }); writeFileSync(`${root}/evidence/test-results.tap`, tests.output);
  run('executed baseline and protected recovery demo', process.execPath, ['scripts/demo.mjs']);
}
const report = { generated_at: new Date().toISOString(), node: process.version, platform: process.platform,
  scope: 'Local deterministic sandbox execution and mocked GitHub REST contract tests; no GitHub account writes, n8n UI run, NitroStudio UI run, Docker build or cloud deployment performed.',
  lockfile_sha256: createHash('sha256').update(readFileSync(`${root}/package-lock.json`)).digest('hex'),
  source_sha256: sourceHash(),
  passed: checks.every(c => c.passed), checks };
mkdirSync(`${root}/evidence`, { recursive: true }); writeFileSync(`${root}/evidence/verification.json`, JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'All executable checks passed.' : 'Verification failed; inspect evidence/verification.json.');
process.exitCode = report.passed ? 0 : 1;
