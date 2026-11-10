export type KeyProvider = 'anthropic' | 'openai';
export type AgentProvider = 'local' | KeyProvider;
export type ModelTier = 'efficient' | 'standard' | 'latest';
export interface ModelInfo { id: string; label: string; provider: KeyProvider; tier: ModelTier; reasoning: boolean; description: string }

export const KEY_PROVIDERS: readonly KeyProvider[] = ['anthropic', 'openai'];
export const PROVIDER_LABELS: Record<AgentProvider, string> = { local: 'Local inspection', anthropic: 'Claude (Anthropic)', openai: 'OpenAI' };
export const KEY_PLACEHOLDERS: Record<KeyProvider, string> = { anthropic: 'sk-ant-...', openai: 'sk-...' };
export const KEY_ENVIRONMENT_VARIABLES: Record<KeyProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };

// Ordered as shown in the picker. `reasoning: false` models reject reasoning/effort request options.
export const MODEL_CATALOG: readonly ModelInfo[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', tier: 'efficient', reasoning: true, description: 'Fastest and cheapest · $0.10 / $0.50 per MTok' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'efficient', reasoning: false, description: 'Small, no reasoning · $1 / $5 per MTok' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', tier: 'standard', reasoning: true, description: 'Everyday coding and agents · $2 / $10 per MTok' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', tier: 'standard', reasoning: true, description: 'Hard problems · $4 / $20 per MTok' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', provider: 'anthropic', tier: 'latest', reasoning: true, description: 'Most capable · $8 / $40 per MTok' },

  { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai', tier: 'efficient', reasoning: true, description: 'Best balance of cost and agent quality' },
  { id: 'gpt-5-nano', label: 'GPT-5 nano', provider: 'openai', tier: 'efficient', reasoning: true, description: 'Lowest cost, simple tasks' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'openai', tier: 'efficient', reasoning: false, description: 'Fast, no reasoning tokens' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', provider: 'openai', tier: 'efficient', reasoning: false, description: 'Fastest, no reasoning tokens' },
  { id: 'o4-mini', label: 'o4-mini', provider: 'openai', tier: 'efficient', reasoning: true, description: 'Compact reasoning model' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai', tier: 'standard', reasoning: true, description: 'Strong general coding model' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai', tier: 'standard', reasoning: false, description: 'Non-reasoning, large context' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', tier: 'standard', reasoning: true, description: 'Previous flagship' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai', tier: 'latest', reasoning: true, description: 'Latest generation' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai', tier: 'latest', reasoning: true, description: 'Latest generation' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', provider: 'openai', tier: 'latest', reasoning: true, description: 'Most capable, highest cost' }
];

export const TIER_LABELS: Record<ModelTier, string> = { efficient: 'Efficient · fewer tokens', standard: 'Standard', latest: 'Latest · most capable' };
export const OPENAI_MODELS: readonly string[] = MODEL_CATALOG.filter(model => model.provider === 'openai').map(model => model.id);
export const ANTHROPIC_MODELS: readonly string[] = MODEL_CATALOG.filter(model => model.provider === 'anthropic').map(model => model.id);
export type OpenAIModel = string;

// Each provider defaults to its most token-efficient capable model; users can pick larger ones.
export const DEFAULT_MODELS: Record<KeyProvider, string> = { anthropic: 'claude-haiku-5-5', openai: 'gpt-5-mini' };
export const DEFAULT_ANTHROPIC_MODEL = DEFAULT_MODELS.anthropic;
export const DEFAULT_OPENAI_MODEL: OpenAIModel = DEFAULT_MODELS.openai;
// Claude's defaults are tuned per model; "medium" keeps agent loops accurate without long thinking.
export const DEFAULT_EFFORTS: Record<KeyProvider, ReasoningEffort> = { anthropic: 'medium', openai: 'low' };

export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = DEFAULT_EFFORTS.openai;

export const modelsFor = (provider: KeyProvider): readonly ModelInfo[] => MODEL_CATALOG.filter(model => model.provider === provider);
export const isModelFor = (provider: KeyProvider, value: unknown): value is string => typeof value === 'string' && modelsFor(provider).some(model => model.id === value);
export const providerForModel = (model: string): KeyProvider => MODEL_CATALOG.find(entry => entry.id === model)?.provider ?? 'openai';
export const isOpenAIModel = (value: unknown): value is OpenAIModel => isModelFor('openai', value);
export const isAnthropicModel = (value: unknown): value is string => isModelFor('anthropic', value);
export const isKeyProvider = (value: unknown): value is KeyProvider => value === 'anthropic' || value === 'openai';
export const isAgentProvider = (value: unknown): value is AgentProvider => value === 'local' || isKeyProvider(value);

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

// Unknown model ids keep the previous behavior of sending reasoning options.
export function supportsReasoning(model: string): boolean {
  return MODEL_CATALOG.find(entry => entry.id === model)?.reasoning ?? true;
}

// Anthropic keys start with sk-ant-; OpenAI keys start with sk- (including sk-proj-). Anything else is unknown.
export function detectKeyProvider(key: string): KeyProvider | null {
  const value = key.trim();
  if (value.startsWith('sk-ant-')) return 'anthropic';
  if (value.startsWith('sk-')) return 'openai';
  return null;
}
