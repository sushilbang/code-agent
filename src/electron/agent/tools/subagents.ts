import type { AgentTool } from './types';
import { normalizeInvestigationTasks } from '../subagents';

export const subagentTools: AgentTool[] = [{
  definition: {
    type: 'function',
    name: 'delegate_investigations',
    description: 'Run two or three bounded read-only repository investigations. Use tasks for independent parallel questions, or graph for named tasks with dependencies; completed prerequisite reports are passed to dependent tasks. Sub-agents cannot edit files or run commands.',
    strict: false,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two or three focused, independent investigation questions. Each must be answerable by reading this repository.'
        },
        graph: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, question: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } } }, required: ['id', 'question'] },
          description: 'Two or three named read-only investigations. dependsOn lists prerequisite task IDs; ready tasks run in parallel.'
        }
      },
      required: []
    }
  },
  path: () => '.',
  describe: arguments_ => `Running ${Array.isArray(arguments_.graph) ? arguments_.graph.length : Array.isArray(arguments_.tasks) ? arguments_.tasks.length : 0} read-only investigations`,
  async execute(context, arguments_) {
    const tasks = normalizeInvestigationTasks(arguments_.tasks, arguments_.graph);
    if (!context.runInvestigations) throw new Error('Sub-agent investigations are unavailable in this context.');
    return { success: true, content: await context.runInvestigations(tasks,
      activity => context.subagentActivity?.(activity), usage => context.subagentBudget?.(usage)) };
  }
}];
