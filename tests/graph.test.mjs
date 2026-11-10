import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodeGraph, clearGraphCache } from '../dist-electron/electron/graph/build.js';
import { extractFacts } from '../dist-electron/electron/graph/extract.js';
import { overviewText, pathText, queryText } from '../dist-electron/electron/graph/query.js';
import { graphTools } from '../dist-electron/electron/agent/tools/graph.js';
import { ToolRegistry } from '../dist-electron/electron/agent/tools/registry.js';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-graph-'));
  clearGraphCache();
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const write = async (root, file, text) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); };
const edge = (graph, from, to, rel) => graph.edges.find(item => item.from === from && item.to === to && item.rel === rel);
const signal = () => new AbortController().signal;

test('extraction finds symbols, ignores comments and strings, and parses imports', () => {
  const facts = extractFacts(`import { a as b, type C } from './x.js';
import Def, * as ns from "./y";
// function ghost() {}
const text = "function fake() {}";
export class Foo extends Base implements Iface {
  run() { return b(); }
  static make(): Foo { return new Foo(); }
}
export const helper = async (n: number) => ns.go(n);
export function top() {}
`, 'js');
  assert.deepEqual(facts.symbols.map(symbol => `${symbol.kind}:${symbol.name}`), ['class:Foo', 'method:run', 'method:make', 'function:helper', 'function:top']);
  assert.deepEqual(facts.imports.map(item => item.spec), ['./x.js', './y']);
  assert.deepEqual(facts.imports[0].bindings, [{ local: 'b', imported: 'a' }, { local: 'C', imported: 'C' }]);
  assert.deepEqual(facts.heritage.map(item => `${item.rel}:${item.name}`), ['extends:Base', 'implements:Iface']);
  assert.equal(facts.symbols.some(symbol => /ghost|fake/.test(symbol.name)), false);
});

test('graph resolves imports, calls, inheritance, re-exports, and labels confidence', async () => fixture(async root => {
  await write(root, 'src/base.ts', 'export class Base {\n  hello() { return 1; }\n}\n');
  await write(root, 'src/util.ts', 'export function parse(x: string) { return x; }\nexport function unusedHelper() {}\n');
  await write(root, 'src/index.ts', "export { parse } from './util';\nexport * from './base';\n");
  await write(root, 'src/app.ts', `import { parse, Base } from './index';
export class App extends Base {
  go() { return this.hello() + parse('a'); }
  later() { return this.go(); }
}
export function main() { const app = new App(); app.later(); }
`);
  await write(root, 'src/notes.txt', 'not code');
  const graph = await buildCodeGraph(root, signal());
  assert.equal(edge(graph, 'src/app.ts', 'src/index.ts', 'imports')?.confidence, 'EXTRACTED');
  assert.equal(edge(graph, 'src/index.ts', 'src/util.ts', 'imports')?.confidence, 'EXTRACTED');
  assert.ok(edge(graph, 'src/app.ts#App', 'src/base.ts#Base', 'extends'));
  assert.ok(edge(graph, 'src/app.ts#App.go', 'src/util.ts#parse', 'calls'), 'call through a re-export resolves to the definition');
  assert.equal(edge(graph, 'src/app.ts#App.go', 'src/base.ts#Base.hello', 'calls')?.confidence, 'EXTRACTED', 'this.method follows the base class');
  assert.ok(edge(graph, 'src/app.ts#App.later', 'src/app.ts#App.go', 'calls'));
  assert.ok(edge(graph, 'src/app.ts#main', 'src/app.ts#App', 'calls'), 'new X() is a call to the class');
  const inferred = edge(graph, 'src/app.ts#main', 'src/app.ts#App.later', 'calls');
  assert.equal(inferred?.confidence, 'INFERRED');
  assert.ok(inferred.score > 0 && inferred.score < 1);
  assert.equal(graph.nodes.has('src/notes.txt'), false);
  assert.equal(graph.stats.files, 4);
}));

test('python modules, classes, and relative imports are linked', async () => fixture(async root => {
  await write(root, 'pkg/__init__.py', '');
  await write(root, 'pkg/store.py', 'class Store:\n    def save(self):\n        return self.flush()\n\n    def flush(self):\n        pass\n');
  await write(root, 'pkg/main.py', 'from .store import Store\n\ndef run():\n    s = Store()\n    return s\n');
  const graph = await buildCodeGraph(root, signal());
  assert.ok(edge(graph, 'pkg/main.py', 'pkg/store.py', 'imports'));
  assert.ok(edge(graph, 'pkg/main.py#run', 'pkg/store.py#Store', 'calls'));
  assert.ok(edge(graph, 'pkg/store.py#Store.save', 'pkg/store.py#Store.flush', 'calls'));
}));

test('communities group connected files; queries, paths, and overview report them', async () => fixture(async root => {
  for (const group of ['a', 'b']) {
    await write(root, `${group}/one.ts`, `import { ${group}Two } from './two';
import { ${group}Three } from './three';
export function ${group}One() { return ${group}Two() + ${group}Three(); }
`);
    await write(root, `${group}/two.ts`, `import { ${group}Three } from './three';
export function ${group}Two() { return ${group}Three(); }
`);
    await write(root, `${group}/three.ts`, `export function ${group}Three() { return 1; }
`);
  }
  await write(root, 'a/bridge.ts', "import { bOne } from '../b/one';\nexport function bridge() { return bOne(); }\n");
  const graph = await buildCodeGraph(root, signal());
  const community = id => graph.nodes.get(id).community;
  assert.equal(community('a/one.ts'), community('a/two.ts'));
  assert.equal(community('b/one.ts'), community('b/three.ts'));
  assert.notEqual(community('a/one.ts'), community('b/one.ts'));
  assert.match(overviewText(graph), /Most connected symbols[\s\S]*Communities/);
  assert.match(queryText(graph, 'where is bOne used'), /bridge/);
  assert.match(pathText(graph, 'bridge', 'bThree'), /bridge --calls--> bOne/);
  assert.match(pathText(graph, 'aOne', 'nonexistentThing'), /No graph node/);
}));

test('graph builds reflect edits between calls', async () => fixture(async root => {
  await write(root, 'x.ts', 'export function first() {}\n');
  assert.equal((await buildCodeGraph(root, signal())).nodes.has('x.ts#second'), false);
  await write(root, 'x.ts', 'export function first() {}\nexport function second() { first(); }\n');
  const graph = await buildCodeGraph(root, signal());
  assert.ok(edge(graph, 'x.ts#second', 'x.ts#first', 'calls'));
}));

test('graph tools are read-only registry tools with validated arguments', async () => fixture(async root => {
  await write(root, 'a.ts', 'export function alpha() { return beta(); }\nexport function beta() {}\n');
  const registry = new ToolRegistry(graphTools);
  const run = async (name, args) => registry.prepare(name, JSON.stringify(args)).execute({ root, signal: signal(), approveWrite: async () => false, fileChanged() {}, toolOutput() {} });
  assert.match((await run('graph_overview', {})).content, /Code graph: 1 files/);
  assert.match((await run('graph_query', { question: 'alpha' })).content, /alpha --calls--> beta/);
  assert.match((await run('graph_path', { from: 'alpha', to: 'beta' })).content, /1 hop/);
  assert.throws(() => registry.prepare('graph_query', '{}'), /Missing required/);
  await assert.rejects(run('graph_query', { question: '  ' }), /question/);
}));
