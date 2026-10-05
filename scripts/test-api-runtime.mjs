import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(process.cwd(), '.api-test-'));
try {
  const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.api.json', '--outDir', directory], { stdio: 'inherit' });
  assert.equal(compile.status, 0, 'API compilation failed');
  const api = (await import(pathToFileURL(path.join(directory, 'api/stock-alert.js')))).default;
  const status = (await import(pathToFileURL(path.join(directory, 'api/stock-alert/status.js')))).default;
  const response = await status.fetch(new Request('https://example.invalid/api/stock-alert/status'));
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).configured, 'boolean');
  assert.equal((await api.fetch(new Request('https://example.invalid/api/stock-alert', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await api.fetch(new Request('https://example.invalid/api/stock-alert'))).status, 405);
  console.log('Compiled API runtime: 3 checks passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
