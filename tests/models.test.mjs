import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPENAI_MODEL, DEFAULT_REASONING_EFFORT, MODEL_CATALOG, OPENAI_MODELS, ANTHROPIC_MODELS, isOpenAIModel, isReasoningEffort, supportsReasoning } from '../dist-electron/shared/models.js';
import { requestOpenAITurn } from '../dist-electron/electron/agent/providers/openai.js';

test('catalog has unique ids and a token-efficient default', () => {
  assert.equal(new Set(MODEL_CATALOG.map(model => model.id)).size, MODEL_CATALOG.length);
  assert.equal(OPENAI_MODELS.length + ANTHROPIC_MODELS.length, MODEL_CATALOG.length);
  assert.ok(isOpenAIModel(DEFAULT_OPENAI_MODEL));
  assert.equal(MODEL_CATALOG.find(model => model.id === DEFAULT_OPENAI_MODEL).tier, 'efficient');
  assert.equal(DEFAULT_REASONING_EFFORT, 'low');
  assert.equal(isOpenAIModel('not-a-model'), false);
  assert.equal(isReasoningEffort('medium'), true);
  assert.equal(isReasoningEffort('extreme'), false);
});

test('reasoning options are sent only to models that support them', async () => {
  assert.equal(supportsReasoning('gpt-4.1'), false);
  assert.equal(supportsReasoning('gpt-5-mini'), true);
  assert.equal(supportsReasoning('unlisted-model'), true);
  const oldFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'r' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'r', usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`);
  };
  try {
    for (const model of ['gpt-4.1-mini', 'gpt-5-mini']) {
      await requestOpenAITurn({ apiKey: 'k', model, instructions: '', tools: [], input: [], compactThreshold: 1000, reasoningEffort: 'low', signal: new AbortController().signal, onText() {}, onReasoning() {} });
    }
  } finally { globalThis.fetch = oldFetch; }
  assert.equal('reasoning' in bodies[0], false);
  assert.deepEqual(bodies[1].reasoning, { summary: 'auto', effort: 'low' });
});
