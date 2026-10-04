import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath } from '../../workspace';
import { commandLine } from './shell';
import { formatProcessResult, runBoundedProcess } from './process';
import type { AgentTool } from './types';

const allowedScripts = new Set(['typecheck', 'check', 'lint', 'test', 'build']);
const maxPackageBytes = 100_000;

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}

async function packageCommand(directory: string): Promise<string> {
  if (await exists(path.join(directory, 'pnpm-lock.yaml'))) return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (await exists(path.join(directory, 'yarn.lock'))) return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function diagnosticSummary(script: string, content: string, success: boolean, exitCode: number | null): string {
  const issueCount = content.split(/\r?\n/u).filter(line => /\b(error|failed|failure)\b|✖/iu.test(line)).length;
  return [`Diagnostic script: ${script}`, `Status: ${success ? 'passed' : 'failed'}`, `Exit code: ${exitCode ?? 'unknown'}`, `Issue lines: ${issueCount}`, '', content].join('\n').trim();
}

export const diagnosticTools: AgentTool[] = [{
  definition: {
    type: 'function', name: 'run_diagnostics', strict: false,
    description: 'Run one existing package.json verification script selected from typecheck, check, lint, test, or build. Requires fresh approval and returns bounded output with a structured summary.',
    parameters: { type: 'object', properties: {
      script: { type: 'string', description: 'One of: typecheck, check, lint, test, or build.' },
      cwd: { type: 'string', description: 'Workspace-relative package directory; defaults to the workspace root.' },
      timeout_ms: { type: 'integer', description: 'Timeout from 1000 to 120000 milliseconds; defaults to 120000.' }
    }, required: ['script'] }
  },
  path: arguments_ => typeof arguments_.cwd === 'string' ? arguments_.cwd : '.',
  describe: arguments_ => `Running ${String(arguments_.script)} diagnostics`,
  async execute(context, arguments_) {
    const script = arguments_.script as string;
    if (!allowedScripts.has(script)) throw new Error('Choose a diagnostic script: typecheck, check, lint, test, or build.');
    const relativeCwd = typeof arguments_.cwd === 'string' && arguments_.cwd ? arguments_.cwd : '.';
    const cwd = await resolveWorkspacePath(context.root, relativeCwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Diagnostic working directory is not a folder.');
    const packagePath = path.join(cwd, 'package.json');
    const packageStat = await stat(packagePath).catch(() => null);
    if (!packageStat?.isFile()) throw new Error('No package.json exists in the selected diagnostic directory.');
    if (packageStat.size > maxPackageBytes) throw new Error('package.json exceeds the diagnostics safety limit.');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, unknown> };
    if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`package.json does not define a ${script} script.`);
    const packageManager = await packageCommand(cwd);
    const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : packageManager;
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', `${packageManager} run ${script}`] : ['run', script];
    const timeout = typeof arguments_.timeout_ms === 'number' ? Math.max(1000, Math.min(120_000, arguments_.timeout_ms)) : 120_000;
    const display = commandLine(packageManager, ['run', script]);
    const approved = await context.approveWrite({
      path: relativeCwd, before: null, after: display,
      details: `Project scripts can execute arbitrary code and may write generated files.\nWorking directory: ${relativeCwd}\nTimeout: ${timeout} ms`
    }, 'run_diagnostics', context.signal, false);
    if (!approved) return { success: false, content: 'Diagnostics were not approved.' };
    const result = await runBoundedProcess({
      executable, args, cwd, signal: context.signal, timeoutMs: timeout,
      onOutput: content => context.toolOutput(content)
    });
    const content = formatProcessResult(result);
    return { success: result.success, content: diagnosticSummary(script, content, result.success, result.exitCode) };
  }
}];
