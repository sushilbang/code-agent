import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAgentChange, applyAgentPathChange, buildWorkspace, createWorkspaceEntry, planAgentCreateDirectory, planAgentDelete, planAgentReplacement, planAgentWrite, readPreview, resolveWorkspacePath, saveWorkspaceFile } from '../dist-electron/electron/workspace.js';
import { runAgent } from '../dist-electron/electron/agent.js';
import { LocalStore } from '../dist-electron/electron/storage.js';
import { buildActionDiff } from '../dist-electron/electron/actionDiff.js';
import { readResponseStream } from '../dist-electron/electron/agent/providers/openai.js';
import { filesystemTools } from '../dist-electron/electron/agent/tools/filesystem.js';
import { ToolRegistry } from '../dist-electron/electron/agent/tools/registry.js';
import { workspaceSearchTools } from '../dist-electron/electron/agent/tools/search.js';
import { shellTools } from '../dist-electron/electron/agent/tools/shell.js';
import { gitInspectionTools } from '../dist-electron/electron/agent/tools/git.js';
import { diagnosticTools } from '../dist-electron/electron/agent/tools/diagnostics.js';
import { runBoundedProcess } from '../dist-electron/electron/agent/tools/process.js';
import { applyPatch } from 'diff';
import { DEFAULT_CONTEXT_SETTINGS, contextLevel, estimateRequestTokens, estimateTextTokens, isContextSettings } from '../dist-electron/shared/context.js';

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

test('context estimates grow with request content and thresholds are validated', () => {
  const short = estimateRequestTokens([{ role: 'user', content: 'hello' }], 'Instructions', []);
  const long = estimateRequestTokens([{ role: 'user', content: 'hello'.repeat(100) }], 'Instructions', []);
  assert.ok(long > short);
  assert.equal(estimateTextTokens('12345678'), 2);
  assert.equal(isContextSettings(DEFAULT_CONTEXT_SETTINGS), true);
  assert.equal(isContextSettings({ ...DEFAULT_CONTEXT_SETTINGS, compactionPercent: 70 }), false);
  assert.equal(contextLevel({ inputTokens: 83_999, source: 'estimate' }, DEFAULT_CONTEXT_SETTINGS), 'normal');
  assert.equal(contextLevel({ inputTokens: 84_000, source: 'api' }, DEFAULT_CONTEXT_SETTINGS), 'warning');
  assert.equal(contextLevel({ inputTokens: 108_000, source: 'api' }, DEFAULT_CONTEXT_SETTINGS), 'compaction-target');
});

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

test('tool registry exposes and dispatches filesystem tools', async () => fixture(async root => {
  await writeFile(path.join(root, 'hello.txt'), 'hello');
  const registry = new ToolRegistry(filesystemTools);
  assert.deepEqual(registry.definitions().map(tool => tool.name), [
    'list_files', 'read_file', 'write_file', 'replace_in_file',
    'create_file', 'create_directory', 'delete_file', 'delete_directory'
  ]);
  const prepared = registry.prepare('read_file', JSON.stringify({ path: 'hello.txt' }));
  assert.equal(prepared.path, 'hello.txt');
  assert.equal(prepared.description, 'Reading hello.txt');
  const result = await prepared.execute({
    root, signal: new AbortController().signal, approveWrite: async () => false, fileChanged() {}
  });
  assert.deepEqual(result, { success: true, content: 'hello' });
  assert.throws(() => registry.prepare('missing_tool', '{}'), /Unknown tool/);
  assert.throws(() => registry.prepare('read_file', '[]'), /Invalid tool arguments/);
  assert.throws(() => registry.prepare('read_file', '{}'), /Missing required tool argument: path/);
  assert.throws(() => registry.prepare('list_files', '{"limit":"many"}'), /limit must be integer/);
}));

test('OpenAI stream parsing respects cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = new ReadableStream({ start(target) { target.close(); } });
  await assert.rejects(readResponseStream(stream, controller.signal, () => {}, () => {}), /Stopped/);
});

