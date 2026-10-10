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
  signal: AbortSignal;
  onText(text: string): void;
  onReasoning(text: string): void;
}

export interface OpenAITurnResult { id: string; call?: ToolCall; hadText: boolean; usage?: { inputTokens: number; outputTokens: number } }

export async function requestOpenAITurn(options: OpenAITurnOptions): Promise<OpenAITurnResult> {
  const body: Record<string, unknown> = {
    model: options.model, instructions: options.instructions, tools: options.tools,
    parallel_tool_calls: false, stream: true, store: true,
    reasoning: { summary: 'auto' }, input: options.input
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

export async function readResponseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onText: (text: string) => void, onReasoning: (text: string) => void): Promise<OpenAITurnResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', id = '';
  let call: ToolCall | undefined;
  let hadText = false, hadReasoning = false, completed = false;
  let usage: OpenAITurnResult['usage'];
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data) as Record<string, any>;
    if (event.type === 'response.created' || event.type === 'response.completed') id = event.response?.id || id;
    if (event.type === 'response.completed') {
      completed = true;
      const reported = event.response?.usage;
      if (Number.isSafeInteger(reported?.input_tokens) && reported.input_tokens >= 0 &&
        Number.isSafeInteger(reported?.output_tokens) && reported.output_tokens >= 0) {
        usage = { inputTokens: reported.input_tokens, outputTokens: reported.output_tokens };
      }
    }
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      if (typeof event.delta === 'string') { hadText = true; onText(event.delta); }
    }
    if (event.type === 'response.output_text.done' && !hadText && typeof event.text === 'string') { hadText = true; onText(event.text); }
    if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') { hadReasoning = true; onReasoning(event.delta); }
    if (event.type === 'response.reasoning_summary_text.done' && !hadReasoning && typeof event.text === 'string') { hadReasoning = true; onReasoning(event.text); }
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
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('The OpenAI stream ended before completion.');
  if (!id) throw new Error('OpenAI did not return a response id.');
  return { id, call, hadText, usage };
}
