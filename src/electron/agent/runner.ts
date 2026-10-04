import type { AgentRequest } from '../../shared/types';
import { listFiles } from '../workspace';
import { errorMessage, scopedEmitter, type EmitAgentEvent } from './events';
import { agentInstructions } from './instructions';
import { requestOpenAITurn } from './providers/openai';
import { filesystemTools } from './tools/filesystem';
import { ToolRegistry } from './tools/registry';
import { workspaceSearchTools } from './tools/search';
import { shellTools } from './tools/shell';
import { gitInspectionTools } from './tools/git';
import { diagnosticTools } from './tools/diagnostics';
import type { ApproveAgentChange } from './tools/types';

const registry = new ToolRegistry([...filesystemTools, ...workspaceSearchTools, ...gitInspectionTools, ...diagnosticTools, ...shellTools]);

export async function runAgent(root: string, request: AgentRequest, signal: AbortSignal, emit: EmitAgentEvent, approveWrite: ApproveAgentChange = async () => false, apiKey?: string): Promise<void> {
  const send = scopedEmitter(request.runId, emit);
  try {
    if (request.provider === 'local') {
      const files = await listFiles(root, '.', 200);
      if (signal.aborted) throw new Error('Stopped');
      send({ type: 'delta', text: `Local inspection found ${files.length} files in the first scan.\n\nThis mode does not call a model or change files. Select OpenAI for code analysis.` });
      send({ type: 'done' });
      return;
    }

    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error('An OpenAI API key is required. Add one in Agent settings.');
    if (!request.model.trim()) throw new Error('Choose a model.');
    let input: unknown = [...(request.history || []).slice(-12), { role: 'user', content: request.selectedFile
      ? `Selected file: ${request.selectedFile}\n\n${request.prompt}` : request.prompt }];
    let previousResponseId: string | undefined;

    for (let turn = 0; turn < 30; turn++) {
      if (signal.aborted) throw new Error('Stopped');
      const response = await requestOpenAITurn({
        apiKey: key, model: request.model.trim(), instructions: agentInstructions,
        tools: registry.definitions(), input, previousResponseId, signal,
        onText: text => send({ type: 'delta', text }),
        onReasoning: text => send({ type: 'reasoning', text })
      });
      previousResponseId = response.id;
      if (!response.call) {
        if (!response.hadText) throw new Error('OpenAI completed without text or a tool call.');
        send({ type: 'done' });
        return;
      }

      const call = response.call;
      let result;
      try {
        const prepared = registry.prepare(call.name, call.arguments);
        send({ type: 'tool-start', id: call.call_id, name: call.name, path: prepared.path, description: prepared.description });
        result = await prepared.execute({
          root, signal, approveWrite,
          fileChanged: (path, deleted, directory) => send({ type: 'file-changed', path, deleted, directory }),
          toolOutput: content => send({ type: 'tool-output', id: call.call_id, content })
        });
      } catch (error) {
        result = { success: false, content: errorMessage(error) };
      }
      send({ type: 'tool-result', id: call.call_id, success: result.success, content: result.content.slice(0, 4000), diff: result.diff });
      input = [{ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) }];
    }
    throw new Error('The agent exceeded its 30-turn limit.');
  } catch (error) {
    send({ type: 'error', message: signal.aborted ? 'Stopped' : errorMessage(error) });
  }
}