test('glob and text search are bounded to safe workspace files', async () => fixture(async root => {
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'src', 'one.ts'), 'export const Needle = 1;\n');
  await writeFile(path.join(root, 'src', 'two.js'), 'const needle = 2;\n');
  await writeFile(path.join(root, 'node_modules', 'hidden.ts'), 'const Needle = 3;\n');
  const registry = new ToolRegistry(workspaceSearchTools);
  const context = { root, signal: new AbortController().signal, approveWrite: async () => false, fileChanged() {} };

  const glob = await registry.prepare('glob_files', '{"pattern":"**/*.ts"}').execute(context);
  assert.equal(glob.content, 'src/one.ts');
  const search = await registry.prepare('search_text', '{"query":"needle","path":"src","glob":"**/*.*"}').execute(context);
  assert.match(search.content, /src\/one\.ts:1:/);
  assert.match(search.content, /src\/two\.js:1:/);
  assert.doesNotMatch(search.content, /hidden/);
  await assert.rejects(registry.prepare('glob_files', '{"pattern":"../*.ts"}').execute(context), /simple glob pattern|traversal/);

  const controller = new AbortController();
  controller.abort();
  const cancelled = registry.prepare('search_text', '{"query":"needle"}');
  await assert.rejects(cancelled.execute({ ...context, signal: controller.signal }), /abort/i);
}));

test('command tool requires approval and streams bounded workspace execution', async () => fixture(async root => {
  const registry = new ToolRegistry(shellTools);
  const prepared = registry.prepare('run_command', JSON.stringify({ executable: 'node', args: ['-e', 'console.log("hello")'], cwd: '.' }));
  const streamed = [];
  let approval;
  const result = await prepared.execute({
    root, signal: new AbortController().signal, fileChanged() {}, toolOutput: chunk => streamed.push(chunk),
    approveWrite: async (change, tool, _signal, allowAlways) => { approval = { change, tool, allowAlways }; return true; }
  });
  assert.equal(result.success, true);
  assert.match(result.content, /hello/);
  assert.match(result.content, /exit code: 0/);
  assert.match(streamed.join(''), /hello/);
  assert.equal(approval.tool, 'run_command');
  assert.equal(approval.allowAlways, false);
  assert.match(approval.change.details, /Working directory: \./);

  const denied = await prepared.execute({
    root, signal: new AbortController().signal, fileChanged() {}, toolOutput() {}, approveWrite: async () => false
  });
  assert.deepEqual(denied, { success: false, content: 'Command was not approved.' });
  await assert.rejects(registry.prepare('run_command', JSON.stringify({ executable: 'node', args: [], cwd: '..' })).execute({
    root, signal: new AbortController().signal, fileChanged() {}, toolOutput() {}, approveWrite: async () => true
  }), /outside the workspace/);
}));

test('command tool terminates on cancellation', async () => fixture(async root => {
  const registry = new ToolRegistry(shellTools);
  const controller = new AbortController();
  const startedAt = Date.now();
  const running = registry.prepare('run_command', JSON.stringify({ executable: 'node', args: ['-e', 'setTimeout(() => {}, 10000)'] })).execute({
    root, signal: controller.signal, fileChanged() {}, toolOutput() {}, approveWrite: async () => true
  });
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assert.equal(result.success, false);
  assert.match(result.content, /stopped/i);
  assert.ok(Date.now() - startedAt < 3000, 'cancelled command should terminate promptly');
}));

test('command tool enforces timeout and truncates output', async () => fixture(async root => {
  const registry = new ToolRegistry(shellTools);
  const context = {
    root, signal: new AbortController().signal, fileChanged() {}, toolOutput() {}, approveWrite: async () => true
  };
  const startedAt = Date.now();
  const timedOut = await registry.prepare('run_command', JSON.stringify({
    executable: 'node', args: ['-e', 'setTimeout(() => {}, 10000)'], timeout_ms: 1000
  })).execute(context);
  assert.equal(timedOut.success, false);
  assert.match(timedOut.content, /timed out/i);
  assert.ok(Date.now() - startedAt < 4000, 'timed out command should terminate promptly');

  const truncated = await registry.prepare('run_command', JSON.stringify({
    executable: 'node', args: ['-e', 'process.stdout.write("x".repeat(50000))']
  })).execute(context);
  assert.equal(truncated.success, true);
  assert.match(truncated.content, /\[output truncated\]/);
  assert.ok(truncated.content.length < 40100);
}));

