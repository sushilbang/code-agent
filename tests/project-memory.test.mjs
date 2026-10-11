import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectMemoryStore } from '../dist-electron/electron/projectMemory.js';
import { formatProjectMemories, selectProjectMemories } from '../dist-electron/electron/agent/memory.js';
import { runAgent } from '../dist-electron/electron/agent.js';
import { DEFAULT_CONTEXT_SETTINGS } from '../dist-electron/shared/context.js';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-memory-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('memory is explicitly saved, workspace-scoped, corrected, disabled, and deleted', async () => fixture(async root => {
  const store = new ProjectMemoryStore(path.join(root, 'app-data'));
  const other = path.join(root, 'other');
  assert.deepEqual(await store.list(root), []);
  assert.deepEqual(selectProjectMemories(await store.list(root), 'test strategy'), []);
  const input = { topic: 'Test strategy', value: 'Use node:test for desktop tests.', source: { kind: 'user' }, enabled: true };
  const [initial] = await store.save(root, input);
  assert.equal((await store.list(other)).length, 0);
  assert.equal((await new ProjectMemoryStore(path.join(root, 'app-data')).list(root))[0].id, initial.id);
  assert.equal(selectProjectMemories(await store.list(root), 'What is the test strategy?')[0].id, initial.id);
  await assert.rejects(store.save(root, { ...input, topic: 'TEST STRATEGY' }), /already exists/);
  const [corrected] = await store.save(root, { ...input, id: initial.id, value: 'Use node:test and build first.', enabled: false });
  assert.equal(corrected.createdAt, initial.createdAt);
  assert.equal(corrected.value, 'Use node:test and build first.');
  assert.deepEqual(selectProjectMemories(await store.list(root), 'test strategy'), []);
  assert.equal((await readFile(path.join(root, 'app-data', 'memories.json'), 'utf8')).includes('Test strategy'), true);
  await assert.rejects(store.delete(other, initial.id), /not found/);
  assert.deepEqual(await store.delete(root, initial.id), []);
}));

test('only relevant enabled memory is formatted with provenance and bounded selection', async () => fixture(async root => {
  const store = new ProjectMemoryStore(root);
  await store.save(root, { topic: 'Billing design', value: 'Invoices use integer cents.', source: { kind: 'file', reference: 'docs/billing.md' }, enabled: true });
  await store.save(root, { topic: 'Theme', value: 'The editor is black.', source: { kind: 'user' }, enabled: true });
  await store.save(root, { topic: 'Billing old', value: 'Invoices used floats.', source: { kind: 'user' }, enabled: false });
  const selected = selectProjectMemories(await store.list(root), 'Explain billing invoices');
  assert.deepEqual(selected.map(item => item.topic), ['Billing design']);
  assert.match(formatProjectMemories(selected), /integer cents.*docs\/billing\.md/);
  assert.doesNotMatch(formatProjectMemories(selected), /floats|editor is black/);
  assert.throws(() => store.save(root, { topic: 'Invalid', value: 'x', source: { kind: 'file' }, enabled: true }), /Invalid project memory/);
}));

test('memory rejects obvious credentials and excludes legacy credentials from model context', async () => fixture(async root => {
  const store = new ProjectMemoryStore(root);
  const input = { topic: 'OpenAI API key', value: 'sk-test-placeholder', source: { kind: 'user' }, enabled: true };
  assert.throws(() => store.save(root, input), /appears to contain a credential/);
  assert.throws(() => store.save(root, { ...input, value: 'password: long-placeholder-value' }), /appears to contain a credential/);
  const [ordinary] = await store.save(root, { ...input, value: 'Use the encrypted main-process key store.' });
  const legacy = { ...ordinary, id: 'legacy', value: 'sk-test-placeholder' };
  const selected = selectProjectMemories([legacy, ordinary], 'Where is the OpenAI API key used?');
  assert.deepEqual(selected.map(item => item.id), [ordinary.id]);
  assert.doesNotMatch(formatProjectMemories(selected), /sk-test-placeholder/);
  assert.doesNotMatch(formatProjectMemories([legacy]), /sk-test-placeholder/);
}));

test('stale file labels and conflicting enabled memories remain visible across sessions', async () => fixture(async root => {
  const store = new ProjectMemoryStore(path.join(root, 'app-data'));
  const current = { topic: 'Billing invoices', value: 'Use integer cents.', source: { kind: 'file', reference: 'docs/missing.md' }, enabled: true };
  const old = { topic: 'Old billing invoices', value: 'Use floating point.', source: { kind: 'user' }, enabled: true };
  const [first] = await store.save(root, current);
  const listed = await store.save(root, old);
  const restarted = new ProjectMemoryStore(path.join(root, 'app-data'));
  const selected = selectProjectMemories(await restarted.list(root), 'Explain billing invoices');
  assert.equal(selected.length, 2);
  assert.match(formatProjectMemories(selected), /docs\/missing\.md/);
  assert.match(formatProjectMemories(selected), /floating point/);
  const obsolete = listed.find(item => item.topic === old.topic);
  await restarted.save(root, { ...old, id: obsolete.id, enabled: false });
  assert.deepEqual(selectProjectMemories(await store.list(root), 'Explain billing invoices').map(item => item.id), [first.id]);
}));

test('a new model run includes only explicitly saved relevant memory and exposes its use', async () => fixture(async root => {
  const project = path.join(root, 'project');
  await mkdir(project);
  const store = new ProjectMemoryStore(path.join(root, 'app-data'));
  const [memory] = await store.save(project, { topic: 'Billing design', value: 'Invoices use integer cents.', source: { kind: 'user' }, enabled: true });
  await store.save(project, { topic: 'Old billing rule', value: 'Invoices use floats.', source: { kind: 'user' }, enabled: false });
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response('data: {"type":"response.created","response":{"id":"memory-test"}}\n\ndata: {"type":"response.output_text.delta","delta":"Done."}\n\ndata: {"type":"response.completed","response":{"id":"memory-test"}}\n\ndata: [DONE]\n\n');
  };
  try {
    const events = [];
    const legacy = { ...memory, id: 'legacy', value: 'sk-test-placeholder' };
    await runAgent(project, { runId: 'memory', prompt: 'Explain billing invoices', provider: 'openai', model: 'test-model' },
      new AbortController().signal, event => events.push(event), async () => false, 'test-key', DEFAULT_CONTEXT_SETTINGS, [...await store.list(project), legacy]);
    assert.deepEqual(events.find(event => event.type === 'context-memory').items, [{ id: memory.id, topic: memory.topic }]);
    assert.match(request.input.at(-1).content, /Invoices use integer cents/);
    assert.doesNotMatch(request.input.at(-1).content, /Invoices use floats/);
    assert.doesNotMatch(request.input.at(-1).content, /sk-test-placeholder/);
    assert.equal(events.at(-1).type, 'done');
  } finally { globalThis.fetch = previousFetch; }
}));
