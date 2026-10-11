import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { retrieveWorkspaceContext, formatRetrievedContext } from '../dist-electron/electron/agent/retrieval.js';
import { selectProjectMemories } from '../dist-electron/electron/agent/memory.js';
import { estimateTextTokens } from '../dist-electron/shared/context.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  { task: 'Chat persistence', prompt: 'Where are saved chats persisted and restored?', expected: ['src/electron/storage.ts'] },
  { task: 'Symlink safety', prompt: 'How does workspace search exclude symlinked paths?', expected: ['src/electron/workspace.ts'] },
  { task: 'Compaction', prompt: 'How does the OpenAI stream report completed context compaction?', expected: ['src/electron/agent/providers/openaiStream.ts'] },
  { task: 'Memory selection', prompt: 'Where is project memory selected for a new run?', expected: ['src/electron/agent/memory.ts', 'src/electron/agent/runner.ts'] },
  { task: 'Save conflicts', prompt: 'How does saving prevent overwriting external file changes?', expected: ['src/electron/workspace.ts'] }
];

// Keep the benchmark prompt list out of the scanned workspace to avoid self-matches.
const root = await mkdtemp(path.join(os.tmpdir(), 'code-agent-context-evaluation-'));
try {
  for (const directory of ['src', 'docs', 'tests']) await cp(path.join(repository, directory), path.join(root, directory), { recursive: true });
  for (const file of ['README.md', 'roadmap.md', 'package.json']) await copyFile(path.join(repository, file), path.join(root, file));
  for (const { task, prompt, expected } of cases) {
    const start = performance.now();
    const sources = await retrieveWorkspaceContext(root, prompt, undefined, new AbortController().signal);
    const paths = sources.map(source => source.path);
    const hits = expected.filter(file => paths.includes(file)).length;
    console.log(JSON.stringify({ task, expected, paths, recall: `${hits}/${expected.length}`,
      precision: `${hits}/${paths.length || 1}`, latencyMs: Math.round(performance.now() - start),
      estimatedTokens: estimateTextTokens(formatRetrievedContext(sources)) }));
  }
} finally {
  if (!root.startsWith(path.join(os.tmpdir(), 'code-agent-context-evaluation-'))) throw new Error('Unsafe evaluation cleanup path.');
  await rm(root, { recursive: true, force: true });
}

const timestamp = '2026-10-01T00:00:00.000Z';
const memories = [
  { id: 'current', topic: 'Billing invoices', value: 'Use integer cents.', source: { kind: 'file', reference: 'docs/concepts/billing.md' }, updatedAt: '2026-10-10T00:00:00.000Z', enabled: true },
  { id: 'stale', topic: 'Billing invoices old', value: 'Use floating point.', source: { kind: 'file', reference: 'docs/concepts/missing.md' }, updatedAt: timestamp, enabled: true },
  { id: 'secret', topic: 'OpenAI API key', value: 'sk-test-placeholder', source: { kind: 'user' }, updatedAt: timestamp, enabled: true },
  { id: 'disabled', topic: 'Billing policy', value: 'Disabled instruction.', source: { kind: 'user' }, updatedAt: timestamp, enabled: false }
];
for (const prompt of ['Explain billing invoices', 'Where is the OpenAI API key used?']) {
  console.log(JSON.stringify({ memoryPrompt: prompt, selected: selectProjectMemories(memories, prompt).map(({ id, topic }) => ({ id, topic })) }));
}