async function git(root, args) {
  const result = await runBoundedProcess({
    executable: 'git', args, cwd: root, signal: new AbortController().signal, timeoutMs: 5000
  });
  assert.equal(result.success, true, result.output);
}

test('Git inspection reports structured status and bounded staged or unstaged diffs', async () => fixture(async root => {
  await git(root, ['init']);
  const registry = new ToolRegistry(gitInspectionTools);
  const context = { root, signal: new AbortController().signal, approveWrite: async () => false, fileChanged() {}, toolOutput() {} };
  const unborn = JSON.parse((await registry.prepare('git_status', '{}').execute(context)).content);
  assert.equal(unborn.clean, true);
  assert.match(unborn.branch, /No commits yet/);
  await writeFile(path.join(root, 'tracked.txt'), 'before\n');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['-c', 'user.name=Code Agent Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  const clean = JSON.parse((await registry.prepare('git_status', '{}').execute(context)).content);
  assert.equal(clean.clean, true);
  await writeFile(path.join(root, 'tracked.txt'), `after\n${'x'.repeat(50000)}`);
  await writeFile(path.join(root, 'new.txt'), 'new\n');

  const status = await registry.prepare('git_status', '{}').execute(context);
  const parsed = JSON.parse(status.content);
  assert.equal(parsed.clean, false);
  assert.match(parsed.branch, /master|main/);
  assert.ok(parsed.entries.some(entry => entry.path === 'tracked.txt' && entry.status.includes('M')));
  assert.ok(parsed.entries.some(entry => entry.path === 'new.txt' && entry.status === '??'));

  const unstaged = await registry.prepare('git_diff', '{}').execute(context);
  assert.equal(unstaged.success, true);
  assert.match(unstaged.content, /tracked\.txt/);
  assert.match(unstaged.content, /\[diff truncated\]/);
  await git(root, ['add', 'tracked.txt']);
  const staged = await registry.prepare('git_diff', '{"staged":true,"path":"tracked.txt"}').execute(context);
  assert.match(staged.content, /tracked\.txt/);
  await assert.rejects(registry.prepare('git_diff', '{"path":"../outside"}').execute(context), /outside the workspace/);
}));

test('Git inspection handles non-repositories, cancellation, and a missing executable', async () => fixture(async root => {
  const registry = new ToolRegistry(gitInspectionTools);
  const context = { root, signal: new AbortController().signal, approveWrite: async () => false, fileChanged() {}, toolOutput() {} };
  await assert.rejects(registry.prepare('git_status', '{}').execute(context), /not a Git repository/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registry.prepare('git_status', '{}').execute({ ...context, signal: controller.signal }), /abort/i);
  await assert.rejects(runBoundedProcess({
    executable: 'code-agent-command-that-does-not-exist', args: [], cwd: root,
    signal: new AbortController().signal, timeoutMs: 1000
  }), /ENOENT|not found/i);
}));

test('diagnostics only run approved allowlisted package scripts and summarize failures', async () => fixture(async root => {
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    test: 'node -e "console.log(\'diagnostic ok\')"',
    lint: 'node -e "console.error(\'error: diagnostic failed\'); process.exit(1)"',
    unsafe: 'node -e "console.log(\'unsafe\')"'
  } }));
  const registry = new ToolRegistry(diagnosticTools);
  const streamed = [];
  let approval;
  const context = {
    root, signal: new AbortController().signal, fileChanged() {}, toolOutput: chunk => streamed.push(chunk),
    approveWrite: async (change, tool, _signal, allowAlways) => { approval = { change, tool, allowAlways }; return true; }
  };
  const passed = await registry.prepare('run_diagnostics', '{"script":"test"}').execute(context);
  assert.equal(passed.success, true);
  assert.match(passed.content, /Status: passed/);
  assert.match(streamed.join(''), /diagnostic ok/);
  assert.equal(approval.tool, 'run_diagnostics');
  assert.equal(approval.allowAlways, false);

  const failed = await registry.prepare('run_diagnostics', '{"script":"lint"}').execute(context);
  assert.equal(failed.success, false);
  assert.match(failed.content, /Status: failed/);
  assert.match(failed.content, /Issue lines: [1-9]/);
  const denied = await registry.prepare('run_diagnostics', '{"script":"test"}').execute({ ...context, approveWrite: async () => false });
  assert.deepEqual(denied, { success: false, content: 'Diagnostics were not approved.' });
  await assert.rejects(registry.prepare('run_diagnostics', '{"script":"unsafe"}').execute(context), /Choose a diagnostic script/);
  await assert.rejects(registry.prepare('run_diagnostics', '{"script":"build"}').execute(context), /does not define a build script/);
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
      { type: 'response.completed', response: { id: 'resp_1', usage: { input_tokens: 321, output_tokens: 22 } } }
    ],
    [
      { type: 'response.created', response: { id: 'resp_2' } },
      { type: 'response.output_text.delta', delta: 'The file defines a server flag.' },
      { type: 'response.completed', response: { id: 'resp_2', usage: { input_tokens: 415, output_tokens: 18 } } }
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
    assert.deepEqual(events.map(event => event.type), ['context-usage', 'reasoning', 'context-usage', 'tool-start', 'tool-result', 'context-usage', 'delta', 'context-usage', 'done']);
    assert.equal(events[0].usage.source, 'estimate');
    assert.deepEqual(events[2].usage, { inputTokens: 321, outputTokens: 22, source: 'api' });
    assert.equal(events[1].text, 'I should inspect the file.');
    assert.equal(events[3].description, 'Reading server.js');
    assert.match(events[4].content, /server = true/);
    assert.ok(events[5].usage.inputTokens > 321);
    assert.deepEqual(events[7].usage, { inputTokens: 415, outputTokens: 18, source: 'api' });
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
    updatedAt: '2026-10-02T10:00:00.000Z', contextUsage: { inputTokens: 415, outputTokens: 18, source: 'api' }, messages: [
      { id: 'one', role: 'user', text: 'Edit example' },
      { id: 'two', role: 'assistant', text: 'Updated.', tools: [{ id: 'write', name: 'write_file', path: 'example.ts', description: 'Writing example.ts', success: true, diff: '@@ -1 +1 @@\n-old\n+new' }] }
    ] };
  await store.saveChat(chat);
  assert.equal((await store.listChats())[0].title, chat.title);
  assert.deepEqual((await new LocalStore(path.join(root, 'app-data')).getChat(chat.id)).messages, chat.messages);
  assert.deepEqual((await new LocalStore(path.join(root, 'app-data')).getChat(chat.id)).contextUsage, chat.contextUsage);
  await store.allowAction(root, 'write_file');
  assert.deepEqual(await store.allowedActions(root), ['write_file']);
  assert.deepEqual(await store.allowedActions(path.join(root, 'other')), []);
  assert.deepEqual(await store.revokeAction(root, 'write_file'), []);
  await store.deleteChat(chat.id);
  assert.deepEqual(await store.listChats(), []);
}));

