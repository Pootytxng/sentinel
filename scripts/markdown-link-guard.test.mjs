import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownDestinations, withoutFencedCode } from './markdown-link-guard.mjs';

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

test('single-backtick inline code is masked while an adjacent real link remains visible', () => {
  const found = markdownDestinations(
    '`[ignored](missing-single.md)` [checked](README.md)',
  );

  assert.deepEqual(found, ['README.md']);
});

test('multi-backtick inline code is masked while an adjacent real link remains visible', () => {
  const found = markdownDestinations(
    '``[ignored](missing-multi.md) with `literal` tick`` [checked](README.md)',
  );

  assert.deepEqual(found, ['README.md']);
});
