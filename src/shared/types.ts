export interface FileNode {
  name: string;
  path: string;
  directory: boolean;
  children?: FileNode[];
}

export interface WorkspaceSnapshot {
  root: string;
  name: string;
  nodes: FileNode[];
  fileCount: number;
  truncated: boolean;
}

export interface FilePreview {
  path: string;
  content: string;
  size: number;
  lines: number;
}

export interface AgentApprovalRequest {
  id: string;
  runId: string;
  tool: string;
  path: string;
  before: string | null;
  after: string;
  diff?: string;
  details?: string;
  allowAlways?: boolean;
}

export type ApprovalDecision = 'once' | 'always' | 'deny';
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  tools?: { id: string; name: string; path: string; description: string; success?: boolean; content?: string; diff?: string }[];
  error?: boolean;
  retrieved?: RetrievedSource[];
  memoriesUsed?: { id: string; topic: string }[];
}
export interface ProjectMemory {
  id: string;
  workspaceRoot: string;
  topic: string;
  value: string;
  source: { kind: 'user' | 'file'; reference?: string };
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
}
export type ProjectMemoryInput = Pick<ProjectMemory, 'topic' | 'value' | 'source' | 'enabled'> & { id?: string };
export interface RetrievedSource {
  path: string;
  startLine: number;
  endLine: number;
  reason: 'selected' | 'path' | 'content';
}
export interface ChatRecord {
  id: string;
  title: string;
  workspaceRoot: string;
  updatedAt: string;
  messages: ChatMessage[];
  contextUsage?: ContextUsage;
  contextCheckpoints?: ContextCheckpoint[];
}
export interface ChatSummary { id: string; title: string; workspaceRoot: string; updatedAt: string }

export interface ContextSettings {
  workingBudgetTokens: number;
  warningPercent: number;
  compactionPercent: number;
}

export interface ContextUsage {
  inputTokens: number;
  outputTokens?: number;
  source: 'estimate' | 'api';
}

export interface ContextCheckpoint {
  at: string;
  recentRequests: string[];
  selectedFile?: string;
  toolPaths: string[];
}

export type AgentEvent =
  | { runId: string; type: 'delta'; text: string }
  | { runId: string; type: 'reasoning'; text: string }
  | { runId: string; type: 'tool-start'; id: string; name: string; path: string; description: string }
  | { runId: string; type: 'tool-result'; id: string; success: boolean; content: string; diff?: string }
  | { runId: string; type: 'tool-output'; id: string; content: string }
  | { runId: string; type: 'context-usage'; usage: ContextUsage }
  | { runId: string; type: 'context-compacted'; checkpoint: ContextCheckpoint }
  | { runId: string; type: 'context-files'; sources: RetrievedSource[] }
  | { runId: string; type: 'context-memory'; items: { id: string; topic: string }[] }
  | { runId: string; type: 'file-changed'; path: string; deleted?: boolean; directory?: boolean }
  | { runId: string; type: 'done' }
  | { runId: string; type: 'error'; message: string };

export interface AgentRequest {
  runId: string;
  prompt: string;
  provider: 'local' | 'openai';
  model: string;
  selectedFile?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface DesktopApi {
  openWorkspace(): Promise<WorkspaceSnapshot | null>;
  refreshWorkspace(): Promise<WorkspaceSnapshot>;
  readFile(path: string): Promise<FilePreview>;
  saveFile(path: string, content: string, expectedContent: string): Promise<FilePreview>;
  createEntry(path: string, directory: boolean): Promise<WorkspaceSnapshot>;
  deleteEntry(path: string, directory: boolean): Promise<WorkspaceSnapshot | null>;
  confirmDiscard(): Promise<boolean>;
  reportDirty(paths: string[]): Promise<void>;
  startAgent(request: AgentRequest): Promise<void>;
  stopAgent(runId: string): Promise<void>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onApprovalRequest(listener: (request: AgentApprovalRequest) => void): () => void;
  respondApproval(id: string, decision: ApprovalDecision): Promise<void>;
  listAllowedActions(): Promise<string[]>;
  revokeAllowedAction(tool: string): Promise<string[]>;
  listChats(): Promise<ChatSummary[]>;
  getChat(id: string): Promise<ChatRecord | null>;
  saveChat(chat: ChatRecord): Promise<void>;
  deleteChat(id: string): Promise<void>;
  listProjectMemories(): Promise<ProjectMemory[]>;
  saveProjectMemory(input: ProjectMemoryInput): Promise<ProjectMemory[]>;
  deleteProjectMemory(id: string): Promise<ProjectMemory[] | null>;
  onMenuCommand(listener: (command: string) => void): () => void;
  getEnvironment(): Promise<{ hasOpenAIKey: boolean; keySource: 'saved' | 'environment' | 'none'; defaultModel: string }>;
  saveOpenAIKey(key: string): Promise<{ hasOpenAIKey: boolean; keySource: 'saved' }>;
  deleteOpenAIKey(): Promise<{ hasOpenAIKey: boolean; keySource: 'environment' | 'none' }>;
  getContextSettings(): Promise<ContextSettings>;
  saveContextSettings(settings: ContextSettings): Promise<ContextSettings>;
}
