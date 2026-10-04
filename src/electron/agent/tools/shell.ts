import { stat } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../workspace';
import { formatProcessResult, runBoundedProcess } from './process';
import type { AgentTool } from './types';

export function commandLine(executable: string, args: string[]): string {
  const quote = (value: string) => /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  return [executable, ...args].map(quote).join(' ');
}

function riskFor(executable: string, args: string[]): string {
  const text = `${executable} ${args.join(' ')}`.toLowerCase();
  if (/\b(rm|rmdir|del|remove-item|format|shutdown|taskkill|git\s+(reset|clean|checkout))\b/.test(text)) return 'High risk: the command appears destructive.';
  if (/\b(npm|pnpm|yarn|pip|cargo)\s+(install|add|remove|update)|\bgit\s+(commit|push|merge|rebase)\b/.test(text)) return 'Medium risk: the command may modify the workspace or external state.';
  return 'Review required: commands run with the application user permissions.';
}

export const shellTools: AgentTool[] = [{
  definition: {
    type: 'function', name: 'run_command', strict: false,
    description: 'Run one executable directly inside the workspace without a shell. Pass arguments separately. Requires approval every time. Output, duration, and working directory are bounded.',
    parameters: { type: 'object', properties: {
      executable: { type: 'string', description: 'Executable name, such as npm.cmd, node, git, or rg.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Separate argument strings. Shell operators and expansion are not interpreted.' },
      cwd: { type: 'string', description: 'Workspace-relative working directory; defaults to the root.' },
      timeout_ms: { type: 'integer', description: 'Timeout from 1000 to 120000 milliseconds; defaults to 30000.' }
    }, required: ['executable', 'args'] }
  },
  path: arguments_ => typeof arguments_.cwd === 'string' ? arguments_.cwd : '.',
  describe: arguments_ => `Running ${String(arguments_.executable)}`,
  async execute(context, arguments_) {
    const executable = arguments_.executable as string;
    const args = arguments_.args as string[];
    if (!executable || executable.length > 260 || executable.includes('\0') || /[\\/]/.test(executable)) throw new Error('Use an executable name without a path.');
    if (args.length > 100 || args.some(value => value.length > 4000 || value.includes('\0'))) throw new Error('Command arguments exceed the safety limits.');
    const relativeCwd = typeof arguments_.cwd === 'string' && arguments_.cwd ? arguments_.cwd : '.';
    const cwd = await resolveWorkspacePath(context.root, relativeCwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Command working directory is not a folder.');
    const timeout = typeof arguments_.timeout_ms === 'number' ? Math.max(1000, Math.min(120_000, arguments_.timeout_ms)) : 30_000;
    const display = commandLine(executable, args);
    const approved = await context.approveWrite({ path: relativeCwd, before: null, after: display, details: `${riskFor(executable, args)}\nWorking directory: ${relativeCwd}\nTimeout: ${timeout} ms` }, 'run_command', context.signal, false);
    if (!approved) return { success: false, content: 'Command was not approved.' };
    context.signal.throwIfAborted();

    const result = await runBoundedProcess({
      executable, args, cwd, signal: context.signal, timeoutMs: timeout,
      onOutput: content => context.toolOutput(content)
    });
    return { success: result.success, content: formatProcessResult(result) };
  }
}];
