import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAgentChange, applyAgentPathChange, buildWorkspace, createWorkspaceEntry, planAgentCreateDirectory, planAgentDelete, planAgentReplacement, planAgentWrite, readPreview, resolveWorkspacePath, saveWorkspaceFile } from '../dist-electron/electron/workspace.js';
import { runAgent } from '../dist-electron/electron/agent.js';
import { LocalStore } from '../dist-electron/electron/storage.js';
import { buildActionDiff } from '../dist-electron/electron/actionDiff.js';
import { applyPatch } from 'diff';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-test-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('workspace tree excludes generated folders', async () => fixture(async root => {
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'src', 'hello.ts'), 'export const hello = true;');
  await writeFile(path.join(root, 'node_modules', 'hidden.js'), '');
  const tree = await buildWorkspace(root);
  assert.equal(tree.fileCount, 1);
  assert.equal(tree.nodes[0].name, 'src');
  assert.equal(tree.nodes[0].children[0].path, 'src/hello.ts');
  assert.equal(tree.nodes.some(node => node.name === 'node_modules'), false);
}));

test('preview reads text and refuses binary and traversal', async () => fixture(async root => {
  await writeFile(path.join(root, 'hello.ts'), 'one\ntwo');
  await writeFile(path.join(root, 'image.bin'), Buffer.from([0, 1, 2]));
  const preview = await readPreview(root, 'hello.ts');
  assert.equal(preview.content, 'one\ntwo');
  assert.equal(preview.lines, 2);
  await assert.rejects(readPreview(root, 'image.bin'), /Binary/);
  await assert.rejects(resolveWorkspacePath(root, '../outside.txt'), /outside the workspace/);
}));

test('local inspection emits a response and completion', async () => fixture(async root => {
  await writeFile(path.join(root, 'README.md'), 'hello');
  const events = [];
  await runAgent(root, { runId: 'test', prompt: 'Inspect', provider: 'local', model: '' }, new AbortController().signal, event => events.push(event));
  assert.deepEqual(events.map(event => event.type), ['delta', 'done']);
  assert.match(events[0].text, /1 files/);
}));

test('create file and folder, then save without overwriting external changes', async () => fixture(async root => {
  await createWorkspaceEntry(root, 'src', true);
  const tree = await createWorkspaceEntry(root, 'src/new.ts', false);
  assert.equal(tree.nodes[0].children[0].path, 'src/new.ts');
  await saveWorkspaceFile(root, 'src/new.ts', 'const value = 1;', '');
  assert.equal((await readPreview(root, 'src/new.ts')).content, 'const value = 1;');
  await writeFile(path.join(root, 'src', 'new.ts'), 'external change');
  await assert.rejects(saveWorkspaceFile(root, 'src/new.ts', 'overwrite', 'const value = 1;'), /changed on disk/);
  await assert.rejects(createWorkspaceEntry(root, '../outside.ts', false));
}));

