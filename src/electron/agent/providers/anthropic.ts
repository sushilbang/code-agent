import Anthropic from '@anthropic-ai/sdk';
import { supportsReasoning } from '../../../shared/models';
import type { ModelSession, SessionOptions, TurnInput, TurnResult } from './session';

const defaultMaxTokens = 16_000;
// Thinking tokens count toward max_tokens, so small caps (used for sub-agents) are raised to leave room for an answer.
const minimumMaxTokens = 4_000;
const fallbackBeta = 'server-side-fallback-2026-07-01';

type Message = Anthropic.Beta.BetaMessageParam;

// One Claude conversation. The Messages API is stateless, so the full history is resent each turn
// (prompt caching keeps that cheap) and the assistant's content blocks are appended unchanged.
export class AnthropicSession implements ModelSession {
  private readonly client: Anthropic;
  private readonly messages: Message[] = [];

  constructor(private readonly options: SessionOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async send(input: TurnInput): Promise<TurnResult> {
    const { options } = this;
    if (input.kind === 'user') {
      // The conversation must start with a user turn.
      const history = [...input.history];
      while (history[0]?.role === 'assistant') history.shift();
      for (const item of history) this.messages.push({ role: item.role, content: item.content });
      this.messages.push({ role: 'user', content: input.text });
    } else {
      this.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: input.call_id, content: input.output, is_error: !input.success }] });
    }

    const reasoning = supportsReasoning(options.model);
    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: options.model,
      max_tokens: options.maxOutputTokens ? Math.max(options.maxOutputTokens, minimumMaxTokens) : defaultMaxTokens,
      system: options.instructions,
      messages: this.messages,
      tools: options.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as Anthropic.Tool.InputSchema })),
      // One tool call per turn keeps the loop identical across providers.
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      cache_control: { type: 'ephemeral' },
      stream: true,
      ...(reasoning ? {
        thinking: { type: 'adaptive' as const, display: 'summarized' as const },
        ...(options.reasoningEffort ? { output_config: { effort: options.reasoningEffort } } : {})
      } : {}),
      // Retry on a substitute model if safety classifiers decline; ignored by models without fallbacks.
      ...(options.model !== 'claude-haiku-4-5' ? { betas: [fallbackBeta], fallbacks: 'default' as const } : {})
    };

    const stream = this.client.beta.messages.stream(params, { signal: options.signal });
    let hadText = false;
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') { hadText = true; options.onText(event.delta.text); }
      else if (event.delta.type === 'thinking_delta') options.onReasoning(event.delta.thinking);
    }
    const message = await stream.finalMessage();
    // Pass every block back as received (including thinking and fallback blocks) so later turns stay valid.
    this.messages.push({ role: 'assistant', content: message.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });

    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      throw new Error(`Claude declined this request${category ? ` (${category})` : ''}. Rephrase it or choose another model.`);
    }
    const calls = message.content.filter(block => block.type === 'tool_use');
    if (calls.length > 1) throw new Error('Multiple tool calls in one response are not supported.');
    if (message.stop_reason === 'max_tokens' && (calls.length || !hadText)) throw new Error('Claude reached its output limit before finishing. Try a narrower request.');
    const usage = {
      inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens || 0) + (message.usage.cache_read_input_tokens || 0),
      outputTokens: message.usage.output_tokens
    };
    const [call] = calls;
    return {
      id: message.id, hadText, compacted: false, usage,
      call: call ? { call_id: call.id, name: call.name, arguments: JSON.stringify(call.input ?? {}) } : undefined
    };
  }
}
