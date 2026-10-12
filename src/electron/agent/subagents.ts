import { DEFAULT_CONTEXT_SETTINGS, compactionThreshold } from '../../shared/context';
import { formatRetrievedContext, retrieveWorkspaceContext, retrievalInstructions } from './retrieval';
import { requestOpenAITurn } from './providers/openai';
import { ToolRegistry } from './tools/registry';
import { readOnlyFilesystemTools } from './tools/filesystem';
import { workspaceSearchTools } from './tools/search';
import { gitInspectionTools } from './tools/git';
import type { SubAgentActivity } from '../../shared/types';

const maxTasks = 3;
const maxTurns = 6;
const maxAnswerLength = 4_000;
const readOnlyRegistry = new ToolRegistry([...readOnlyFilesystemTools, ...workspaceSearchTools, ...gitInspectionTools]);
const instructions = `You are a read-only repository investigator working for a parent coding agent. Answer only the assigned investigation. Inspect files as needed and cite workspace-relative paths. You cannot modify files, run commands, ask the user, or delegate work. Return a concise factual report for the parent agent. ${retrievalInstructions}`;

interface InvestigationResult {
  task: string;
  status: 'completed' | 'failed';
  answer?: string;
  error?: string;
  toolPaths: string[];
  usage: { inputTokens: number; outputTokens: number };
}

async function investigate(root: string, task: string, apiKey: string, model: string, signal: AbortSignal): Promise<InvestigationResult> {
  const snippets = await retrieveWorkspaceContext(root, task, undefined, signal);
  let input: unknown = [{ role: 'user', content: task + formatRetrievedContext(snippets) }];
  let previousResponseId: string | undefined;
  let answer = '';
  const toolPaths: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let turn = 0; turn < maxTurns; turn++) {
    signal.throwIfAborted();
    const response = await requestOpenAITurn({
      apiKey, model, instructions, tools: readOnlyRegistry.definitions(), input, previousResponseId, signal,
      compactThreshold: compactionThreshold(DEFAULT_CONTEXT_SETTINGS), maxOutputTokens: 800, reasoningEffort: 'low',
      onText: text => { answer += text; }, onReasoning: () => undefined
    });
    if (response.usage) {
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
    }
    previousResponseId = response.id;
    if (!response.call) {
      if (!response.hadText) throw new Error('Sub-agent completed without a report.');
      return { task, status: 'completed', answer: answer.trim().slice(0, maxAnswerLength), toolPaths: [...new Set(toolPaths)], usage };
    }
    const prepared = readOnlyRegistry.prepare(response.call.name, response.call.arguments);
    if (prepared.path && prepared.path !== '.') toolPaths.push(prepared.path);
    let result;
    try {
      result = await prepared.execute({
        root, signal, approveWrite: async () => false,
        fileChanged: () => undefined, toolOutput: () => undefined
      });
    } catch (error) {
      result = { success: false, content: error instanceof Error ? error.message : String(error) };
    }
    input = [{ type: 'function_call_output', call_id: response.call.call_id, output: JSON.stringify(result) }];
  }
  throw new Error(`Sub-agent exceeded its ${maxTurns}-turn limit.`);
}

export async function runReadOnlyInvestigations(root: string, tasks: string[], apiKey: string, model: string, signal: AbortSignal, onActivity: (activity: SubAgentActivity) => void = () => undefined): Promise<string> {
  if (tasks.length < 2 || tasks.length > maxTasks) throw new Error(`Run between 2 and ${maxTasks} investigations.`);
  const results = await Promise.all(tasks.map(async (task, index) => {
    onActivity({ index, task, status: 'running', at: new Date().toISOString() });
    try {
      const result = await investigate(root, task, apiKey, model, signal);
      onActivity({ index, task, status: 'completed', at: new Date().toISOString(), usage: result.usage });
      return result;
    }
    catch (error) {
      if (signal.aborted) {
        onActivity({ index, task, status: 'cancelled', at: new Date().toISOString() });
        return { task, status: 'failed', error: 'Stopped', toolPaths: [], usage: { inputTokens: 0, outputTokens: 0 } } satisfies InvestigationResult;
      }
      onActivity({ index, task, status: 'failed', at: new Date().toISOString() });
      return { task, status: 'failed', error: error instanceof Error ? error.message : String(error), toolPaths: [], usage: { inputTokens: 0, outputTokens: 0 } } satisfies InvestigationResult;
    }
  }));
  signal.throwIfAborted();
  const encoded = JSON.stringify({ results }, null, 2);
  if (encoded.length <= 14_000) return encoded;
  return JSON.stringify({ results: results.map(result => ({
    ...result,
    answer: result.answer?.slice(0, 1_500),
    error: result.error?.slice(0, 500),
    toolPaths: result.toolPaths.slice(0, 4).map(path => path.slice(0, 300))
  })), truncated: true }, null, 2);
}
