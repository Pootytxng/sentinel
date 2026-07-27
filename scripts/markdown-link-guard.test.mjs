import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutFencedCode } from './markdown-link-guard.mjs';

test('a shorter backtick fence does not close a longer fence', () => {
  const stripped = withoutFencedCode([
    '````markdown',
    '[ignored](missing-backtick-target.md)',
    '```',
    '[still-ignored](also-missing.md)',
    '````',
    '[checked](README.md)',
  ].join('\n'));

  assert.doesNotMatch(stripped, /missing-backtick-target|also-missing/);
  assert.match(stripped, /\[checked]\(README\.md\)/);
});

test('a shorter tilde fence does not close a longer fence', () => {
  const stripped = withoutFencedCode([
    '~~~~markdown',
    '[ignored](missing-tilde-target.md)',
    '~~~',
    '[still-ignored](also-missing.md)',
    '~~~~',
    '[checked](README.md)',
  ].join('\n'));

  assert.doesNotMatch(stripped, /missing-tilde-target|also-missing/);
  assert.match(stripped, /\[checked]\(README\.md\)/);
});
