import { buildActionDiff } from '../../actionDiff';
import {
  applyAgentChange, applyAgentPathChange, listFiles, planAgentCreateDirectory,
  planAgentDelete, planAgentReplacement, planAgentWrite, readAgentFile,
  type AgentFileChange, type AgentPathChange
} from '../../workspace';
import type { AgentTool, ToolContext, ToolResult } from './types';

const pathOf = (arguments_: Record<string, unknown>) => typeof arguments_.path === 'string' ? arguments_.path : '.';
const requiredPath = (arguments_: Record<string, unknown>) => {
  if (typeof arguments_.path !== 'string' || !arguments_.path) throw new Error('A file path is required.');
  return arguments_.path;
};
const definition = (name: string, description: string, properties: Record<string, unknown>, required?: string[]) => ({
  type: 'function' as const, name, description,
  parameters: { type: 'object', properties, ...(required ? { required } : {}) }, strict: false
});

async function applyMutation(context: ToolContext, tool: string, change: AgentFileChange | AgentPathChange): Promise<ToolResult> {
  if (!await context.approveWrite(change, tool, context.signal)) return { success: false, content: `${tool} on ${change.path} was not approved.` };
  context.signal.throwIfAborted();
  if ('operation' in change) {
    await applyAgentPathChange(context.root, change);
    context.fileChanged(change.path, change.operation.startsWith('delete'), change.operation !== 'delete_file');
    return { success: true, content: `${change.operation} ${change.path}.`, diff: buildActionDiff(change) };
  }
  const saved = await applyAgentChange(context.root, change);
  context.fileChanged(change.path);
  return { success: true, content: `${change.before === null ? 'Created' : 'Updated'} ${change.path} (${saved.lines} lines, ${saved.size} bytes).`, diff: buildActionDiff(change) };
}

const listFilesTool: AgentTool = {
  definition: definition('list_files', 'Recursively list files under a workspace-relative directory. Use path "." for the repository root. Skips Git metadata, dependencies, and build output. Results are limited to at most 2000 file paths. Use this to locate files before reading them.', {
    path: { type: 'string', description: 'Directory relative to the workspace, such as "." or "src".' },
    limit: { type: 'integer', description: 'Maximum number of file paths to return, from 1 to 2000.' }
  }),
  path: pathOf,
  describe: arguments_ => `Listing files under ${pathOf(arguments_) === '.' ? 'the repository root' : pathOf(arguments_)}`,
  async execute(context, arguments_) {
    const limit = typeof arguments_.limit === 'number' ? Math.max(1, Math.min(2000, Math.trunc(arguments_.limit))) : 200;
    return { success: true, content: (await listFiles(context.root, pathOf(arguments_), limit)).join('\n') };
  }
};

const readFileTool: AgentTool = {
  definition: definition('read_file', 'Read the UTF-8 contents of one file within the workspace. The path must be workspace-relative. Binary files and files larger than 100 KB cannot be read. Use this before discussing or editing a file.', {
    path: { type: 'string', description: 'File path relative to the workspace, such as "src/server.js".' }
  }, ['path']),
  path: pathOf,
  describe: arguments_ => `Reading ${pathOf(arguments_)}`,
  async execute(context, arguments_) { return { success: true, content: await readAgentFile(context.root, requiredPath(arguments_)) }; }
};

const writeFileTool: AgentTool = {
  definition: definition('write_file', 'Create a new UTF-8 text file or replace an existing one inside the workspace. The parent folder must exist and content is limited to 512 KB. Existing files require expected_content containing their exact text from a recent read_file call, so concurrent changes are not overwritten. User approval is required before writing.', {
    path: { type: 'string', description: 'Workspace-relative file path, such as "src/example.ts".' },
    content: { type: 'string', description: 'Complete new file content.' },
    expected_content: { type: 'string', description: 'Exact current file content for replacements; omit only when creating a new file.' }
  }, ['path', 'content']),
  path: pathOf,
  describe: arguments_ => `Writing ${pathOf(arguments_)}`,
  async execute(context, arguments_) {
    const path = requiredPath(arguments_);
    return applyMutation(context, 'write_file', await planAgentWrite(context.root, path, arguments_.content as string, arguments_.expected_content as string | undefined));
  }
};

const replaceInFileTool: AgentTool = {
  definition: definition('replace_in_file', 'Replace one exact, unique text span in an existing workspace file. Read the file first and provide old_text exactly as it appears. The operation fails if the text is absent or occurs more than once, or if the file changes before approval. User approval is required unless this action is allowed for the workspace.', {
    path: { type: 'string', description: 'Workspace-relative file path.' }, old_text: { type: 'string', description: 'Exact text to replace; must occur once.' }, new_text: { type: 'string', description: 'Replacement text.' }
  }, ['path', 'old_text', 'new_text']),
  path: pathOf,
  describe: arguments_ => `Editing ${pathOf(arguments_)}`,
  async execute(context, arguments_) {
    const path = requiredPath(arguments_);
    return applyMutation(context, 'replace_in_file', await planAgentReplacement(context.root, path, arguments_.old_text as string, arguments_.new_text as string));
  }
};

const createFileTool: AgentTool = {
  definition: definition('create_file', 'Create a new UTF-8 file with its complete contents. Fails if the file already exists. Parent folder must exist. Content limit is 512 KB. Requires approval unless this action is allowed for the workspace.', {
    path: { type: 'string' }, content: { type: 'string' }
  }, ['path', 'content']),
  path: pathOf,
  describe: arguments_ => `Creating file ${pathOf(arguments_)}`,
  async execute(context, arguments_) {
    const path = requiredPath(arguments_);
    const change = await planAgentWrite(context.root, path, arguments_.content as string);
    if (change.before !== null) throw new Error('The file already exists.');
    return applyMutation(context, 'create_file', change);
  }
};

const createDirectoryTool: AgentTool = {
  definition: definition('create_directory', 'Create one new folder inside an existing parent folder. Fails if it already exists. Requires approval unless this action is allowed for the workspace.', { path: { type: 'string' } }, ['path']),
  path: pathOf,
  describe: arguments_ => `Creating folder ${pathOf(arguments_)}`,
  async execute(context, arguments_) {
    const path = requiredPath(arguments_);
    return applyMutation(context, 'create_directory', await planAgentCreateDirectory(context.root, path));
  }
};

function deleteTool(directory: boolean): AgentTool {
  const name = directory ? 'delete_directory' : 'delete_file';
  return {
    definition: definition(name, directory
      ? 'Recursively delete a folder inside the workspace. Refuses Git metadata, linked paths, folders over 200 entries or 10 MB, and changed contents. Do this only when explicitly requested. Requires approval unless this action is allowed for the workspace.'
      : 'Delete one regular file inside the workspace. It is rechecked after approval and rejected if changed. Do this only when explicitly requested. Requires approval unless this action is allowed for the workspace.', { path: { type: 'string' } }, ['path']),
    path: pathOf,
    describe: arguments_ => `Deleting ${directory ? 'folder' : 'file'} ${pathOf(arguments_)}`,
    async execute(context, arguments_) {
      const path = requiredPath(arguments_);
      return applyMutation(context, name, await planAgentDelete(context.root, path, directory));
    }
  };
}

export const filesystemTools: AgentTool[] = [listFilesTool, readFileTool, writeFileTool, replaceInFileTool, createFileTool, createDirectoryTool, deleteTool(false), deleteTool(true)];
