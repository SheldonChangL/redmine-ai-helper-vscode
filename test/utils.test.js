'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  sanitizePatchText,
  looksLikePatch,
  parseChangedFiles,
  parseHunks,
  reconstructPatch,
} = require('../src/utils');

// ---------------------------------------------------------------------------
// sanitizePatchText
// ---------------------------------------------------------------------------

test('sanitizePatchText returns empty string for empty input', () => {
  assert.strictEqual(sanitizePatchText(''), '');
  assert.strictEqual(sanitizePatchText(null), '');
  assert.strictEqual(sanitizePatchText(undefined), '');
});

test('sanitizePatchText strips ```diff fences', () => {
  const input = '```diff\n--- a/foo.js\n+++ b/foo.js\n@@ -1,1 +1,1 @@\n-old\n+new\n```';
  const result = sanitizePatchText(input);
  assert.ok(!result.startsWith('```'), 'should not start with ```');
  assert.ok(result.includes('--- a/foo.js'), 'should contain patch content');
});

test('sanitizePatchText strips plain ``` fences', () => {
  const input = '```\n--- a/foo.js\n+++ b/foo.js\n```';
  const result = sanitizePatchText(input);
  assert.ok(!result.startsWith('```'));
});

test('sanitizePatchText strips ```patch fences', () => {
  const input = '```patch\n--- a/foo.js\n+++ b/foo.js\n```';
  const result = sanitizePatchText(input);
  assert.ok(!result.startsWith('```'));
  assert.ok(result.includes('--- a/foo.js'));
});

test('sanitizePatchText leaves plain patch text unchanged', () => {
  const input = '--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new';
  assert.strictEqual(sanitizePatchText(input), input);
});

// ---------------------------------------------------------------------------
// looksLikePatch
// ---------------------------------------------------------------------------

test('looksLikePatch returns true for valid unified diff', () => {
  const patch = '--- a/foo.js\n+++ b/foo.js\n@@ -1,1 +1,1 @@\n-old\n+new';
  assert.strictEqual(looksLikePatch(patch), true);
});

test('looksLikePatch returns true for git-format diff', () => {
  const patch = 'diff --git a/foo.js b/foo.js\n--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new';
  assert.strictEqual(looksLikePatch(patch), true);
});

test('looksLikePatch returns false for plain text', () => {
  assert.strictEqual(looksLikePatch('Hello world'), false);
  assert.strictEqual(looksLikePatch(''), false);
});

test('looksLikePatch returns true even when wrapped in markdown fences', () => {
  const patch = '```diff\n--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new\n```';
  assert.strictEqual(looksLikePatch(patch), true);
});

// ---------------------------------------------------------------------------
// parseChangedFiles
// ---------------------------------------------------------------------------

test('parseChangedFiles extracts single file path', () => {
  const patch = '--- a/src/foo.js\n+++ b/src/foo.js\n@@ -1,1 +1,1 @@\n-old\n+new';
  const files = parseChangedFiles(patch);
  assert.deepStrictEqual(files, ['src/foo.js']);
});