test('context settings persist without replacing the encrypted key', async () => fixture(async root => {
  const store = new LocalStore(path.join(root, 'app-data'));
  assert.deepEqual(await store.getContextSettings(), DEFAULT_CONTEXT_SETTINGS);
  await store.setEncryptedOpenAIKey('encrypted-one');
  const configured = { workingBudgetTokens: 80_000, warningPercent: 65, compactionPercent: 85 };
  await store.setContextSettings(configured);
  const restored = new LocalStore(path.join(root, 'app-data'));
  assert.deepEqual(await restored.getContextSettings(), configured);
  assert.equal(await restored.getEncryptedOpenAIKey(), 'encrypted-one');
  await assert.rejects(store.setContextSettings({ ...configured, compactionPercent: 65 }), /Invalid context settings/);
}));

test('encrypted API key payload can be saved, replaced, and removed', async () => fixture(async root => {
  const store = new LocalStore(path.join(root, 'app-data'));
  assert.equal(await store.getEncryptedOpenAIKey(), null);
  await store.setEncryptedOpenAIKey('encrypted-one');
  assert.equal(await new LocalStore(path.join(root, 'app-data')).getEncryptedOpenAIKey(), 'encrypted-one');
  await store.setEncryptedOpenAIKey('encrypted-two');
  assert.equal(await store.getEncryptedOpenAIKey(), 'encrypted-two');
  await store.setEncryptedOpenAIKey(null);
  assert.equal(await store.getEncryptedOpenAIKey(), null);
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
