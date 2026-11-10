import type { KeyProvider, ReasoningEffort } from '../../../shared/models';
import { AnthropicSession } from './anthropic';
import { requestOpenAITurn, type OpenAIToolDefinition } from './openai';
import type { OpenAITurnResult } from './openaiStream';

// A provider-neutral view of one model turn so the agent loop does not depend on a wire format.
export type TurnInput =
  | { kind: 'user'; history: { role: 'user' | 'assistant'; content: string }[]; text: string }
  | { kind: 'tool-result'; call_id: string; success: boolean; output: string };
export type TurnResult = OpenAITurnResult;

export interface SessionOptions {
  apiKey: string;
  model: string;
  instructions: string;
  tools: OpenAIToolDefinition[];
  signal: AbortSignal;
  compactThreshold: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onText(text: string): void;
  onReasoning(text: string): void;
}

// A session owns the conversation state for one agent run (OpenAI: a response chain; Claude: the message list).
export interface ModelSession { send(input: TurnInput): Promise<TurnResult> }

class OpenAISession implements ModelSession {
  private previousResponseId: string | undefined;
  constructor(private readonly options: SessionOptions) {}

  async send(input: TurnInput): Promise<TurnResult> {
    const items = input.kind === 'user'
      ? [...input.history, { role: 'user', content: input.text }]
      : [{ type: 'function_call_output', call_id: input.call_id, output: input.output }];
    const result = await requestOpenAITurn({ ...this.options, input: items, previousResponseId: this.previousResponseId });
    this.previousResponseId = result.id;
    return result;
  }
}

export function createModelSession(provider: KeyProvider, options: SessionOptions): ModelSession {
  return provider === 'anthropic' ? new AnthropicSession(options) : new OpenAISession(options);
}
