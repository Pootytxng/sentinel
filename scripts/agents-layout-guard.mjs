import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

export const EXPECTED_AGENT_ADAPTERS = Object.freeze([
  '.agents/skills/compy-coverage-sweep/SKILL.md',
  '.agents/skills/doc-sync/SKILL.md',
  '.agents/skills/gate-drift-audit/SKILL.md',
  '.agents/skills/guard-forge/SKILL.md',
  '.agents/skills/hygiene/SKILL.md',
  '.agents/skills/impeccable/SKILL.md',
  '.agents/skills/mutation-gate/SKILL.md',
  '.agents/skills/self-review/SKILL.md',
  '.agents/skills/ship/SKILL.md',
  '.agents/skills/usage-audit/SKILL.md',
]);

function filesUnder(directory, rootDir) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(absolute, rootDir));
    } else {
      files.push(path.relative(rootDir, absolute).replaceAll('\\', '/'));
    }
  }
  return files;
}

export function checkAgentsLayout(rootDir = root) {
  const expected = new Set(EXPECTED_AGENT_ADAPTERS);
  const actual = new Set(filesUnder(path.join(rootDir, '.agents'), rootDir));
  return {
    extras: [...actual].filter((file) => !expected.has(file)).sort(),
    missing: [...expected].filter((file) => !actual.has(file)).sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { extras, missing } = checkAgentsLayout();
  for (const file of missing) console.error(`AGENTS-LAYOUT MISSING ${file}`);
  for (const file of extras) console.error(`AGENTS-LAYOUT EXTRA ${file}`);
  if (missing.length || extras.length) {
    console.error(`agents-layout-guard: FAIL ${missing.length} missing, ${extras.length} extra`);
    process.exitCode = 1;
  } else {
    console.log(`agents-layout-guard: PASS exactly ${EXPECTED_AGENT_ADAPTERS.length} adapter files`);
  }
}
