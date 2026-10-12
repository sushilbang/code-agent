import type { AgentFileChange, AgentPathChange } from '../../workspace';
import type { OpenAIToolDefinition } from '../providers/openai';
import type { SubAgentActivity, SubAgentBudgetUsage } from '../../../shared/types';

export interface ToolResult { success: boolean; content: string; diff?: string }
export type ApprovalTarget = AgentFileChange | AgentPathChange | { path: string; before: string | null; after: string; details: string };
export type ApproveAgentChange = (change: ApprovalTarget, tool: string, signal: AbortSignal, allowAlways?: boolean) => Promise<boolean>;

export interface ToolContext {
  root: string;
  signal: AbortSignal;
  approveWrite: ApproveAgentChange;
  fileChanged(path: string, deleted?: boolean, directory?: boolean): void;
  toolOutput(content: string): void;
  runInvestigations?(tasks: string[], onActivity: (activity: SubAgentActivity) => void, onBudget: (usage: SubAgentBudgetUsage) => void): Promise<string>;
  subagentActivity?(activity: SubAgentActivity): void;
  subagentBudget?(usage: SubAgentBudgetUsage): void;
}

export interface AgentTool {
  definition: OpenAIToolDefinition;
  path(arguments_: Record<string, unknown>): string;
  describe(arguments_: Record<string, unknown>): string;
  execute(context: ToolContext, arguments_: Record<string, unknown>): Promise<ToolResult>;
}
