import type { AgentEvent, AgentRequest } from '../shared/types';
import { applyAgentChange, applyAgentPathChange, listFiles, planAgentCreateDirectory, planAgentDelete, planAgentReplacement, planAgentWrite, readAgentFile, type AgentFileChange, type AgentPathChange } from './workspace';
import { buildActionDiff } from './actionDiff';

type Emit = (event: AgentEvent) => void;
type ToolCall = { call_id: string; name: string; arguments: string };
type LocalEvent = AgentEvent extends infer E ? E extends AgentEvent ? Omit<E, 'runId'> : never : never;
export type ApproveAgentChange = (change: AgentFileChange | AgentPathChange, tool: string, signal: AbortSignal) => Promise<boolean>;

const instructions = `You are a coding agent in a user-selected workspace. Inspect relevant files before editing. Tool paths must be relative to the workspace. When asked to change code, use the available file tools instead of only suggesting code to paste. Mutating actions require user approval unless the user has allowed that action for this workspace. For write_file on an existing file, read it first and supply its exact prior contents in expected_content. Use replace_in_file for a focused change when possible. Use create_file for a new file and create_directory for a folder. Never delete files or folders unless the user's request clearly calls for it. Do not claim to have changed, built, or tested anything unless a tool result confirms it. Give a concise answer and state what remains to be done.`;
const tools = [
  { type: 'function', name: 'list_files', description: 'Recursively list files under a workspace-relative directory. Use path "." for the repository root. Skips Git metadata, dependencies, and build output. Results are limited to at most 2000 file paths. Use this to locate files before reading them.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory relative to the workspace, such as "." or "src".' }, limit: { type: 'integer', description: 'Maximum number of file paths to return, from 1 to 2000.' } } }, strict: false },
  { type: 'function', name: 'read_file', description: 'Read the UTF-8 contents of one file within the workspace. The path must be workspace-relative. Binary files and files larger than 100 KB cannot be read. Use this before discussing or editing a file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the workspace, such as "src/server.js".' } }, required: ['path'] }, strict: false },
  { type: 'function', name: 'write_file', description: 'Create a new UTF-8 text file or replace an existing one inside the workspace. The parent folder must exist and content is limited to 512 KB. Existing files require expected_content containing their exact text from a recent read_file call, so concurrent changes are not overwritten. User approval is required before writing.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path, such as "src/example.ts".' }, content: { type: 'string', description: 'Complete new file content.' }, expected_content: { type: 'string', description: 'Exact current file content for replacements; omit only when creating a new file.' } }, required: ['path', 'content'] }, strict: false },
  { type: 'function', name: 'replace_in_file', description: 'Replace one exact, unique text span in an existing workspace file. Read the file first and provide old_text exactly as it appears. The operation fails if the text is absent or occurs more than once, or if the file changes before approval. User approval is required unless this action is allowed for the workspace.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path.' }, old_text: { type: 'string', description: 'Exact text to replace; must occur once.' }, new_text: { type: 'string', description: 'Replacement text.' } }, required: ['path', 'old_text', 'new_text'] }, strict: false },
  { type: 'function', name: 'create_file', description: 'Create a new UTF-8 file with its complete contents. Fails if the file already exists. Parent folder must exist. Content limit is 512 KB. Requires approval unless this action is allowed for the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, strict: false },
  { type: 'function', name: 'create_directory', description: 'Create one new folder inside an existing parent folder. Fails if it already exists. Requires approval unless this action is allowed for the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, strict: false },
  { type: 'function', name: 'delete_file', description: 'Delete one regular file inside the workspace. It is rechecked after approval and rejected if changed. Do this only when explicitly requested. Requires approval unless this action is allowed for the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, strict: false },
  { type: 'function', name: 'delete_directory', description: 'Recursively delete a folder inside the workspace. Refuses Git metadata, linked paths, folders over 200 entries or 10 MB, and changed contents. Do this only when explicitly requested. Requires approval unless this action is allowed for the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, strict: false }
];

export async function runAgent(root: string, request: AgentRequest, signal: AbortSignal, emit: Emit, approveWrite: ApproveAgentChange = async () => false, apiKey?: string): Promise<void> {
  const send = (event: LocalEvent) => emit({ ...event, runId: request.runId } as AgentEvent);
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
      ? `Selected file: ${request.selectedFile}\n\n${request.prompt}`
      : request.prompt }];
    let previousResponseId: string | undefined;

    for (let turn = 0; turn < 30; turn++) {
      if (signal.aborted) throw new Error('Stopped');
      const body: Record<string, unknown> = {
        model: request.model.trim(), instructions, tools, parallel_tool_calls: false,
        stream: true, store: true, reasoning: { summary: 'auto' }, input
      };
      if (previousResponseId) body.previous_response_id = previousResponseId;
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) {
        let message = `OpenAI request failed (${response.status}).`;
        try { message = (await response.json() as { error?: { message?: string } }).error?.message || message; } catch { /* Use the HTTP status. */ }
        throw new Error(message);
      }
      if (!response.body) throw new Error('OpenAI returned no response stream.');
      const stream = await readResponseStream(response.body, signal,
        text => send({ type: 'delta', text }),
        text => send({ type: 'reasoning', text }));
      previousResponseId = stream.id;
      if (!stream.call) {
        if (!stream.hadText) throw new Error('OpenAI completed without text or a tool call.');
        send({ type: 'done' });
        return;
      }
      const call = stream.call;
      let result: { success: boolean; content: string; diff?: string };
      try {
        const args: unknown = JSON.parse(call.arguments || '{}');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments.');
        const values = args as Record<string, unknown>;
        const filePath = typeof values.path === 'string' ? values.path : '.';
        const description = call.name === 'list_files'
          ? `Listing files under ${filePath === '.' ? 'the repository root' : filePath}`
          : call.name === 'read_file' ? `Reading ${filePath}`
          : call.name === 'write_file' ? `Writing ${filePath}`
          : call.name === 'replace_in_file' ? `Editing ${filePath}`
          : call.name === 'create_file' ? `Creating file ${filePath}`
          : call.name === 'create_directory' ? `Creating folder ${filePath}`
          : call.name === 'delete_file' ? `Deleting file ${filePath}`
          : call.name === 'delete_directory' ? `Deleting folder ${filePath}` : `Calling ${call.name}`;
        send({ type: 'tool-start', id: call.call_id, name: call.name, path: filePath, description });
        if (call.name === 'list_files') {
          const limit = typeof values.limit === 'number' ? Math.max(1, Math.min(2000, Math.trunc(values.limit))) : 200;
          result = { success: true, content: (await listFiles(root, filePath, limit)).join('\n') };
        } else if (call.name === 'read_file') {
          if (typeof values.path !== 'string' || !values.path) throw new Error('A file path is required.');
          result = { success: true, content: await readAgentFile(root, values.path) };
        } else if (['write_file', 'replace_in_file', 'create_file', 'create_directory', 'delete_file', 'delete_directory'].includes(call.name)) {
          if (typeof values.path !== 'string' || !values.path) throw new Error('A file path is required.');
          const change = call.name === 'write_file' ? await planAgentWrite(root, values.path, values.content as string, values.expected_content as string | undefined)
            : call.name === 'replace_in_file' ? await planAgentReplacement(root, values.path, values.old_text as string, values.new_text as string)
            : call.name === 'create_file' ? await planAgentWrite(root, values.path, values.content as string)
            : call.name === 'create_directory' ? await planAgentCreateDirectory(root, values.path)
            : await planAgentDelete(root, values.path, call.name === 'delete_directory');
          if (call.name === 'create_file' && change.before !== null) throw new Error('The file already exists.');
          if (!await approveWrite(change, call.name, signal)) {
            result = { success: false, content: `${call.name} on ${values.path} was not approved.` };
          } else {
            signal.throwIfAborted();
            if ('operation' in change) {
              const pathChange = change as AgentPathChange;
              await applyAgentPathChange(root, pathChange);
              result = { success: true, content: `${pathChange.operation} ${values.path}.`, diff: buildActionDiff(pathChange) };
              send({ type: 'file-changed', path: values.path, deleted: pathChange.operation.startsWith('delete'), directory: pathChange.operation !== 'delete_file' });
            } else {
              const saved = await applyAgentChange(root, change);
              result = { success: true, content: `${change.before === null ? 'Created' : 'Updated'} ${values.path} (${saved.lines} lines, ${saved.size} bytes).`, diff: buildActionDiff(change) };
              send({ type: 'file-changed', path: values.path });
            }
          }
        } else {
          result = { success: false, content: `Unknown tool: ${call.name}` };
        }
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

async function readResponseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onText: (text: string) => void, onReasoning: (text: string) => void): Promise<{ id: string; call?: ToolCall; hadText: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let id = '';
  let call: ToolCall | undefined;
  let hadText = false;
  let hadReasoning = false;
  let completed = false;
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data) as Record<string, any>;
    if (event.type === 'response.created' || event.type === 'response.completed') id = event.response?.id || id;
    if (event.type === 'response.completed') completed = true;
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      if (typeof event.delta === 'string') { hadText = true; onText(event.delta); }
    }
    if (event.type === 'response.output_text.done' && !hadText && typeof event.text === 'string') {
      hadText = true; onText(event.text);
    }
    if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
      hadReasoning = true; onReasoning(event.delta);
    }
    if (event.type === 'response.reasoning_summary_text.done' && !hadReasoning && typeof event.text === 'string') {
      hadReasoning = true; onReasoning(event.text);
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      if (call) throw new Error('Multiple tool calls in one response are not supported.');
      call = event.item as ToolCall;
    }
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      throw new Error(event.message || event.error?.message || event.response?.error?.message || `OpenAI ${event.type}.`);
    }
  };
  try {
    while (true) {
      if (signal.aborted) throw new Error('Stopped');
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error('The OpenAI stream ended before completion.');
  if (!id) throw new Error('OpenAI did not return a response id.');
  return { id, call, hadText };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
