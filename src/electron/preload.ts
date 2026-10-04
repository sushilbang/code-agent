import { contextBridge, ipcRenderer } from 'electron';
import type { AgentApprovalRequest, AgentEvent, AgentRequest, DesktopApi } from '../shared/types';

const api: DesktopApi = {
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  readFile: path => ipcRenderer.invoke('workspace:read', path),
  saveFile: (path, content, expectedContent) => ipcRenderer.invoke('workspace:save', path, content, expectedContent),
  createEntry: (path, directory) => ipcRenderer.invoke('workspace:create', path, directory),
  deleteEntry: (path, directory) => ipcRenderer.invoke('workspace:delete', path, directory),
  confirmDiscard: () => ipcRenderer.invoke('workspace:confirm-discard'),
  reportDirty: paths => ipcRenderer.invoke('editor:dirty', paths),
  startAgent: (request: AgentRequest) => ipcRenderer.invoke('agent:start', request),
  stopAgent: runId => ipcRenderer.invoke('agent:stop', runId),
  getEnvironment: () => ipcRenderer.invoke('agent:environment'),
  saveOpenAIKey: key => ipcRenderer.invoke('agent:save-key', key),
  deleteOpenAIKey: () => ipcRenderer.invoke('agent:delete-key'),
  onAgentEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },
  onApprovalRequest: listener => {
    const handler = (_event: Electron.IpcRendererEvent, request: AgentApprovalRequest) => listener(request);
    ipcRenderer.on('agent:approval-request', handler);
    return () => ipcRenderer.removeListener('agent:approval-request', handler);
  },
  respondApproval: (id, approved) => ipcRenderer.invoke('agent:approval-response', id, approved),
  listAllowedActions: () => ipcRenderer.invoke('agent:allowed-actions'),
  revokeAllowedAction: tool => ipcRenderer.invoke('agent:revoke-action', tool),
  listChats: () => ipcRenderer.invoke('chat:list'),
  getChat: id => ipcRenderer.invoke('chat:get', id),
  saveChat: chat => ipcRenderer.invoke('chat:save', chat),
  deleteChat: id => ipcRenderer.invoke('chat:delete', id),
  onMenuCommand: listener => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  }
};

contextBridge.exposeInMainWorld('codeAgent', api);
