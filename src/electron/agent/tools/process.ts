import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ProcessResult {
  success: boolean;
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  stopped: boolean;
  truncated: boolean;
}

interface ProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutput?: number;
  onOutput?(content: string): void;
}

const defaultMaxOutput = 40_000;
const maxChunk = 4_000;

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

export function runBoundedProcess(options: ProcessOptions): Promise<ProcessResult> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let output = '', stdout = '', stderr = '', truncated = false, timedOut = false, stopped = false, settled = false;
    const maxOutput = options.maxOutput ?? defaultMaxOutput;
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd, shell: false, windowsHide: true, env: process.env
    });
    const append = (stream: 'stdout' | 'stderr', label: string, bytes: Buffer) => {
      if (output.length >= maxOutput) { truncated = true; return; }
      const text = bytes.toString('utf8');
      const remaining = maxOutput - output.length;
      const addition = `${label}${text.slice(0, remaining)}`;
      if (text.length > remaining) truncated = true;
      output += addition;
      if (stream === 'stdout') stdout += text.slice(0, remaining);
      else stderr += text.slice(0, remaining);
      options.onOutput?.(addition.slice(0, maxChunk));
    };
    child.stdout.on('data', bytes => append('stdout', '', bytes));
    child.stderr.on('data', bytes => append('stderr', '[stderr] ', bytes));
    const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); };
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true; cleanup();
      resolve({ success: exitCode === 0 && !timedOut && !stopped, output, stdout, stderr, exitCode, timedOut, stopped, truncated });
    };
    const abort = () => { stopped = true; void terminate(child); };
    const timer = setTimeout(() => { timedOut = true; void terminate(child); }, options.timeoutMs);
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.once('error', error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    child.once('close', finish);
  });
}

export function formatProcessResult(result: ProcessResult): string {
  if (result.stopped) return 'Command stopped.';
  const suffix = `${result.truncated ? '\n[output truncated]' : ''}\n[exit code: ${result.exitCode ?? 'unknown'}${result.timedOut ? ', timed out' : ''}]`;
  return `${result.output}${suffix}`.trim();
}
