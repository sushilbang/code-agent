import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, rankPaths } from '../dist-electron/shared/fuzzy.js';

const files = ['src/electron/agent/tools/registry.ts', 'src/electron/agent/runner.ts', 'src/renderer/App.tsx', 'src/renderer/components/QuickOpen.tsx', 'README.md', 'tests/desktop.test.mjs', 'src/electron/main.ts', 'package.json', 'package-lock.json'];
const top = query => rankPaths(query, files)[0]?.path;

test('queries must match in order, case-insensitively, and report the matched indexes', () => {
  assert.equal(fuzzyMatch('xyz', 'src/app.ts'), null);
  assert.equal(fuzzyMatch('tsa', 'src/app.ts'), null, 'order matters');
  const match = fuzzyMatch('APP', 'src/app.ts');
  assert.deepEqual(match.indexes, [4, 5, 6]);
  assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, indexes: [] });
});

test('file-name matches outrank directory matches and camelCase or word starts count', () => {
  assert.equal(top('app'), 'src/renderer/App.tsx');
  assert.equal(top('main'), 'src/electron/main.ts');
  assert.equal(top('qo'), 'src/renderer/components/QuickOpen.tsx', 'camelCase humps');
  assert.equal(top('pkg'), 'package.json', 'shorter path wins ties');
  assert.equal(top('reg'), 'src/electron/agent/tools/registry.ts');
  assert.equal(top('readme'), 'README.md');
});

test('path segments can be typed across directories and results are bounded', () => {
  assert.equal(top('rend/app'), 'src/renderer/App.tsx');
  assert.equal(rankPaths('', files, 3).length, 3);
  assert.equal(rankPaths('zzzz', files).length, 0);
  const many = Array.from({ length: 500 }, (_, index) => `dir/file${index}.ts`);
  assert.equal(rankPaths('file', many, 50).length, 50);
});
