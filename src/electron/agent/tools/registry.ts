import type { OpenAIToolDefinition } from '../providers/openai';
import type { AgentTool, ToolContext, ToolResult } from './types';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.definition.name)) throw new Error(`Duplicate tool: ${tool.definition.name}`);
      this.tools.set(tool.definition.name, tool);
    }
  }

  definitions(): OpenAIToolDefinition[] {
    return [...this.tools.values()].map(tool => tool.definition);
  }

  prepare(name: string, rawArguments: string): { path: string; description: string; execute(context: ToolContext): Promise<ToolResult> } {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const parsed: unknown = JSON.parse(rawArguments || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid tool arguments.');
    const arguments_ = parsed as Record<string, unknown>;
    validateArguments(tool.definition.parameters, arguments_);
    return { path: tool.path(arguments_), description: tool.describe(arguments_), execute: context => tool.execute(context, arguments_) };
  }
}

function validateArguments(schema: Record<string, unknown>, arguments_: Record<string, unknown>): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    if (typeof name === 'string' && arguments_[name] === undefined) throw new Error(`Missing required tool argument: ${name}`);
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return;
  for (const [name, value] of Object.entries(arguments_)) {
    const property = (properties as Record<string, unknown>)[name];
    if (!property || typeof property !== 'object' || Array.isArray(property)) continue;
    const expected = (property as { type?: unknown }).type;
    const valid = expected === 'string' ? typeof value === 'string'
      : expected === 'integer' ? typeof value === 'number' && Number.isInteger(value)
      : expected === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : expected === 'boolean' ? typeof value === 'boolean'
      : expected === 'array' ? Array.isArray(value) && value.every(item => typeof item === 'string')
      : true;
    if (!valid) throw new Error(`Invalid tool argument: ${name} must be ${String(expected)}.`);
  }
}
