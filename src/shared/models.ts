export const OPENAI_MODELS = ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4'] as const;
export type OpenAIModel = typeof OPENAI_MODELS[number];
export const DEFAULT_OPENAI_MODEL: OpenAIModel = OPENAI_MODELS[0];

export function isOpenAIModel(value: unknown): value is OpenAIModel {
  return typeof value === 'string' && (OPENAI_MODELS as readonly string[]).includes(value);
}
