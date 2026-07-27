import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EXPECTED_AGENT_ADAPTERS,
  checkAgentsLayout,
} from './agents-layout-guard.mjs';

function tempRoot(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'compy-agents-layout-'));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(root, relativePath) {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'adapter\n');
}

test('accepts exactly the ten canonical adapters', (testContext) => {
  const root = tempRoot(testContext);
  for (const adapter of EXPECTED_AGENT_ADAPTERS) writeFile(root, adapter);

  assert.deepEqual(checkAgentsLayout(root), { extras: [], missing: [] });
});

test('reports both missing adapters and recursive extras', (testContext) => {
  const root = tempRoot(testContext);
  for (const adapter of EXPECTED_AGENT_ADAPTERS.slice(1)) writeFile(root, adapter);
  writeFile(root, '.agents/skills/old-generated-mirror/reference.md');

  assert.deepEqual(checkAgentsLayout(root), {
    extras: ['.agents/skills/old-generated-mirror/reference.md'],
    missing: [EXPECTED_AGENT_ADAPTERS[0]],
  });
});
