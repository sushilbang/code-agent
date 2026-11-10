import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelSession } from '../dist-electron/electron/agent/providers/session.js';
import { runAgent } from '../dist-electron/electron/agent.js';
import { DEFAULT_CONTEXT_SETTINGS } from '../dist-electron/shared/context.js';
import { DEFAULT_MODELS, MODEL_CATALOG, detectKeyProvider, isModelFor, modelsFor, providerForModel } from '../dist-electron/shared/models.js';
import { LocalStore } from '../dist-electron/electron/storage.js';

const sse = events => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const start = (id, usage = { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 30 }) => ({ type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [], model: 'claude-haiku-5-5', stop_reason: null, stop_sequence: null, usage } });
const end = (stopReason, outputTokens = 7) => [{ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } }, { type: 'message_stop' }];
const textReply = (id, text) => sse([start(id), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }, ...end('end_turn')]);
const toolReply = (id, name, input) => sse([start(id),
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need the file.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 1 }, ...end('tool_use')]);

async function withFetch(handler, run) {
  const oldFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); requests.push({ url: String(url), headers: new Headers(init.headers), body }); return handler(requests.length, body); };
  try { await run(requests); } finally { globalThis.fetch = oldFetch; }
}
const options = (extra = {}) => ({ apiKey: 'sk-ant-test', model: 'claude-haiku-5-5', instructions: 'be brief', signal: new AbortController().signal, compactThreshold: 1000, onText() {}, onReasoning() {},
  tools: [{ type: 'function', name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, strict: false }], ...extra });

test('Claude sessions send adaptive thinking, effort, and one tool call, then resend history with the tool result', async () => {
  await withFetch(count => count === 1 ? toolReply('msg_1', 'read_file', { path: 'a.ts' }) : textReply('msg_2', 'Done.'), async requests => {
    const text = [], reasoning = [];
    const session = createModelSession('anthropic', options({ reasoningEffort: 'medium', onText: chunk => text.push(chunk), onReasoning: chunk => reasoning.push(chunk) }));
    const first = await session.send({ kind: 'user', history: [{ role: 'assistant', content: 'dropped: history cannot start with the assistant' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }], text: 'read a.ts' });
    assert.deepEqual(first.call, { call_id: 'toolu_1', name: 'read_file', arguments: '{"path":"a.ts"}' });
    assert.deepEqual(first.usage, { inputTokens: 42, outputTokens: 7 }, 'cached input tokens count toward context use');
    assert.deepEqual(reasoning, ['Need the file.']);
    const second = await session.send({ kind: 'tool-result', call_id: 'toolu_1', success: true, output: '{"success":true}' });
    assert.equal(second.call, undefined);
    assert.equal(second.hadText, true);
    assert.deepEqual(text, ['Done.']);

    assert.ok(requests[0].url.endsWith('/v1/messages?beta=true') || requests[0].url.includes('/v1/messages'));
    assert.match(requests[0].headers.get('authorization') ?? requests[0].headers.get('x-api-key') ?? '', /sk-ant-test/);
    assert.match(requests[0].headers.get('anthropic-beta') ?? '', /server-side-fallback/);
    const body = requests[0].body;
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.deepEqual(body.output_config, { effort: 'medium' });
    assert.deepEqual(body.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
    assert.equal(body.tools[0].input_schema.type, 'object');
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.messages[0].content, 'earlier');
    assert.equal(body.fallbacks, 'default');
    const replay = requests[1].body.messages;
    assert.equal(replay.at(-2).role, 'assistant');
    assert.ok(replay.at(-2).content.some(block => block.type === 'thinking'), 'thinking blocks are passed back unchanged');
    assert.ok(replay.at(-2).content.some(block => block.type === 'tool_use' && block.id === 'toolu_1'));
    assert.deepEqual(replay.at(-1).content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"success":true}', is_error: false });
  });
});

