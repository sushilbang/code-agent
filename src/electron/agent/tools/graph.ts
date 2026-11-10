import { buildCodeGraph } from '../../graph/build';
import { overviewText, pathText, queryText } from '../../graph/query';
import type { AgentTool } from './types';

const definition = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function' as const, name, description,
  parameters: { type: 'object', properties, required }, strict: false
});
const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${name} must be 1 to 500 characters.`);
  return value.trim();
};

const graphOverviewTool: AgentTool = {
  definition: definition('graph_overview', 'Summarize the codebase as a graph of TypeScript, JavaScript, and Python source: hub symbols, file communities, and cross-community couplings. Start here in an unfamiliar repository.', {}, []),
  path: () => '.',
  describe: () => 'Summarizing the code graph',
  async execute(context) {
    return { success: true, content: overviewText(await buildCodeGraph(context.root, context.signal)) };
  }
};

const graphQueryTool: AgentTool = {
  definition: definition('graph_query', 'Explore the code graph around a symbol, file, or concept: matches plus callers, callees, imports, and inheritance within a few hops, with file:line. Links are EXTRACTED (in source) or INFERRED (heuristic, scored).', {
    question: { type: 'string', description: 'Symbol names or a short question, such as "ToolRegistry prepare".' },
    depth: { type: 'integer', description: 'Hops to expand from matches, 1 to 3. Default 2.' },
    limit: { type: 'integer', description: 'Maximum nodes to return, 5 to 80. Default 30.' }
  }, ['question']),
  path: () => '.',
  describe: arguments_ => `Querying the code graph for ${String(arguments_.question)}`,
  async execute(context, arguments_) {
    const question = text(arguments_.question, 'question');
    const graph = await buildCodeGraph(context.root, context.signal);
    return { success: true, content: queryText(graph, question, typeof arguments_.depth === 'number' ? arguments_.depth : 2, typeof arguments_.limit === 'number' ? arguments_.limit : 30) };
  }
};

const graphPathTool: AgentTool = {
  definition: definition('graph_path', 'Find the shortest chain of imports, calls, inheritance, or usage between two symbols or files.', {
    from: { type: 'string', description: 'Starting symbol or file name.' },
    to: { type: 'string', description: 'Target symbol or file name.' }
  }, ['from', 'to']),
  path: () => '.',
  describe: arguments_ => `Tracing graph path from ${String(arguments_.from)} to ${String(arguments_.to)}`,
  async execute(context, arguments_) {
    const from = text(arguments_.from, 'from'); const to = text(arguments_.to, 'to');
    return { success: true, content: pathText(await buildCodeGraph(context.root, context.signal), from, to) };
  }
};

export const graphTools: AgentTool[] = [graphOverviewTool, graphQueryTool, graphPathTool];
// Sub-agents pay for every tool schema on every request, so they only get the exploratory query.
export const readOnlyGraphTools: AgentTool[] = [graphQueryTool];
