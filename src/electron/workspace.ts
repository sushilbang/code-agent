import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FileNode, FilePreview, WorkspaceSnapshot } from '../shared/types';

const ignored = new Set(['.git', '.idea', '.vs', '.nuget', '.npm-cache', '.electron-cache', '.electron-data', '.chrome-qa', 'artifacts', 'bin', 'dist', 'dist-electron', 'node_modules', 'obj']);
const maxNodes = 5000;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function resolveWorkspacePath(root: string, relativePath: string): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Use a path relative to the workspace.');
  const absoluteRoot = await fs.realpath(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  if (!inside(absoluteRoot, candidate)) throw new Error('The requested path is outside the workspace.');
  const realCandidate = await fs.realpath(candidate);
  if (!inside(absoluteRoot, realCandidate)) throw new Error('Linked paths outside the workspace are not allowed.');
  return realCandidate;
}

export async function buildWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const absoluteRoot = await fs.realpath(root);
  const state = { nodes: 0, files: 0, truncated: false };
  async function children(directory: string): Promise<FileNode[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (state.nodes >= maxNodes) { state.truncated = true; break; }
      if (entry.isSymbolicLink() || (entry.isDirectory() && ignored.has(entry.name.toLowerCase()))) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(absoluteRoot, fullPath).split(path.sep).join('/');
      state.nodes++;
      if (entry.isFile()) state.files++;
      const node: FileNode = { name: entry.name, path: relative, directory: entry.isDirectory() };
      if (entry.isDirectory()) {
        try { node.children = await children(fullPath); }
        catch (error) {
          if (!isAccessError(error)) throw error;
          node.children = [];
        }
      }
      nodes.push(node);
    }
    return nodes;
  }
  return { root: absoluteRoot, name: path.basename(absoluteRoot) || absoluteRoot, nodes: await children(absoluteRoot), fileCount: state.files, truncated: state.truncated };
}

export async function readPreview(root: string, relativePath: string): Promise<FilePreview> {
  const resolved = await resolveWorkspacePath(root, relativePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('Select a file to preview.');
  if (stat.size > 512 * 1024) throw new Error('This file is too large to preview (512 KB limit).');
  const bytes = await fs.readFile(resolved);
  if (bytes.includes(0)) throw new Error('Binary files cannot be previewed.');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error('This file is not UTF-8 text.'); }
  return { path: relativePath, content, size: stat.size, lines: content ? content.split('\n').length : 0 };
}

export async function saveWorkspaceFile(root: string, relativePath: string, content: string, expectedContent: string): Promise<FilePreview> {
  if (typeof content !== 'string' || typeof expectedContent !== 'string') throw new Error('Invalid file content.');
  if (Buffer.byteLength(content, 'utf8') > 512 * 1024) throw new Error('This file exceeds the 512 KB editor limit.');
  const current = await readPreview(root, relativePath);
  if (current.content !== expectedContent) throw new Error('The file changed on disk. Reopen it before saving to avoid overwriting those changes.');
  const resolved = await resolveWorkspacePath(root, relativePath);
  await fs.writeFile(resolved, content, 'utf8');
  return readPreview(root, relativePath);
}

export async function createWorkspaceEntry(root: string, relativePath: string, directory: boolean): Promise<WorkspaceSnapshot> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Use a path relative to the workspace.');
  const name = path.basename(relativePath);
  if (!name || name === '.' || name === '..' || /[<>:"|?*]/.test(name)) throw new Error('Choose a valid file or folder name.');
  const parent = await resolveWorkspacePath(root, path.dirname(relativePath));
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('The parent folder does not exist.');
  const target = path.join(parent, name);
  if (directory) await fs.mkdir(target);
  else { const handle = await fs.open(target, 'wx'); await handle.close(); }
  return buildWorkspace(root);
}

export async function listFiles(root: string, relativePath = '.', limit = 200, signal?: AbortSignal): Promise<string[]> {
  const directory = await resolveWorkspacePath(root, relativePath);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Directory not found.');
  const result: string[] = [];
  const walk = async (current: string): Promise<void> => {
    signal?.throwIfAborted();
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (result.length >= limit) return;
      if (entry.isSymbolicLink() || (entry.isDirectory() && ignored.has(entry.name.toLowerCase()))) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isFile()) result.push(path.relative(root, fullPath).split(path.sep).join('/'));
      else if (entry.isDirectory()) await walk(fullPath);
    }
  };
  await walk(directory);
  return result;
}

