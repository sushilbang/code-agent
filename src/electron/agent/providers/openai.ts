import { readResponseStream, type OpenAITurnResult } from './openaiStream';
export { readResponseStream } from './openaiStream';

export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export interface ToolCall {
  call_id: string;
  name: string;
  arguments: string;
}

export interface OpenAITurnOptions {
  apiKey: string;
  model: string;
  instructions: string;
  tools: OpenAIToolDefinition[];
  input: unknown;
  previousResponseId?: string;
  compactThreshold: number;
  signal: AbortSignal;
  onText(text: string): void;
  onReasoning(text: string): void;
}

export async function requestOpenAITurn(options: OpenAITurnOptions): Promise<OpenAITurnResult> {
  const body: Record<string, unknown> = {
    model: options.model, instructions: options.instructions, tools: options.tools,
    parallel_tool_calls: false, stream: true, store: true,
    reasoning: { summary: 'auto' }, input: options.input,
    context_management: [{ type: 'compaction', compact_threshold: options.compactThreshold }]
  };
  if (options.previousResponseId) body.previous_response_id = options.previousResponseId;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: options.signal
  });
  if (!response.ok) {
    let message = `OpenAI request failed (${response.status}).`;
    try { message = (await response.json() as { error?: { message?: string } }).error?.message || message; } catch { /* Use HTTP status. */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error('OpenAI returned no response stream.');
  return readResponseStream(response.body, options.signal, options.onText, options.onReasoning);
}
