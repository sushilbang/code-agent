// Deliberately high-confidence patterns. This is a guardrail, not general secret detection.
const credentialValue = /\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/i;
const privateKey = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i;
const assignedSecret = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password)\b\s*[:=]\s*["']?[^\s"']{8,}/i;

export function containsLikelySecret(value: string): boolean {
  return credentialValue.test(value) || privateKey.test(value) || assignedSecret.test(value);
}