test('parseChangedFiles extracts multiple unique file paths', () => {
  const patch = [
    '--- a/src/foo.js',
    '+++ b/src/foo.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '--- a/src/bar.js',
    '+++ b/src/bar.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const files = parseChangedFiles(patch);
  assert.deepStrictEqual(files, ['src/foo.js', 'src/bar.js']);
});

test('parseChangedFiles deduplicates files with multiple hunks', () => {
  const patch = [
    '--- a/src/foo.js',
    '+++ b/src/foo.js',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '@@ -10 +10 @@',
    '-c',
    '+d',
  ].join('\n');
  const files = parseChangedFiles(patch);
  assert.deepStrictEqual(files, ['src/foo.js']);
});

test('parseChangedFiles ignores /dev/null', () => {
  const patch = '--- /dev/null\n+++ b/src/new.js\n@@ -0,0 +1,1 @@\n+new file';
  const files = parseChangedFiles(patch);
  assert.deepStrictEqual(files, ['src/new.js']);
});

test('parseChangedFiles returns empty array for non-patch text', () => {
  assert.deepStrictEqual(parseChangedFiles('not a patch'), []);
  assert.deepStrictEqual(parseChangedFiles(''), []);
});

// ---------------------------------------------------------------------------
// parseHunks
// ---------------------------------------------------------------------------

const SIMPLE_PATCH = [
  '--- a/src/foo.js',
  '+++ b/src/foo.js',
  '@@ -1,3 +1,3 @@',
  ' context',
  '-old line',
  '+new line',
  ' context',
].join('\n');

const MULTI_HUNK_PATCH = [
  '--- a/src/foo.js',
  '+++ b/src/foo.js',
  '@@ -1,3 +1,3 @@',
  ' context',
  '-old1',
  '+new1',
  '@@ -10,3 +10,3 @@',
  ' context',
  '-old2',
  '+new2',
].join('\n');

const TWO_FILE_PATCH = [
  '--- a/src/foo.js',
  '+++ b/src/foo.js',
  '@@ -1,1 +1,1 @@',
  '-foo',
  '+FOO',
  '--- a/src/bar.js',
  '+++ b/src/bar.js',
  '@@ -1,1 +1,1 @@',
  '-bar',
  '+BAR',
].join('\n');

test('parseHunks returns one hunk for simple single-hunk patch', () => {
  const hunks = parseHunks(SIMPLE_PATCH);
  assert.strictEqual(hunks.length, 1);
  assert.strictEqual(hunks[0].filePath, 'src/foo.js');
  assert.ok(hunks[0].fileHeader.includes('--- a/src/foo.js'));
  assert.ok(hunks[0].fileHeader.includes('+++ b/src/foo.js'));
  assert.ok(hunks[0].lines[0].startsWith('@@ '));
});

test('parseHunks returns two hunks for multi-hunk single-file patch', () => {
  const hunks = parseHunks(MULTI_HUNK_PATCH);
  assert.strictEqual(hunks.length, 2);
  assert.strictEqual(hunks[0].filePath, 'src/foo.js');
  assert.strictEqual(hunks[1].filePath, 'src/foo.js');
  assert.strictEqual(hunks[0].fileHeader, hunks[1].fileHeader);
  assert.ok(hunks[0].lines[0].includes('-1,3'));
  assert.ok(hunks[1].lines[0].includes('-10,3'));
});

test('parseHunks returns two hunks for two-file patch', () => {
  const hunks = parseHunks(TWO_FILE_PATCH);
  assert.strictEqual(hunks.length, 2);
  assert.strictEqual(hunks[0].filePath, 'src/foo.js');
  assert.strictEqual(hunks[1].filePath, 'src/bar.js');
});

test('parseHunks returns empty array for non-patch text', () => {
  assert.deepStrictEqual(parseHunks(''), []);
  assert.deepStrictEqual(parseHunks('not a patch'), []);
});

// ---------------------------------------------------------------------------
// reconstructPatch
// ---------------------------------------------------------------------------

test('reconstructPatch round-trips a single-hunk patch', () => {
  const hunks = parseHunks(SIMPLE_PATCH);
  const reconstructed = reconstructPatch(hunks);
  // The reconstructed patch should contain the file header and hunk content
  assert.ok(reconstructed.includes('--- a/src/foo.js'), 'should contain file header');
  assert.ok(reconstructed.includes('+++ b/src/foo.js'), 'should contain +++ header');
  assert.ok(reconstructed.includes('@@ -1,3 +1,3 @@'), 'should contain hunk header');
  assert.ok(reconstructed.includes('-old line'), 'should contain removed line');
  assert.ok(reconstructed.includes('+new line'), 'should contain added line');
});

test('reconstructPatch groups multiple hunks from same file under one header', () => {
  const hunks = parseHunks(MULTI_HUNK_PATCH);
  const reconstructed = reconstructPatch(hunks);
  // The file header should appear only once
  const headerCount = (reconstructed.match(/--- a\/src\/foo\.js/g) || []).length;
  assert.strictEqual(headerCount, 1, 'file header should appear exactly once');
  assert.ok(reconstructed.includes('@@ -1,3'));
  assert.ok(reconstructed.includes('@@ -10,3'));
});

test('reconstructPatch handles two-file patch', () => {
  const hunks = parseHunks(TWO_FILE_PATCH);
  const reconstructed = reconstructPatch(hunks);
  assert.ok(reconstructed.includes('src/foo.js'));
  assert.ok(reconstructed.includes('src/bar.js'));
  assert.ok(reconstructed.includes('+FOO'));
  assert.ok(reconstructed.includes('+BAR'));
});

test('reconstructPatch returns empty string for empty hunks array', () => {
  assert.strictEqual(reconstructPatch([]), '');
});

test('reconstructPatch with subset of hunks omits deselected content', () => {
  const hunks = parseHunks(MULTI_HUNK_PATCH);
  // Only select the second hunk
  const reconstructed = reconstructPatch([hunks[1]]);
  assert.ok(!reconstructed.includes('-old1'), 'first hunk content should be absent');
  assert.ok(reconstructed.includes('-old2'), 'second hunk content should be present');
});
