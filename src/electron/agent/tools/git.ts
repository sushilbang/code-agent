import { stat } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../workspace';
import { runBoundedProcess, type ProcessResult } from './process';
import type { AgentTool } from './types';

const gitTimeout = 15_000;
const maxGitOutput = 40_000;
const maxStatusEntries = 500;

async function git(root: string, args: string[], signal: AbortSignal): Promise<ProcessResult> {
  try {
    return await runBoundedProcess({ executable: 'git', args: ['--no-pager', ...args], cwd: root, signal, timeoutMs: gitTimeout, maxOutput: maxGitOutput });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('Git executable was not found. Install Git and ensure it is available on PATH.');
    throw error;
  }
}

function gitFailure(result: ProcessResult): never {
  if (result.stopped) throw new Error('Git inspection stopped.');
  if (result.timedOut) throw new Error('Git inspection timed out.');
  if (/not a git repository/iu.test(result.stderr)) throw new Error('The workspace is not a Git repository.');
  throw new Error(result.stderr.trim() || result.output.trim() || `Git exited with code ${result.exitCode ?? 'unknown'}.`);
}

function parseStatus(output: string): string {
  const records = output.split('\0').filter(Boolean);
  let branch = '';
  if (records[0]?.startsWith('## ')) {
    const [branchRecord, ...firstEntry] = records[0].split(/\r?\n/u);
    branch = branchRecord.slice(3);
    records.shift();
    if (firstEntry.length && firstEntry.join('\n')) records.unshift(firstEntry.join('\n'));
  }
  const entries: Array<{ status: string; path: string; originalPath?: string }> = [];
  let index = 0;
  for (; index < records.length && entries.length < maxStatusEntries; index++) {
    const record = records[index];
    const status = record.slice(0, 2);
    const entry: { status: string; path: string; originalPath?: string } = { status, path: record.slice(3) };
    if (/[RC]/u.test(status) && records[index + 1]) entry.originalPath = records[++index];
    entries.push(entry);
  }
  return JSON.stringify({ branch: branch || '(detached or unknown)', clean: entries.length === 0, entries, truncated: index < records.length }, null, 2);
}

const gitStatusTool: AgentTool = {
  definition: {
    type: 'function', name: 'git_status', strict: false,
    description: 'Inspect the current Git branch and working-tree status without changing the repository. Returns bounded structured JSON.',
    parameters: { type: 'object', properties: {} }
  },
  path: () => '.',
  describe: () => 'Inspecting Git status',
  async execute(context) {
    const root = await resolveWorkspacePath(context.root, '.');
    const result = await git(root, ['status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'], context.signal);
    if (!result.success) gitFailure(result);
    return { success: true, content: parseStatus(result.stdout) };
  }
};

const gitDiffTool: AgentTool = {
  definition: {
    type: 'function', name: 'git_diff', strict: false,
    description: 'Read a bounded, no-color Git diff without changing the repository. Can inspect unstaged or staged changes and optionally limit the diff to an existing workspace path.',
    parameters: { type: 'object', properties: {
      staged: { type: 'boolean', description: 'When true, inspect staged changes; otherwise inspect unstaged changes.' },
      path: { type: 'string', description: 'Optional existing workspace-relative file or folder to limit the diff.' }
    } }
  },
  path: arguments_ => typeof arguments_.path === 'string' ? arguments_.path : '.',
  describe: arguments_ => `Inspecting ${arguments_.staged === true ? 'staged' : 'unstaged'} Git diff`,
  async execute(context, arguments_) {
    const root = await resolveWorkspacePath(context.root, '.');
    const relativePath = typeof arguments_.path === 'string' && arguments_.path ? arguments_.path : undefined;
    if (relativePath) {
      const resolved = await resolveWorkspacePath(context.root, relativePath);
      await stat(resolved);
    }
    const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3'];
    if (arguments_.staged === true) args.push('--cached');
    if (relativePath) args.push('--', relativePath);
    const result = await git(root, args, context.signal);
    if (!result.success) gitFailure(result);
    const suffix = result.truncated ? '\n[diff truncated]' : '';
    return { success: true, content: result.stdout ? `${result.stdout}${suffix}` : 'No matching differences.' };
  }
};

export const gitInspectionTools: AgentTool[] = [gitStatusTool, gitDiffTool];