test('models without reasoning support get no thinking, effort, or fallback options', async () => {
  await withFetch(() => textReply('msg_1', 'hi'), async requests => {
    await createModelSession('anthropic', options({ model: 'claude-haiku-4-5', reasoningEffort: 'high' })).send({ kind: 'user', history: [], text: 'hello' });
    for (const field of ['thinking', 'output_config', 'fallbacks']) assert.equal(field in requests[0].body, false, field);
  });
});

test('Claude refusals and truncated tool calls surface as errors', async () => {
  await withFetch(() => sse([start('m'), ...end('refusal')]), async () => {
    await assert.rejects(createModelSession('anthropic', options()).send({ kind: 'user', history: [], text: 'x' }), /declined/);
  });
  await withFetch(() => sse([start('m'), { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'read_file', input: {} } }, { type: 'content_block_stop', index: 0 }, ...end('max_tokens')]), async () => {
    await assert.rejects(createModelSession('anthropic', options()).send({ kind: 'user', history: [], text: 'x' }), /output limit/);
  });
});

test('the agent loop runs a Claude tool call end to end', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-claude-'));
  try {
    await writeFile(path.join(root, 'a.ts'), 'export const answer = 42;\n');
    await withFetch(count => count === 1 ? toolReply('msg_1', 'read_file', { path: 'a.ts' }) : textReply('msg_2', 'The answer is 42.'), async () => {
      const events = [];
      await runAgent(root, { runId: 'r1', prompt: 'what is answer?', provider: 'anthropic', model: 'claude-haiku-5-5', reasoningEffort: 'low' }, new AbortController().signal, event => events.push(event), async () => false, 'sk-ant-test', DEFAULT_CONTEXT_SETTINGS);
      assert.ok(events.some(event => event.type === 'tool-result' && event.success && event.content.includes('answer = 42')));
      assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), 'The answer is 42.');
      assert.equal(events.at(-1).type, 'done');
      assert.equal(events.some(event => event.type === 'error'), false);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing Claude key is reported by provider name', async () => {
  const old = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    const events = [];
    await runAgent(os.tmpdir(), { runId: 'r', prompt: 'x', provider: 'anthropic', model: 'claude-haiku-5-5' }, new AbortController().signal, event => events.push(event));
    assert.match(events.at(-1).message, /Claude \(Anthropic\) API key is required/);
  } finally { if (old !== undefined) process.env.ANTHROPIC_API_KEY = old; }
});

test('keys select their provider, and each provider has a valid default model', () => {
  assert.equal(detectKeyProvider('sk-ant-api03-abc'), 'anthropic');
  assert.equal(detectKeyProvider(' sk-proj-abc '), 'openai');
  assert.equal(detectKeyProvider('abc'), null);
  for (const provider of ['anthropic', 'openai']) {
    assert.ok(isModelFor(provider, DEFAULT_MODELS[provider]));
    assert.equal(modelsFor(provider).find(model => model.id === DEFAULT_MODELS[provider]).tier, 'efficient');
  }
  assert.equal(DEFAULT_MODELS.anthropic, 'claude-haiku-5-5');
  assert.equal(isModelFor('anthropic', 'gpt-5-mini'), false);
  assert.equal(providerForModel('claude-opus-5-5'), 'anthropic');
  assert.equal(providerForModel('test-model'), 'openai');
  assert.equal(new Set(MODEL_CATALOG.map(model => model.id)).size, MODEL_CATALOG.length);
});

test('provider keys are stored separately and the OpenAI field stays compatible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-keys-'));
  try {
    const store = new LocalStore(root);
    await store.setEncryptedKey('anthropic', 'enc-a'); await store.setEncryptedOpenAIKey('enc-o');
    assert.equal(await store.getEncryptedKey('anthropic'), 'enc-a');
    assert.equal(await store.getEncryptedOpenAIKey(), 'enc-o');
    await store.setEncryptedKey('anthropic', null);
    assert.equal(await store.getEncryptedKey('anthropic'), null);
    assert.equal(await store.getEncryptedKey('openai'), 'enc-o');
  } finally { await rm(root, { recursive: true, force: true }); }
});
