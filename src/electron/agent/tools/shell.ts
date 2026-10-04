import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../workspace';
import type { AgentTool } from './types';

const maxOutput = 40_000;
const maxChunk = 4_000;

function commandLine(executable: string, args: string[]): string {
  const quote = (value: string) => /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  return [executable, ...args].map(quote).join(' ');
}

function riskFor(executable: string, args: string[]): string {
  const text = `${executable} ${args.join(' ')}`.toLowerCase();
  if (/\b(rm|rmdir|del|remove-item|format|shutdown|taskkill|git\s+(reset|clean|checkout))\b/.test(text)) return 'High risk: the command appears destructive.';
  if (/\b(npm|pnpm|yarn|pip|cargo)\s+(install|add|remove|update)|\bgit\s+(commit|push|merge|rebase)\b/.test(text)) return 'Medium risk: the command may modify the workspace or external state.';
  return 'Review required: commands run with the application user permissions.';
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.once('exit', code => { if (code !== 0) child.kill(); resolve(); });
      killer.once('error', () => { child.kill(); resolve(); });
    });
  } else child.kill('SIGKILL');
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

    return new Promise((resolve, reject) => {
      let output = '', truncated = false, timedOut = false, stopped = false, settled = false;
      const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: process.env });
      const append = (label: string, bytes: Buffer) => {
        if (output.length >= maxOutput) { truncated = true; return; }
        const text = bytes.toString('utf8');
        const remaining = maxOutput - output.length;
        const addition = `${label}${text.slice(0, remaining)}`;
        if (text.length > remaining) truncated = true;
        output += addition;
        context.toolOutput(addition.slice(0, maxChunk));
      };
      child.stdout.on('data', bytes => append('', bytes));
      child.stderr.on('data', bytes => append('[stderr] ', bytes));
      const finish = (result: { success: boolean; content: string }) => { if (!settled) { settled = true; cleanup(); resolve(result); } };
      const abort = () => { stopped = true; void terminate(child); };
      const timer = setTimeout(() => { timedOut = true; void terminate(child); }, timeout);
      const cleanup = () => { clearTimeout(timer); context.signal.removeEventListener('abort', abort); };
      context.signal.addEventListener('abort', abort, { once: true });
      child.once('error', error => { cleanup(); if (!settled) { settled = true; reject(error); } });
      child.once('close', code => {
        if (stopped) { finish({ success: false, content: 'Command stopped.' }); return; }
        const suffix = `${truncated ? '\n[output truncated]' : ''}\n[exit code: ${code ?? 'unknown'}${timedOut ? ', timed out' : ''}]`;
        finish({ success: code === 0 && !timedOut, content: `${output}${suffix}`.trim() });
      });
    });
  }
}];
