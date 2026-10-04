import { listFiles, readAgentFile } from '../../workspace';
import type { AgentTool } from './types';

const maxScanFiles = 2000;
const maxOutput = 50_000;
const timeoutMs = 5000;
const pathOf = (arguments_: Record<string, unknown>) => typeof arguments_.path === 'string' && arguments_.path ? arguments_.path : '.';
const definition = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function' as const, name, description,
  parameters: { type: 'object', properties, required }, strict: false
});

function boundedLimit(value: unknown): number {
  return typeof value === 'number' ? Math.max(1, Math.min(200, value)) : 100;
}

function globExpression(pattern: string): RegExp {
  if (!pattern || pattern.length > 300 || pattern.includes('\0') || pattern.split(/[\\/]/).includes('..') || /[{}[\]]/.test(pattern)) {
    throw new Error('Use a simple glob pattern up to 300 characters without traversal, braces, or character classes.');
  }
  const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  let source = '^';
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index++;
        source += normalized[index + 1] === '/' ? (index++, '(?:.*/)?') : '.*';
      } else source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else source += character.replace(/[.+^$()|]/g, '\\$&');
  }
  return new RegExp(`${source}$`, 'i');
}

function relativeToSearchPath(file: string, searchPath: string): string {
  const normalized = searchPath.replaceAll('\\', '/').replace(/^\.\/?/, '').replace(/\/$/, '');
  return normalized ? file.slice(normalized.length + 1) : file;
}

function withinLimits(started: number, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() - started > timeoutMs) throw new Error(`Search exceeded the ${timeoutMs / 1000}-second limit.`);
}

const globFilesTool: AgentTool = {
  definition: definition('glob_files', 'Find workspace files by a bounded glob pattern. Supports *, **, and ?. Generated folders, dependencies, symlinks, and build output are skipped.', {
    pattern: { type: 'string', description: 'Pattern such as **/*.ts or src/*.tsx.' },
    path: { type: 'string', description: 'Optional workspace-relative directory to search.' },
    limit: { type: 'integer', description: 'Maximum results from 1 to 200.' }
  }, ['pattern']),
  path: pathOf,
  describe: arguments_ => `Finding files matching ${String(arguments_.pattern)}`,
  async execute(context, arguments_) {
    const started = Date.now();
    const pattern = globExpression(arguments_.pattern as string);
    const searchPath = pathOf(arguments_);
    const limit = boundedLimit(arguments_.limit);
    const files = await listFiles(context.root, searchPath, maxScanFiles, context.signal);
    const matches: string[] = [];
    for (const file of files) {
      withinLimits(started, context.signal);
      if (pattern.test(relativeToSearchPath(file, searchPath))) {
        matches.push(file);
        if (matches.length >= limit) break;
      }
    }
    return { success: true, content: matches.join('\n') || 'No matching files.' };
  }
};

const searchTextTool: AgentTool = {
  definition: definition('search_text', 'Search UTF-8 workspace files for literal text. Results include file, line, and a bounded preview. Binary, large, generated, dependency, linked, and build-output files are skipped.', {
    query: { type: 'string', description: 'Literal text to find.' },
    path: { type: 'string', description: 'Optional workspace-relative directory to search.' },
    glob: { type: 'string', description: 'Optional file filter such as **/*.ts.' },
    case_sensitive: { type: 'boolean', description: 'Whether matching is case-sensitive.' },
    limit: { type: 'integer', description: 'Maximum matches from 1 to 200.' }
  }, ['query']),
  path: pathOf,
  describe: arguments_ => `Searching for ${String(arguments_.query)}`,
  async execute(context, arguments_) {
    const query = arguments_.query as string;
    if (!query || query.length > 1000 || query.includes('\0')) throw new Error('Search text must be between 1 and 1000 characters.');
    const started = Date.now();
    const searchPath = pathOf(arguments_);
    const filePattern = typeof arguments_.glob === 'string' ? globExpression(arguments_.glob) : null;
    const needle = arguments_.case_sensitive ? query : query.toLocaleLowerCase();
    const limit = boundedLimit(arguments_.limit);
    const files = await listFiles(context.root, searchPath, maxScanFiles, context.signal);
    const matches: string[] = [];
    let outputLength = 0;
    for (const file of files) {
      withinLimits(started, context.signal);
      if (filePattern && !filePattern.test(relativeToSearchPath(file, searchPath))) continue;
      let content: string;
      try { content = await readAgentFile(context.root, file); }
      catch { continue; }
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index++) {
        withinLimits(started, context.signal);
        const haystack = arguments_.case_sensitive ? lines[index] : lines[index].toLocaleLowerCase();
        if (!haystack.includes(needle)) continue;
        const entry = `${file}:${index + 1}: ${lines[index].trim().slice(0, 500)}`;
        if (outputLength + entry.length + 1 > maxOutput) return { success: true, content: `${matches.join('\n')}\n[output truncated]` };
        matches.push(entry); outputLength += entry.length + 1;
        if (matches.length >= limit) return { success: true, content: matches.join('\n') };
      }
    }
    return { success: true, content: matches.join('\n') || 'No matches.' };
  }
};

export const workspaceSearchTools: AgentTool[] = [globFilesTool, searchTextTool];
