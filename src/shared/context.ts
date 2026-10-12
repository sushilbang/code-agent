import type { ContextSettings, ContextUsage } from './types';

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  workingBudgetTokens: 120_000,
  warningPercent: 70,
  compactionPercent: 90,
  subAgentBudgetTokens: 20_000
};

export function isContextSettings(value: unknown): value is ContextSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.workingBudgetTokens === 'number' && Number.isInteger(settings.workingBudgetTokens) && settings.workingBudgetTokens >= 16_000 && settings.workingBudgetTokens <= 500_000 &&
    typeof settings.warningPercent === 'number' && Number.isInteger(settings.warningPercent) && settings.warningPercent >= 50 && settings.warningPercent <= 90 &&
    typeof settings.compactionPercent === 'number' && Number.isInteger(settings.compactionPercent) && settings.compactionPercent >= settings.warningPercent + 5 && settings.compactionPercent <= 99 &&
    typeof settings.subAgentBudgetTokens === 'number' && Number.isInteger(settings.subAgentBudgetTokens) && settings.subAgentBudgetTokens >= 4_000 && settings.subAgentBudgetTokens <= 200_000;
}

export function restoreContextSettings(value: unknown): ContextSettings {
  if (isContextSettings(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && !('subAgentBudgetTokens' in value) &&
    isContextSettings({ ...value, subAgentBudgetTokens: DEFAULT_CONTEXT_SETTINGS.subAgentBudgetTokens })) {
    return { ...value, subAgentBudgetTokens: DEFAULT_CONTEXT_SETTINGS.subAgentBudgetTokens } as ContextSettings;
  }
  return { ...DEFAULT_CONTEXT_SETTINGS };
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

export function estimateRequestTokens(input: unknown, instructions: string, tools: unknown): number {
  // A local approximation only: provider framing, cached state, and model tokenization can differ.
  const serialized = JSON.stringify({ input, instructions, tools });
  return estimateTextTokens(serialized) + 16;
}

export function contextLevel(usage: ContextUsage, settings: ContextSettings): 'normal' | 'warning' | 'compaction-target' {
  const percent = usage.inputTokens / settings.workingBudgetTokens * 100;
  return percent >= settings.compactionPercent ? 'compaction-target' : percent >= settings.warningPercent ? 'warning' : 'normal';
}

export function compactionThreshold(settings: ContextSettings): number {
  return Math.floor(settings.workingBudgetTokens * settings.compactionPercent / 100);
}