test('OpenAI stream exposes only returned reasoning summary and tool activity', async () => fixture(async root => {
  await writeFile(path.join(root, 'server.js'), 'const server = true;');
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const streams = [
    [
      { type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.reasoning_summary_text.delta', delta: 'I should inspect the file.' },
      { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"server.js"}' } },
      { type: 'response.completed', response: { id: 'resp_1' } }
    ],
    [
      { type: 'response.created', response: { id: 'resp_2' } },
      { type: 'response.output_text.delta', delta: 'The file defines a server flag.' },
      { type: 'response.completed', response: { id: 'resp_2' } }
    ]
  ];
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(streams.shift().map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const events = [];
    await runAgent(root, { runId: 'stream', prompt: 'Inspect server.js', provider: 'openai', model: 'test-model' }, new AbortController().signal, event => events.push(event));
    assert.deepEqual(events.map(event => event.type), ['reasoning', 'tool-start', 'tool-result', 'delta', 'done']);
    assert.equal(events[0].text, 'I should inspect the file.');
    assert.equal(events[1].description, 'Reading server.js');
    assert.match(events[2].content, /server = true/);
    assert.deepEqual(requests[0].reasoning, { summary: 'auto' });
    assert.equal(requests[1].previous_response_id, 'resp_1');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}));

test('agent write plans respect expected content and stay in the workspace', async () => fixture(async root => {
  await writeFile(path.join(root, 'example.ts'), 'const answer = 1;\n');
  await assert.rejects(planAgentWrite(root, 'example.ts', 'new'), /expected_content/);
  await assert.rejects(planAgentWrite(root, 'example.ts', 'new', 'stale'), /changed since/);
  await assert.rejects(planAgentWrite(root, '../outside.ts', 'new'), /outside the workspace/);
  const change = await planAgentReplacement(root, 'example.ts', 'answer = 1', 'answer = 42');
  assert.equal(await readFile(path.join(root, 'example.ts'), 'utf8'), 'const answer = 1;\n');
  await applyAgentChange(root, change);
  assert.equal(await readFile(path.join(root, 'example.ts'), 'utf8'), 'const answer = 42;\n');
  await assert.rejects(applyAgentChange(root, change), /changed on disk/);
  const created = await planAgentWrite(root, 'new.ts', 'export const ready = true;\n');
  await applyAgentChange(root, created);
  assert.equal(await readFile(path.join(root, 'new.ts'), 'utf8'), created.after);
}));

test('agent edits example.ts only after approval', async () => fixture(async root => {
  const original = '// this is example code\n';
  const replacement = 'export function double(value: number): number { return value * 2; }\n';
  await writeFile(path.join(root, 'example.ts'), original);
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const streams = [
    [{ type: 'response.created', response: { id: 'read' } }, { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'read_call', name: 'read_file', arguments: JSON.stringify({ path: 'example.ts' }) } }, { type: 'response.completed', response: { id: 'read' } }],
    [{ type: 'response.created', response: { id: 'write' } }, { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'write_call', name: 'write_file', arguments: JSON.stringify({ path: 'example.ts', content: replacement, expected_content: original }) } }, { type: 'response.completed', response: { id: 'write' } }],
    [{ type: 'response.created', response: { id: 'final' } }, { type: 'response.output_text.delta', delta: 'Updated `example.ts`.' }, { type: 'response.completed', response: { id: 'final' } }]
  ];
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(streams.shift().map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  try {
    const events = [];
    let reviewed = false;
    await runAgent(root, { runId: 'edit', prompt: 'Update example.ts', provider: 'openai', model: 'test-model' }, new AbortController().signal,
      event => events.push(event), async (change, tool) => {
        reviewed = true;
        assert.equal(tool, 'write_file');
        assert.equal(change.before, original);
        assert.equal(change.after, replacement);
        assert.equal(await readFile(path.join(root, 'example.ts'), 'utf8'), original);
        return true;
      });
    assert.equal(reviewed, true);
    assert.equal(await readFile(path.join(root, 'example.ts'), 'utf8'), replacement);
    assert.ok(events.some(event => event.type === 'file-changed' && event.path === 'example.ts'));
    const writeResult = events.find(event => event.type === 'tool-result' && event.id === 'write_call');
    assert.equal(applyPatch(original, writeResult.diff), replacement);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(requests[2].previous_response_id, 'write');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}));

test('rejected agent write leaves example.ts unchanged', async () => fixture(async root => {
  const original = 'export const value = 1;\n';
  await writeFile(path.join(root, 'example.ts'), original);
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const streams = [
    [{ type: 'response.created', response: { id: 'write' } }, { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call', name: 'replace_in_file', arguments: JSON.stringify({ path: 'example.ts', old_text: 'value = 1', new_text: 'value = 2' }) } }, { type: 'response.completed', response: { id: 'write' } }],
    [{ type: 'response.created', response: { id: 'final' } }, { type: 'response.output_text.delta', delta: 'Change rejected.' }, { type: 'response.completed', response: { id: 'final' } }]
  ];
  globalThis.fetch = async () => new Response(streams.shift().map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
  try {
    const events = [];
    await runAgent(root, { runId: 'deny', prompt: 'Update example.ts', provider: 'openai', model: 'test-model' }, new AbortController().signal,
      event => events.push(event), async () => false);
    assert.equal(await readFile(path.join(root, 'example.ts'), 'utf8'), original);
    assert.ok(events.some(event => event.type === 'tool-result' && !event.success));
    assert.equal(events.some(event => event.type === 'file-changed'), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}));

test('agent folder and file actions create, validate, and delete safely', async () => fixture(async root => {
  const folder = await planAgentCreateDirectory(root, 'src');
  await applyAgentPathChange(root, folder);
  const file = await planAgentWrite(root, 'src/index.ts', 'export const ok = true;\n');
  await applyAgentChange(root, file);
  await assert.rejects(planAgentCreateDirectory(root, 'src'), /already exists/);
  await assert.rejects(planAgentDelete(root, '../outside', true), /inside the workspace/);
  await assert.rejects(planAgentDelete(root, '.', true), /root/);
  const staleDelete = await planAgentDelete(root, 'src', true);
  await writeFile(path.join(root, 'src', 'index.ts'), 'external change');
  await assert.rejects(applyAgentPathChange(root, staleDelete), /changed since approval/);
  const deleteFile = await planAgentDelete(root, 'src/index.ts', false);
  await applyAgentPathChange(root, deleteFile);
  await assert.rejects(readFile(path.join(root, 'src', 'index.ts')), /ENOENT/);
  const deleteFolder = await planAgentDelete(root, 'src', true);
  await applyAgentPathChange(root, deleteFolder);
  await assert.rejects(readFile(path.join(root, 'src')), /ENOENT/);
}));

test('local chats and per-workspace permissions persist and can be removed', async () => fixture(async root => {
  const store = new LocalStore(path.join(root, 'app-data'));
  const chat = { id: '12345678-1234-1234-1234-123456789abc', title: 'Edit example', workspaceRoot: root,
    updatedAt: '2026-10-02T10:00:00.000Z', messages: [
      { id: 'one', role: 'user', text: 'Edit example' },
      { id: 'two', role: 'assistant', text: 'Updated.', tools: [{ id: 'write', name: 'write_file', path: 'example.ts', description: 'Writing example.ts', success: true, diff: '@@ -1 +1 @@\n-old\n+new' }] }
    ] };
  await store.saveChat(chat);
  assert.equal((await store.listChats())[0].title, chat.title);
  assert.deepEqual((await new LocalStore(path.join(root, 'app-data')).getChat(chat.id)).messages, chat.messages);
  await store.allowAction(root, 'write_file');
  assert.deepEqual(await store.allowedActions(root), ['write_file']);
  assert.deepEqual(await store.allowedActions(path.join(root, 'other')), []);
  assert.deepEqual(await store.revokeAction(root, 'write_file'), []);
  await store.deleteChat(chat.id);
  assert.deepEqual(await store.listChats(), []);
}));

test('agent dispatches create and delete tools through approval', async () => fixture(async root => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const calls = [
    { name: 'create_directory', arguments: { path: 'src' } },
    { name: 'create_file', arguments: { path: 'src/new.ts', content: 'export const ready = true;\n' } },
    { name: 'delete_file', arguments: { path: 'src/new.ts' } },
    { name: 'delete_directory', arguments: { path: 'src' } }
  ];
  let index = 0;
  globalThis.fetch = async () => {
    const id = `response_${index}`;
    const call = calls[index++];
    const events = [{ type: 'response.created', response: { id } }];
    if (call) events.push({ type: 'response.output_item.done', item: { type: 'function_call', call_id: id, name: call.name, arguments: JSON.stringify(call.arguments) } });
    else events.push({ type: 'response.output_text.delta', delta: 'Done.' });
    events.push({ type: 'response.completed', response: { id } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  try {
    const events = [];
    const approved = [];
    await runAgent(root, { runId: 'actions', prompt: 'Create and remove src', provider: 'openai', model: 'test-model' }, new AbortController().signal,
      event => events.push(event), async (_change, tool) => { approved.push(tool); return true; });
    assert.deepEqual(approved, calls.map(call => call.name));
    assert.equal(events.filter(event => event.type === 'file-changed').length, 4);
    assert.equal(events.at(-1).type, 'done');
    await assert.rejects(readFile(path.join(root, 'src')), /ENOENT/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}));

test('unified diffs show only changed hunks and preserve newlines', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
  const after = before.replace('two\n', 'TWO\n');
  const patch = buildActionDiff({ path: 'sample.ts', before, after });
  assert.match(patch, /@@ -1,5 \+1,5 @@/);
  assert.match(patch, /-two\n\+TWO/);
  assert.doesNotMatch(patch, /-one\n|\+one\n/);
  assert.doesNotMatch(patch, /-eight\n|\+eight\n/);
  assert.equal(applyPatch(before, patch), after);

  const noNewline = buildActionDiff({ path: 'sample.ts', before: 'one\ntwo', after: 'one\nTWO' });
  assert.equal(applyPatch('one\ntwo', noNewline), 'one\nTWO');
  assert.equal(buildActionDiff({ path: 'sample.ts', before, after: before }), undefined);
});

test('file creations and deletions have patches, folder actions do not', () => {
  const created = buildActionDiff({ path: 'new.ts', before: null, after: 'export const x = 1;\n' });
  assert.match(created, /--- \/dev\/null/);
  assert.equal(applyPatch('', created), 'export const x = 1;\n');
  const deleted = buildActionDiff({ operation: 'delete_file', path: 'old.ts', before: 'old\n', after: '', fingerprint: 'test', details: '' });
  assert.match(deleted, /\+\+\+ \/dev\/null/);
  assert.equal(applyPatch('old\n', deleted), '');
  assert.equal(buildActionDiff({ operation: 'create_directory', path: 'src', before: null, after: '', details: '' }), undefined);
});