export async function readAgentFile(root: string, relativePath: string): Promise<string> {
  const resolved = await resolveWorkspacePath(root, relativePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('File not found.');
  if (stat.size > 100_000) throw new Error('File is too large for the agent to read (100 KB limit).');
  const bytes = await fs.readFile(resolved);
  if (bytes.includes(0)) throw new Error('Binary files cannot be read.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export interface AgentFileChange {
  path: string;
  before: string | null;
  after: string;
}

export interface AgentPathChange extends AgentFileChange {
  operation: 'create_directory' | 'delete_file' | 'delete_directory';
  fingerprint?: string;
  details: string;
}

export async function planAgentWrite(root: string, relativePath: string, content: string, expectedContent?: string): Promise<AgentFileChange> {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 512 * 1024) {
    throw new Error('Agent write must be UTF-8 text no larger than 512 KB.');
  }
  const target = await resolveNewFileTarget(root, relativePath);
  const stat = await fs.lstat(target).catch(error => {
    if (isMissingError(error)) return null;
    throw error;
  });
  if (stat === null) {
    if (expectedContent !== undefined && expectedContent !== '') throw new Error('The file no longer exists.');
    return { path: relativePath, before: null, after: content };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Agent writes require a regular file.');
  if (typeof expectedContent !== 'string') throw new Error('Read the existing file and pass its exact contents as expected_content before writing.');
  const current = await readPreview(root, relativePath);
  if (current.content !== expectedContent) throw new Error('The file changed since it was read. Read it again before writing.');
  return { path: relativePath, before: current.content, after: content };
}

export async function planAgentReplacement(root: string, relativePath: string, oldText: string, newText: string): Promise<AgentFileChange> {
  if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') throw new Error('old_text and new_text are required.');
  const current = await readPreview(root, relativePath);
  const occurrences = current.content.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error(`old_text must match exactly once; found ${occurrences} matches.`);
  return planAgentWrite(root, relativePath, current.content.replace(oldText, newText), current.content);
}

export async function applyAgentChange(root: string, change: AgentFileChange): Promise<FilePreview> {
  const target = await resolveNewFileTarget(root, change.path);
  if (change.before === null) {
    const handle = await fs.open(target, 'wx');
    try { await handle.writeFile(change.after, 'utf8'); }
    finally { await handle.close(); }
    return readPreview(root, change.path);
  }
  return saveWorkspaceFile(root, change.path, change.after, change.before);
}

export async function planAgentCreateDirectory(root: string, relativePath: string): Promise<AgentPathChange> {
  const target = await resolveNewFileTarget(root, relativePath);
  if (await fs.lstat(target).then(() => true, error => { if (isMissingError(error)) return false; throw error; })) {
    throw new Error('The path already exists.');
  }
  return { operation: 'create_directory', path: relativePath, before: null, after: '', details: 'Create an empty folder.' };
}

async function deletionSnapshot(target: string, directory: boolean): Promise<{ fingerprint: string; details: string; before: string }> {
  const hash = createHash('sha256');
  const names: string[] = [];
  let count = 0;
  let bytes = 0;
  const walk = async (file: string, relative: string): Promise<void> => {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Deletion of linked paths is not allowed.');
    if (++count > 200) throw new Error('Folder has more than 200 entries; delete it manually.');
    if (stat.isDirectory()) {
      if (path.basename(file).toLowerCase() === '.git') throw new Error('Deleting Git metadata is not allowed.');
      hash.update(`D:${relative}\n`);
      for (const name of (await fs.readdir(file)).sort()) await walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 10 * 1024 * 1024) throw new Error('Deletion exceeds the 10 MB safety limit; delete it manually.');
      hash.update(`F:${relative}:${stat.size}\n`);
      hash.update(await fs.readFile(file));
      names.push(relative || path.basename(file));
    } else throw new Error('Only regular files and folders can be deleted.');
  };
  await walk(target, '');
  const before = directory ? names.slice(0, 40).join('\n') || '(empty folder)' :
    await readPreview(path.dirname(target), path.basename(target)).then(file => file.content, () => `(binary or large file, ${bytes} bytes)`);
  return { fingerprint: hash.digest('hex'), details: directory ? `${names.length} file(s), ${bytes} bytes. Contents shown below (first 40 files).` : `${bytes} bytes.`, before };
}

export async function planAgentDelete(root: string, relativePath: string, directory: boolean): Promise<AgentPathChange> {
  if (relativePath === '.' || relativePath === '..' || relativePath.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) {
    throw new Error('Deleting the workspace root or Git metadata is not allowed.');
  }
  const target = await resolveDeletionTarget(root, relativePath);
  const stat = await fs.lstat(target);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Expected a ${directory ? 'folder' : 'file'}.`);
  const snapshot = await deletionSnapshot(target, directory);
  return { operation: directory ? 'delete_directory' : 'delete_file', path: relativePath, after: '', ...snapshot };
}

export async function applyAgentPathChange(root: string, change: AgentPathChange): Promise<void> {
  if (change.operation === 'create_directory') {
    const target = await resolveNewFileTarget(root, change.path);
    await fs.mkdir(target);
    return;
  }
  const target = await resolveDeletionTarget(root, change.path);
  const current = await deletionSnapshot(target, change.operation === 'delete_directory');
  if (current.fingerprint !== change.fingerprint) throw new Error('The target changed since approval. Review it again before deleting.');
  if (change.operation === 'delete_directory') await fs.rm(target, { recursive: true });
  else await fs.unlink(target);
}

async function resolveDeletionTarget(root: string, relativePath: string): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Use a path relative to the workspace.');
  const absoluteRoot = await fs.realpath(root);
  const target = path.resolve(absoluteRoot, relativePath);
  if (target === absoluteRoot || !inside(absoluteRoot, target)) throw new Error('Deletion target must be inside the workspace.');
  let current = absoluteRoot;
  for (const part of path.relative(absoluteRoot, target).split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Deletion of linked paths is not allowed.');
  }
  return target;
}

async function resolveNewFileTarget(root: string, relativePath: string): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Use a path relative to the workspace.');
  const name = path.basename(relativePath);
  if (!name || name === '.' || name === '..' || /[<>:"|?*]/.test(name)) throw new Error('Choose a valid file name.');
  const parent = await resolveWorkspacePath(root, path.dirname(relativePath));
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('The parent folder does not exist.');
  return path.join(parent, name);
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAccessError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM');
}
