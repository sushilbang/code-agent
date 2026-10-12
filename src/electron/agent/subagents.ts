import { DEFAULT_CONTEXT_SETTINGS, compactionThreshold, estimateRequestTokens, estimateTextTokens } from '../../shared/context';
import { formatRetrievedContext, retrieveWorkspaceContext, retrievalInstructions } from './retrieval';
import { requestOpenAITurn } from './providers/openai';
import { ToolRegistry } from './tools/registry';
import { readOnlyFilesystemTools } from './tools/filesystem';
import { workspaceSearchTools } from './tools/search';
import { gitInspectionTools } from './tools/git';
import type { SubAgentActivity, SubAgentBudgetUsage } from '../../shared/types';

const maxTasks = 3;
const maxTurns = 6;
const maxAnswerLength = 4_000;
const readOnlyRegistry = new ToolRegistry([...readOnlyFilesystemTools, ...workspaceSearchTools, ...gitInspectionTools]);
const instructions = `You are a read-only repository investigator working for a parent coding agent. Answer only the assigned investigation. Inspect files as needed and cite workspace-relative paths. You cannot modify files, run commands, ask the user, or delegate work. Return a concise factual report for the parent agent. ${retrievalInstructions}`;

export class SubAgentTokenBudget {
  private used = 0;
  private pending = 0;
  private missingUsage = false;

  constructor(readonly limitTokens: number) {}

  snapshot(): SubAgentBudgetUsage {
    return { usedTokens: this.used, limitTokens: this.limitTokens, estimated: this.pending > 0 || this.missingUsage };
  }

  reserve(tokens: number): number {
    if (!Number.isSafeInteger(tokens) || tokens < 1 || this.used + tokens > this.limitTokens) {
      throw new Error(`Sub-agent run budget exhausted (${this.used.toLocaleString()} / ${this.limitTokens.toLocaleString()} tokens reserved or used).`);
    }
    this.used += tokens;
    this.pending++;
    return tokens;
  }

  settle(reserved: number, usage?: { inputTokens: number; outputTokens: number }): void {
    this.pending--;
    if (usage) this.used += usage.inputTokens + usage.outputTokens - reserved;
    else this.missingUsage = true;
  }
}

interface InvestigationResult {
  task: string;
  status: 'completed' | 'failed';
  answer?: string;
  error?: string;
  toolPaths: string[];
  usage: { inputTokens: number; outputTokens: number };
}

async function investigate(root: string, task: string, apiKey: string, model: string, signal: AbortSignal, budget: SubAgentTokenBudget, onBudget: (usage: SubAgentBudgetUsage) => void): Promise<InvestigationResult> {
  const snippets = await retrieveWorkspaceContext(root, task, undefined, signal);
  let input: unknown = [{ role: 'user', content: task + formatRetrievedContext(snippets) }];
  let previousResponseId: string | undefined;
  let answer = '';
  const toolPaths: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let previousTurnTokens = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    signal.throwIfAborted();
    const tools = readOnlyRegistry.definitions();
    const estimatedInput = previousResponseId
      ? previousTurnTokens + estimateTextTokens(JSON.stringify(input)) + 16
      : estimateRequestTokens(input, instructions, tools);
    const reserved = budget.reserve(estimatedInput + 800);
    onBudget(budget.snapshot());
    let response;
    try {
      response = await requestOpenAITurn({
        apiKey, model, instructions, tools, input, previousResponseId, signal,
        compactThreshold: compactionThreshold(DEFAULT_CONTEXT_SETTINGS), maxOutputTokens: 800, reasoningEffort: 'low',
        onText: text => { answer += text; }, onReasoning: () => undefined
      });
    } catch (error) {
      budget.settle(reserved);
      onBudget(budget.snapshot());
      throw error;
    }
    budget.settle(reserved, response.usage);
    onBudget(budget.snapshot());
    if (response.usage) {
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
    }
    previousTurnTokens = response.usage ? response.usage.inputTokens + response.usage.outputTokens : reserved;
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

export async function runReadOnlyInvestigations(root: string, tasks: string[], apiKey: string, model: string, signal: AbortSignal, onActivity: (activity: SubAgentActivity) => void = () => undefined, budget = new SubAgentTokenBudget(DEFAULT_CONTEXT_SETTINGS.subAgentBudgetTokens), onBudget: (usage: SubAgentBudgetUsage) => void = () => undefined): Promise<string> {
  if (tasks.length < 2 || tasks.length > maxTasks) throw new Error(`Run between 2 and ${maxTasks} investigations.`);
  onBudget(budget.snapshot());
  const results = await Promise.all(tasks.map(async (task, index) => {
    onActivity({ index, task, status: 'running', at: new Date().toISOString() });
    try {
      const result = await investigate(root, task, apiKey, model, signal, budget, onBudget);
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
