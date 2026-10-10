import type { ToolCall } from './openai';

export interface OpenAITurnResult {
  id: string;
  call?: ToolCall;
  hadText: boolean;
  compacted: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function readResponseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onText: (text: string) => void, onReasoning: (text: string) => void): Promise<OpenAITurnResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', id = '';
  let call: ToolCall | undefined;
  let hadText = false, hadReasoning = false, completed = false, compacted = false;
  let usage: OpenAITurnResult['usage'];
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data) as Record<string, any>;
    if (event.type === 'response.created' || event.type === 'response.completed') id = event.response?.id || id;
    if (event.type === 'response.completed') {
      completed = true;
      compacted ||= Array.isArray(event.response?.output) && event.response.output.some((item: { type?: string }) => item.type === 'compaction');
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
    if (event.type === 'response.output_item.done' && event.item?.type === 'compaction') compacted = true;
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
  return { id, call, hadText, compacted, usage };
}
