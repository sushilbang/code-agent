import type { AgentTool } from './types';

export const subagentTools: AgentTool[] = [{
  definition: {
    type: 'function',
    name: 'delegate_investigations',
    description: 'Run two or three independent repository investigations concurrently in isolated read-only contexts, then return their findings for synthesis. Use only when parallel research materially helps; sub-agents cannot edit files or run commands.',
    strict: false,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two or three focused, independent investigation questions. Each must be answerable by reading this repository.'
        }
      },
      required: ['tasks']
    }
  },
  path: () => '.',
  describe: arguments_ => `Running ${Array.isArray(arguments_.tasks) ? arguments_.tasks.length : 0} read-only investigations`,
  async execute(context, arguments_) {
    const tasks = arguments_.tasks;
    if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 3 ||
      tasks.some(task => typeof task !== 'string' || !task.trim() || task.length > 500)) {
      throw new Error('Provide two or three investigation tasks, each between 1 and 500 characters.');
    }
    if (!context.runInvestigations) throw new Error('Sub-agent investigations are unavailable in this context.');
    return { success: true, content: await context.runInvestigations(tasks.map(task => task.trim())) };
  }
}];
