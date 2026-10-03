import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage } from 'electron';
import type { AgentApprovalRequest, AgentRequest, ApprovalDecision, ChatRecord } from '../shared/types';
import { runAgent } from './agent';
import { buildActionDiff } from './actionDiff';
import { LocalStore } from './storage';
import { buildWorkspace, createWorkspaceEntry, readPreview, saveWorkspaceFile, type AgentFileChange, type AgentPathChange } from './workspace';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let workspaceRoot: string | null = null;
let activeRun: { id: string; controller: AbortController } | null = null;
let mainWindow: BrowserWindow | null = null;
let dirtyPaths = new Set<string>();
let closeConfirmed = false;
const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();
const actionNames = new Set(['write_file', 'replace_in_file', 'create_file', 'create_directory', 'delete_file', 'delete_directory']);
let store: LocalStore;

async function savedOpenAIKey(): Promise<string | null> {
  const encrypted = await store.getEncryptedOpenAIKey();
  if (!encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
  catch { throw new Error('The saved API key could not be decrypted. Remove it and save it again.'); }
}

async function openAIKey(): Promise<string | null> {
  return await savedOpenAIKey() || process.env.OPENAI_API_KEY?.trim() || null;
}

function checkSender(event: Electron.IpcMainInvokeEvent): void {
  if (!event.senderFrame?.url.startsWith('app://-/')) throw new Error('Untrusted IPC sender.');
}

async function requestWriteApproval(runId: string, change: AgentFileChange | AgentPathChange, tool: string, signal: AbortSignal): Promise<boolean> {
  const root = workspaceRoot;
  if (signal.aborted || [...dirtyPaths].some(file => file === change.path || ('operation' in change && change.operation === 'delete_directory' && file.startsWith(`${change.path}/`))) ||
    !mainWindow || mainWindow.isDestroyed() || !root) return false;
  if ((await store.allowedActions(root)).includes(tool)) return !signal.aborted;
  return new Promise(resolve => {
    const id = randomUUID();
    const finish = (decision: ApprovalDecision) => {
      if (!pendingApprovals.has(id)) return;
      pendingApprovals.delete(id);
      signal.removeEventListener('abort', cancel);
      if (decision === 'always') {
        void store.allowAction(root, tool).then(() => resolve(!signal.aborted), () => resolve(false));
      } else resolve(decision === 'once' && !signal.aborted);
    };
    const cancel = () => finish('deny');
    pendingApprovals.set(id, finish);
    signal.addEventListener('abort', cancel, { once: true });
    const approval: AgentApprovalRequest = {
      id,
      runId,
      tool,
      path: change.path,
      before: change.before,
      after: change.after,
      diff: buildActionDiff(change),
      details: 'details' in change ? change.details : undefined
    };
    mainWindow!.webContents.send('agent:approval-request', approval);
  });
}

app.whenReady().then(async () => {
  store = new LocalStore(app.getPath('userData'));
  const command = (name: string) => mainWindow?.webContents.send('menu:command', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open Folder...', accelerator: 'CmdOrCtrl+O', click: () => command('open-folder') },
      { type: 'separator' },
      { label: 'New File...', accelerator: 'CmdOrCtrl+N', click: () => command('new-file') },
      { label: 'New Folder...', accelerator: 'CmdOrCtrl+Shift+N', click: () => command('new-folder') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: () => command('close-editor') },
      { type: 'separator' },
      { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ] },
    { label: 'View', submenu: [
      { label: 'Toggle Explorer', accelerator: 'CmdOrCtrl+B', click: () => command('toggle-explorer') },
      { label: 'Toggle Agent', accelerator: 'CmdOrCtrl+J', click: () => command('toggle-agent') },
      { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
  const dist = path.resolve(__dirname, '../../dist');
  protocol.handle('app', request => {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dist, name);
    const relative = path.relative(dist, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  mainWindow = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1020, minHeight: 620,
    backgroundColor: '#11151a',
    title: 'Code Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.on('close', event => {
    if (!dirtyPaths.size || closeConfirmed) return;
    event.preventDefault();
    const response = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning', buttons: ['Keep Editing', 'Discard Changes'], defaultId: 0, cancelId: 0,
      message: 'Close with unsaved changes?', detail: `${dirtyPaths.size} file${dirtyPaths.size === 1 ? '' : 's'} have unsaved changes.`
    });
    if (response === 1) { closeConfirmed = true; mainWindow?.close(); }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://-/')) event.preventDefault();
  });
  await mainWindow.loadURL('app://-/index.html');
}).catch(error => console.error('Code Agent startup failed:', error));

app.on('window-all-closed', () => {
  activeRun?.controller.abort();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('workspace:open', async event => {
  checkSender(event);
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'Open repository' });
  if (result.canceled || !result.filePaths[0]) return null;
  const snapshot = await buildWorkspace(result.filePaths[0]);
  activeRun?.controller.abort();
  workspaceRoot = snapshot.root;
  dirtyPaths.clear();
  return snapshot;
});

ipcMain.handle('workspace:refresh', async event => {
  checkSender(event);
  if (!workspaceRoot) throw new Error('Open a repository first.');
  return buildWorkspace(workspaceRoot);
});

ipcMain.handle('workspace:read', async (event, relativePath: unknown) => {
  checkSender(event);
  if (!workspaceRoot) throw new Error('Open a repository first.');
  if (typeof relativePath !== 'string') throw new Error('Invalid file path.');
  return readPreview(workspaceRoot, relativePath);
});

ipcMain.handle('workspace:save', async (event, relativePath: unknown, content: unknown, expectedContent: unknown) => {
  checkSender(event);
  if (!workspaceRoot) throw new Error('Open a repository first.');
  if (typeof relativePath !== 'string' || typeof content !== 'string' || typeof expectedContent !== 'string') throw new Error('Invalid save request.');
  return saveWorkspaceFile(workspaceRoot, relativePath, content, expectedContent);
});

ipcMain.handle('workspace:create', async (event, relativePath: unknown, directory: unknown) => {
  checkSender(event);
  if (!workspaceRoot) throw new Error('Open a repository first.');
  if (typeof relativePath !== 'string' || typeof directory !== 'boolean') throw new Error('Invalid create request.');
  return createWorkspaceEntry(workspaceRoot, relativePath, directory);
});

ipcMain.handle('workspace:confirm-discard', async event => {
  checkSender(event);
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning', buttons: ['Keep Editing', 'Discard Changes'], defaultId: 0, cancelId: 0,
    message: 'Discard unsaved changes?', detail: 'Changes in open files have not been saved.'
  });
  return result.response === 1;
});

ipcMain.handle('editor:dirty', (event, paths: unknown) => {
  checkSender(event);
  if (!Array.isArray(paths) || paths.length > 1000 || paths.some(file => typeof file !== 'string')) throw new Error('Invalid dirty-file list.');
  dirtyPaths = new Set(paths);
});

ipcMain.handle('agent:approval-response', (event, id: unknown, decision: unknown) => {
  checkSender(event);
  if (typeof id !== 'string' || !['once', 'always', 'deny'].includes(String(decision))) throw new Error('Invalid approval response.');
  pendingApprovals.get(id)?.(decision as ApprovalDecision);
});

ipcMain.handle('agent:allowed-actions', async event => {
  checkSender(event);
  return workspaceRoot ? store.allowedActions(workspaceRoot) : [];
});

ipcMain.handle('agent:revoke-action', async (event, tool: unknown) => {
  checkSender(event);
  if (!workspaceRoot || typeof tool !== 'string' || !actionNames.has(tool)) throw new Error('Invalid action.');
  return store.revokeAction(workspaceRoot, tool);
});

ipcMain.handle('chat:list', event => { checkSender(event); return store.listChats(); });
ipcMain.handle('chat:get', (event, id: unknown) => {
  checkSender(event);
  if (typeof id !== 'string') throw new Error('Invalid chat id.');
  return store.getChat(id);
});
ipcMain.handle('chat:save', (event, chat: ChatRecord) => { checkSender(event); return store.saveChat(chat); });
ipcMain.handle('chat:delete', (event, id: unknown) => {
  checkSender(event);
  if (typeof id !== 'string') throw new Error('Invalid chat id.');
  return store.deleteChat(id);
});

ipcMain.handle('agent:environment', event => {
  checkSender(event);
  return savedOpenAIKey().then(key => ({
    hasOpenAIKey: Boolean(key || process.env.OPENAI_API_KEY),
    keySource: key ? 'saved' as const : process.env.OPENAI_API_KEY ? 'environment' as const : 'none' as const,
    defaultModel: process.env.OPENAI_MODEL || 'gpt-5.4'
  }));
});

ipcMain.handle('agent:save-key', async (event, value: unknown) => {
  checkSender(event);
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new Error('Enter a valid API key.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
  await store.setEncryptedOpenAIKey(safeStorage.encryptString(value.trim()).toString('base64'));
  return { hasOpenAIKey: true, keySource: 'saved' as const };
});

ipcMain.handle('agent:delete-key', async event => {
  checkSender(event);
  await store.setEncryptedOpenAIKey(null);
  return { hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY), keySource: process.env.OPENAI_API_KEY ? 'environment' as const : 'none' as const };
});

ipcMain.handle('agent:start', (event, request: AgentRequest) => {
  checkSender(event);
  if (!workspaceRoot) throw new Error('Open a repository first.');
  if (activeRun) throw new Error('An agent response is already running.');
  if (!request || typeof request.runId !== 'string' || typeof request.prompt !== 'string' || !request.prompt.trim() ||
      (request.provider !== 'local' && request.provider !== 'openai') || typeof request.model !== 'string' ||
      (request.selectedFile !== undefined && typeof request.selectedFile !== 'string') ||
      (request.history !== undefined && (!Array.isArray(request.history) || request.history.length > 12 ||
        request.history.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 10000)))) {
    throw new Error('Invalid agent request.');
  }
  const controller = new AbortController();
  const run = { id: request.runId, controller };
  activeRun = run;
  const root = workspaceRoot;
  void openAIKey().then(key => runAgent(root, request, controller.signal, agentEvent => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('agent:event', agentEvent);
  }, (change, tool, signal) => requestWriteApproval(request.runId, change, tool, signal), key || undefined)).catch(error => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('agent:event', { runId: request.runId, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }).finally(() => {
    if (activeRun === run) activeRun = null;
  });
});

ipcMain.handle('agent:stop', (event, runId: unknown) => {
  checkSender(event);
  if (typeof runId === 'string' && activeRun?.id === runId) activeRun.controller.abort();
});
