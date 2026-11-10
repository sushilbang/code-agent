import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Brain, ChevronDown, ChevronRight, Code2, Copy, Ellipsis, Eye, EyeOff, FileCode2, FileJson, FilePlus2, FileText, Files, FolderPlus, History, KeyRound, MessageSquare, Plus, RefreshCw, Save, Settings2, Square, Trash2, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AgentApprovalRequest, AgentEvent, ApprovalDecision, ChatMessage, ChatSummary, ContextCheckpoint, ContextSettings, ContextUsage, FileNode, WorkspaceSnapshot } from '../shared/types';
import { DEFAULT_CONTEXT_SETTINGS } from '../shared/context';
import { DEFAULT_EFFORTS, DEFAULT_MODELS, KEY_PLACEHOLDERS, KEY_PROVIDERS, MODEL_CATALOG, PROVIDER_LABELS, REASONING_EFFORTS, TIER_LABELS, detectKeyProvider, isKeyProvider, isModelFor, isReasoningEffort, modelsFor, supportsReasoning, type AgentProvider, type KeyProvider, type ModelTier, type ReasoningEffort } from '../shared/models';
import type { KeySource } from '../shared/types';
import Dropdown, { type DropdownGroup } from './components/Dropdown';
import Editor, { type CursorInfo, type EditorTab } from './Editor';
import ContextControls from './components/agent/ContextControls';
import ProjectMemoryPanel from './components/agent/ProjectMemoryPanel';

type Message = ChatMessage;

function readSetting(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeSetting(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preferences are optional */ } }
const modelGroupsFor = (provider: KeyProvider): DropdownGroup<string>[] => (['efficient', 'standard', 'latest'] as ModelTier[])
  .map(tier => ({ label: TIER_LABELS[tier], options: modelsFor(provider).filter(model => model.tier === tier).map(model => ({ value: model.id, label: model.label, description: model.description })) }))
  .filter(group => group.options.length > 0);
const effortGroups: DropdownGroup<ReasoningEffort>[] = [{ label: 'Reasoning effort', options: REASONING_EFFORTS.map(effort => ({
  value: effort, label: effort[0].toUpperCase() + effort.slice(1), description: effort === 'low' ? 'Fewest tokens, fastest' : effort === 'medium' ? 'Balanced' : 'Most thorough, most tokens'
})) }];
const providerGroups: DropdownGroup<AgentProvider>[] = [{ options: [
  { value: 'anthropic', label: PROVIDER_LABELS.anthropic, description: 'Claude models through the Anthropic API' },
  { value: 'openai', label: PROVIDER_LABELS.openai, description: 'Models through the OpenAI API' },
  { value: 'local', label: PROVIDER_LABELS.local, description: 'No model; scans the folder only' }
] }];
const providerShortNames: Record<AgentProvider, string> = { local: 'Local', anthropic: 'Claude', openai: 'OpenAI' };
const providerSetting = (): AgentProvider | null => { const stored = readSetting('provider'); return stored === 'local' || isKeyProvider(stored) ? stored : null; };
const storedModel = (provider: KeyProvider): string => { const stored = readSetting(`model.${provider}`) ?? (provider === 'openai' ? readSetting('model') : null); return isModelFor(provider, stored) ? stored : DEFAULT_MODELS[provider]; };
const storedEffort = (provider: KeyProvider): ReasoningEffort => { const stored = readSetting(`effort.${provider}`) ?? (provider === 'openai' ? readSetting('effort') : null); return isReasoningEffort(stored) ? stored : DEFAULT_EFFORTS[provider]; };
type OverflowAction = 'permissions' | 'memory' | 'key';
const overflowGroups: DropdownGroup<OverflowAction>[] = [{ options: [
  { value: 'permissions', label: 'Allowed actions', icon: <Settings2 size={14} /> },
  { value: 'memory', label: 'Project memory', icon: <Brain size={14} /> },
  { value: 'key', label: 'API key settings', icon: <KeyRound size={14} />, separatorBefore: true }
] }];

const iconColors: Record<string, string> = { ts: '#519aba', tsx: '#519aba', mts: '#519aba', cts: '#519aba', js: '#cbcb41', jsx: '#cbcb41', mjs: '#cbcb41', cjs: '#cbcb41', json: '#cbcb41', css: '#519aba', scss: '#f55385', html: '#e37933', md: '#519aba', py: '#519aba', cs: '#519aba', yml: '#a074c4', yaml: '#a074c4', xml: '#e37933', sh: '#89e051', ps1: '#519aba', sql: '#dad8d8', rs: '#dea584', go: '#519aba' };

function FileGlyph({ name, size = 16 }: { name: string; size?: number }) {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  const Icon = extension === 'json' ? FileJson : /^(md|txt|log)$/.test(extension) ? FileText : FileCode2;
  return <Icon size={size} strokeWidth={1.5} color={iconColors[extension] || '#9d9d9d'} className="file-icon" />;
}

function TreeNode({ node, depth, expanded, toggle, selected, selectFile, selectDirectory, openContextMenu, renderCreate }: {
  node: FileNode; depth: number; expanded: Set<string>; toggle: (path: string) => void;
  selected: string | null; selectFile: (node: FileNode) => void; selectDirectory: (node: FileNode) => void;
  openContextMenu: (node: FileNode, x: number, y: number) => void; renderCreate: (parent: string, depth: number) => React.ReactNode;
}) {
  const open = expanded.has(node.path);
  return <>
    <button className={`tree-row ${selected === node.path ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 8 }}
      title={node.path} onClick={() => node.directory ? (selectDirectory(node), toggle(node.path)) : selectFile(node)}
      onContextMenu={event => { event.preventDefault(); openContextMenu(node, event.clientX, event.clientY); }}>
      <span className="tree-chevron">{node.directory ? open ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : null}</span>
      {!node.directory && <FileGlyph name={node.name} />}
      <span className="tree-name">{node.name}</span>
    </button>
    {node.directory && open && <>{renderCreate(node.path, depth + 1)}{node.children?.map(child => <TreeNode key={child.path} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} selectFile={selectFile} selectDirectory={selectDirectory} openContextMenu={openContextMenu} renderCreate={renderCreate} />)}</>}
  </>;
}

function formatSize(size: number): string { return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`; }
function parentOf(file: string): string { const index = file.lastIndexOf('/'); return index < 0 ? '' : file.slice(0, index); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function MarkdownMessage({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="message-text markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function DiffView({ diff }: { diff: string }) {
  return <div className="approval-diff" role="region" aria-label="File diff"><code>{diff.split('\n').map((line, index) =>
    <span key={index} className={`diff-line ${line.startsWith('+++') || line.startsWith('---') ? 'diff-file' : line.startsWith('@@') ? 'diff-hunk' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : 'diff-context'}`}>{line || ' '}</span>
  )}</code></div>;
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [creation, setCreation] = useState<{ directory: boolean; parent: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [rootOpen, setRootOpen] = useState(true);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const [agentVisible, setAgentVisible] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(300);
  const [agentWidth, setAgentWidth] = useState(390);
  const [contextMenu, setContextMenu] = useState<{ node: FileNode; x: number; y: number } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [chatRoot, setChatRoot] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSummary[]>([]);
  const [sidebarView, setSidebarView] = useState<'chat' | 'recent' | 'permissions' | 'memory'>('chat');
  const [allowedActions, setAllowedActions] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [provider, setProviderState] = useState<AgentProvider>('local');
  const [models, setModels] = useState<Record<KeyProvider, string>>(() => ({ anthropic: storedModel('anthropic'), openai: storedModel('openai') }));
  const [efforts, setEfforts] = useState<Record<KeyProvider, ReasoningEffort>>(() => ({ anthropic: storedEffort('anthropic'), openai: storedEffort('openai') }));
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [keys, setKeys] = useState<Record<KeyProvider, KeySource>>({ anthropic: 'none', openai: 'none' });
  const [keyDialog, setKeyDialog] = useState<KeyProvider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState('');
  const keyProvider = provider === 'local' ? null : provider;
  const model = keyProvider ? models[keyProvider] : DEFAULT_MODELS.anthropic;
  const effort = keyProvider ? efforts[keyProvider] : DEFAULT_EFFORTS.anthropic;
  const [contextSettings, setContextSettings] = useState<ContextSettings>(DEFAULT_CONTEXT_SETTINGS);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextCheckpoints, setContextCheckpoints] = useState<ContextCheckpoint[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [approval, setApproval] = useState<AgentApprovalRequest | null>(null);
  const runRef = useRef<string | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const skipPersist = useRef(false);
  const messageEnd = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<string | null>(null);
  const activeTab = tabs.find(tab => tab.path === activePath) || null;
  const dirtyCount = tabs.filter(tab => tab.content !== tab.savedContent).length;
  const chatMatchesWorkspace = !chatRoot || chatRoot === workspace?.root;
  tabsRef.current = tabs;

  useEffect(() => {
    if (!window.codeAgent) return;
    void window.codeAgent.getEnvironment().then(environment => {
      setKeys(environment.keys);
      // A saved model choice wins; otherwise each provider starts on its default (which an environment variable may override).
      setModels({ anthropic: readSetting('model.anthropic') ? storedModel('anthropic') : environment.defaultModels.anthropic, openai: readSetting('model.openai') || readSetting('model') ? storedModel('openai') : environment.defaultModels.openai });
      const available = KEY_PROVIDERS.filter(name => environment.keys[name] !== 'none');
      const remembered = providerSetting();
      // Claude is the default provider; with no key anywhere, ask for one.
      const initial: AgentProvider = remembered && (remembered === 'local' || environment.keys[remembered] !== 'none') ? remembered : available.includes('anthropic') ? 'anthropic' : available[0] ?? 'local';
      setProviderState(initial);
      if (!available.length) setKeyDialog('anthropic');
    });
    void window.codeAgent.listChats().then(setRecentChats).catch(error => setStatus(messageOf(error)));
    void window.codeAgent.getContextSettings().then(setContextSettings).catch(error => setStatus(messageOf(error)));
    const unsubscribeEvent = window.codeAgent.onAgentEvent(handleAgentEvent);
    const unsubscribeApproval = window.codeAgent.onApprovalRequest(request => {
      if (runRef.current !== request.runId || tabsRef.current.some(tab => tab.path === request.path || (request.tool === 'delete_directory' && tab.path.startsWith(`${request.path}/`)) ? tab.content !== tab.savedContent : false)) {
        void window.codeAgent.respondApproval(request.id, 'deny');
        return;
      }
      setApproval(request);
      setSidebarView('chat');
      setStatus(`Review change to ${request.path}`);
    });
    return () => { unsubscribeEvent(); unsubscribeApproval(); };
  }, []);

  useEffect(() => {
    if (!window.codeAgent) return;
    return window.codeAgent.onMenuCommand(command => { void handleMenuCommand(command); });
  }, [workspace, tabs, activePath, selectedNode]);

  useEffect(() => {
    const dirty = activeTab && activeTab.content !== activeTab.savedContent;
    document.title = [activePath ? `${dirty ? '\u25CF ' : ''}${activePath.split('/').at(-1)}` : '', workspace?.name, 'Code Agent'].filter(Boolean).join(' - ');
  }, [activePath, activeTab?.content, activeTab?.savedContent, workspace?.name]);
  useEffect(() => { const field = promptRef.current; if (!field) return; field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, 200)}px`; }, [prompt, sidebarView]);
  useEffect(() => { messageEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, approval, sidebarView]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close); window.addEventListener('blur', close); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', onKey); };
  }, [contextMenu]);
  useEffect(() => { if (window.codeAgent) void window.codeAgent.reportDirty(tabs.filter(tab => tab.content !== tab.savedContent).map(tab => tab.path)); }, [tabs]);
  useEffect(() => {
    if (!chatRoot || !messages.length) return;
    if (skipPersist.current) { skipPersist.current = false; return; }
    const timer = setTimeout(() => {
      const title = messages.find(message => message.role === 'user')?.text.slice(0, 80) || 'New chat';
      void window.codeAgent.saveChat({ id: chatId, title, workspaceRoot: chatRoot, updatedAt: new Date().toISOString(), messages, contextUsage: contextUsage || undefined, contextCheckpoints })
        .then(() => window.codeAgent.listChats()).then(setRecentChats).catch(error => setStatus(messageOf(error)));
    }, 600);
    return () => clearTimeout(timer);
  }, [chatId, chatRoot, messages, contextUsage, contextCheckpoints]);

  function handleAgentEvent(event: AgentEvent) {
    if (runRef.current !== event.runId) return;
    if (event.type === 'delta') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, text: message.text + event.text } : message));
      setStatus('Responding');
    } else if (event.type === 'reasoning') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, reasoning: (message.reasoning || '') + event.text } : message));
      setStatus('Reasoning');
    } else if (event.type === 'tool-start') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, tools: [...(message.tools || []), { id: event.id, name: event.name, path: event.path, description: event.description }] } : message));
      setStatus(event.description);
    } else if (event.type === 'tool-result') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, tools: message.tools?.map(tool => tool.id === event.id ? { ...tool, success: event.success, content: event.content, diff: event.diff } : tool) } : message));
      setStatus(event.success ? 'Working' : 'Tool failed');
    } else if (event.type === 'tool-output') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, tools: message.tools?.map(tool => tool.id === event.id ? { ...tool, content: `${tool.content || ''}${event.content}`.slice(-20000) } : tool) } : message));
      setStatus('Command running');
    } else if (event.type === 'subagent-status') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, tools: message.tools?.map(tool => tool.id === event.id ? {
        ...tool, children: [...(tool.children || []).filter(child => child.index !== event.activity.index), event.activity].sort((a, b) => a.index - b.index)
      } : tool) } : message));
      setStatus(`Investigation ${event.activity.index + 1}: ${event.activity.status}`);
    } else if (event.type === 'subagent-budget') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, tools: message.tools?.map(tool => tool.id === event.id ? { ...tool, budget: event.usage } : tool) } : message));
    } else if (event.type === 'context-usage') {
      setContextUsage(event.usage);
    } else if (event.type === 'context-compacted') {
      setContextCheckpoints(previous => [...previous, event.checkpoint].slice(-10));
      setStatus('Context compacted');
    } else if (event.type === 'context-files') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, retrieved: event.sources } : message));
      setStatus(event.sources.length ? `Retrieved ${event.sources.length} file excerpt(s)` : 'No file excerpts retrieved');
    } else if (event.type === 'context-memory') {
      setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, memoriesUsed: event.items } : message));
    } else if (event.type === 'file-changed') {
      const root = workspaceRef.current;
      void window.codeAgent.refreshWorkspace().then(snapshot => { if (root === workspaceRef.current) setWorkspace(snapshot); }).catch(error => setStatus(messageOf(error)));
      if (event.deleted) {
        const removed = (file: string) => file === event.path || (event.directory && file.startsWith(`${event.path}/`));
        setTabs(previous => previous.filter(tab => !removed(tab.path)));
        setActivePath(previous => previous && removed(previous) ? null : previous);
        setSelectedNode(previous => previous && removed(previous.path) ? null : previous);
      } else if (tabsRef.current.some(tab => tab.path === event.path)) {
        void window.codeAgent.readFile(event.path).then(file => {
          if (root !== workspaceRef.current) return;
          setTabs(previous => previous.map(tab => tab.path === event.path && tab.content === tab.savedContent
            ? { ...file, savedContent: file.content } : tab));
        }).catch(error => setStatus(messageOf(error)));
      }
    } else {
      if (event.type === 'error') {
        setMessages(previous => previous.map(message => message.id === event.runId ? { ...message, text: message.text || event.message, error: !message.text } : message));
        setStatus(event.message);
      } else setStatus('Ready');
      runRef.current = null; setRunId(null); setApproval(null);
    }
  }

  async function openFolder() {
    if (dirtyCount && !await window.codeAgent.confirmDiscard()) return;
    try {
      setStatus('Opening repository...');
      const next = await window.codeAgent.openWorkspace();
      if (!next) { setStatus('Ready'); return; }
      workspaceRef.current = next.root;
      setWorkspace(next); setSelectedNode(null); setTabs([]); setActivePath(null); setExpanded(new Set());
      if (chatRoot !== next.root) { void persistCurrentChat(); setMessages([]); setContextUsage(null); setContextCheckpoints([]); setChatId(crypto.randomUUID()); setChatRoot(next.root); }
      setSidebarView('chat');
      void window.codeAgent.listAllowedActions().then(setAllowedActions);
      setStatus(next.truncated ? 'Explorer limited to 5,000 entries' : 'Repository ready');
    } catch (error) { setStatus(messageOf(error)); }
  }

  async function refreshWorkspace() {
    try { setWorkspace(await window.codeAgent.refreshWorkspace()); setStatus('Explorer refreshed'); }
    catch (error) { setStatus(messageOf(error)); }
  }

  async function openFile(node: FileNode) {
    setSelectedNode(node);
    if (tabs.some(tab => tab.path === node.path)) { setActivePath(node.path); return; }
    const root = workspaceRef.current;
    try {
      const file = await window.codeAgent.readFile(node.path);
      if (root !== workspaceRef.current) return;
      setTabs(previous => previous.some(tab => tab.path === node.path) ? previous : [...previous, { ...file, savedContent: file.content }]);
      setActivePath(node.path); setStatus(node.path);
    } catch (error) { setStatus(messageOf(error)); }
  }

  function editFile(file: string, content: string) {
    setTabs(previous => previous.map(tab => tab.path === file ? { ...tab, content, lines: content ? content.split('\n').length : 0, size: new Blob([content]).size } : tab));
  }

  async function saveActive() {
    if (activeTab) await saveTab(activeTab.path);
  }

  async function saveTab(file: string) {
    const tab = tabs.find(item => item.path === file);
    if (!tab) return;
    if (tab.content === tab.savedContent) { setStatus('No changes to save'); return; }
    try {
      const saved = await window.codeAgent.saveFile(tab.path, tab.content, tab.savedContent);
      setTabs(previous => previous.map(item => item.path === tab.path ? { ...item, savedContent: saved.content, size: new Blob([item.content]).size, lines: item.content ? item.content.split('\n').length : 0 } : item));
      setStatus(`Saved ${tab.path}`);
    } catch (error) { setStatus(messageOf(error)); }
  }

  async function closeTab(file: string) {
    const tab = tabs.find(item => item.path === file);
    if (!tab) return;
    if (tab.content !== tab.savedContent && !await window.codeAgent.confirmDiscard()) return;
    const index = tabs.findIndex(item => item.path === file);
    const remaining = tabs.filter(item => item.path !== file);
    setTabs(remaining);
    if (activePath === file) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path || null);
  }

  function beginCreate(directory: boolean, parentOverride?: string) {
    if (!workspace) { setStatus('Open a repository first'); return; }
    const parent = parentOverride !== undefined ? parentOverride : selectedNode ? (selectedNode.directory ? selectedNode.path : parentOf(selectedNode.path)) : activePath ? parentOf(activePath) : '';
    setCreation({ directory, parent }); setNewName(''); setRootOpen(true); setExplorerVisible(true);
    if (parent) setExpanded(previous => new Set(previous).add(parent));
  }

  function beginResize(side: 'explorer' | 'agent', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === 'explorer' ? explorerWidth : agentWidth;
    document.body.classList.add('resizing-panes');
    const move = (moveEvent: PointerEvent) => {
      const delta = side === 'explorer' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const maximum = side === 'explorer' ? Math.min(480, window.innerWidth - 620) : Math.min(620, window.innerWidth - 520);
      const width = Math.max(side === 'explorer' ? 170 : 300, Math.min(maximum, startWidth + delta));
      if (side === 'explorer') setExplorerWidth(width); else setAgentWidth(width);
    };
    const stop = () => {
      document.body.classList.remove('resizing-panes');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  }

  function openContextMenu(node: FileNode, x: number, y: number) {
    setSelectedNode(node);
    setContextMenu({ node, x: Math.min(x, window.innerWidth - 210), y: Math.min(y, window.innerHeight - 220) });
  }

  async function createEntry() {
    if (!creation || !newName.trim()) return;
    const name = newName.trim();
    if (name === '.' || name === '..' || /[\\/]/.test(name)) { setStatus('Enter a single file or folder name'); return; }
    const target = creation.parent ? `${creation.parent}/${name}` : name;
    try {
      const next = await window.codeAgent.createEntry(target, creation.directory);
      setWorkspace(next); setCreation(null); setStatus(`Created ${target}`);
      if (creation.parent) setExpanded(previous => new Set(previous).add(creation.parent));
      if (!creation.directory) await openFile({ name, path: target, directory: false });
    } catch (error) { setStatus(messageOf(error)); }
  }

  async function deleteEntry(node: FileNode) {
    try {
      const next = await window.codeAgent.deleteEntry(node.path, node.directory);
      if (!next) { setStatus('Delete cancelled'); return; }
      const removed = (file: string) => file === node.path || (node.directory && file.startsWith(`${node.path}/`));
      const remaining = tabs.filter(tab => !removed(tab.path));
      setWorkspace(next); setTabs(remaining); setSelectedNode(previous => previous && removed(previous.path) ? null : previous);
      setActivePath(previous => previous && removed(previous) ? remaining.at(-1)?.path || null : previous);
      setStatus(`Deleted ${node.path}`);
    } catch (error) { setStatus(messageOf(error)); }
  }

  function toggle(path: string) {
    setExpanded(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; });
  }

  async function handleMenuCommand(command: string) {
    switch (command) {
      case 'open-folder': await openFolder(); break;
      case 'new-file': beginCreate(false); break;
      case 'new-folder': beginCreate(true); break;
      case 'save': await saveActive(); break;
      case 'close-editor': if (activePath) await closeTab(activePath); break;
      case 'toggle-explorer': setExplorerVisible(previous => !previous); break;
      case 'toggle-agent': setAgentVisible(previous => !previous); break;
    }
  }

  async function send() {
    if (runRef.current) { await window.codeAgent.stopAgent(runRef.current); return; }
    if (!workspace || !chatMatchesWorkspace || !prompt.trim()) return;
    const id = crypto.randomUUID();
    const text = prompt.trim();
    runRef.current = id; setRunId(id); setPrompt(''); setStatus('Working'); setChatRoot(workspace.root);
    const history = messages.filter(message => message.text && !message.error).slice(-12).map(message => ({ role: message.role, content: message.text.slice(0, 10000) }));
    setMessages(previous => [...previous, { id: `${id}-user`, role: 'user', text }, { id, role: 'assistant', text: '' }]);
    try { await window.codeAgent.startAgent({ runId: id, prompt: text, provider, model, ...(provider !== 'local' && supportsReasoning(model) ? { reasoningEffort: effort } : {}), selectedFile: activePath || undefined, history }); }
    catch (error) { handleAgentEvent({ runId: id, type: 'error', message: messageOf(error) }); }
  }

  async function answerApproval(decision: ApprovalDecision) {
    if (!approval) return;
    const request = approval;
    setApproval(null);
    const dirty = tabsRef.current.some(tab => (tab.path === request.path || (request.tool === 'delete_directory' && tab.path.startsWith(`${request.path}/`))) && tab.content !== tab.savedContent);
    await window.codeAgent.respondApproval(request.id, dirty ? 'deny' : decision);
    if (decision === 'always' && !dirty) setAllowedActions(previous => [...new Set([...previous, request.tool])]);
    setStatus(decision !== 'deny' && !dirty ? `Applying ${request.path}` : `Declined ${request.path}`);
  }

  async function persistCurrentChat() {
    if (!chatRoot || !messages.length) return;
    const title = messages.find(message => message.role === 'user')?.text.slice(0, 80) || 'New chat';
    try { await window.codeAgent.saveChat({ id: chatId, title, workspaceRoot: chatRoot, updatedAt: new Date().toISOString(), messages, contextUsage: contextUsage || undefined, contextCheckpoints }); }
    catch (error) { setStatus(messageOf(error)); }
  }

  function newChat(saveCurrent = true) {
    if (runRef.current) return;
    if (saveCurrent) void persistCurrentChat();
    setChatId(crypto.randomUUID()); setChatRoot(workspace?.root || null); setMessages([]); setContextUsage(null); setContextCheckpoints([]); setSidebarView('chat');
  }

  async function openChat(id: string) {
    if (runRef.current) return;
    try {
      const chat = await window.codeAgent.getChat(id);
      if (!chat) { setStatus('Chat not found'); return; }
      if (id !== chatId) await persistCurrentChat();
      skipPersist.current = true;
      setChatId(chat.id); setChatRoot(chat.workspaceRoot); setMessages(chat.messages); setContextUsage(chat.contextUsage || null); setContextCheckpoints(chat.contextCheckpoints || []); setSidebarView('chat');
      setStatus(chat.workspaceRoot === workspace?.root ? 'Chat opened' : 'Chat opened; select its folder to continue');
    } catch (error) { setStatus(messageOf(error)); }
  }

  async function deleteChat(id: string) {
    try {
      await window.codeAgent.deleteChat(id);
      setRecentChats(await window.codeAgent.listChats());
      if (id === chatId) newChat(false);
    } catch (error) { setStatus(messageOf(error)); }
  }

  function selectProvider(next: AgentProvider) {
    if (next !== 'local' && keys[next] === 'none') { setKeyInput(''); setKeyError(''); setKeyDialog(next); return; }
    setProviderState(next); writeSetting('provider', next);
  }

  function openKeyDialog() { setKeyInput(''); setKeyError(''); setShowKey(false); setKeyDialog(keyProvider ?? 'anthropic'); }

  async function saveApiKey() {
    if (!keyInput.trim() || !keyDialog) return;
    setKeySaving(true); setKeyError('');
    try {
      const result = await window.codeAgent.saveApiKey(keyInput, keyDialog);
      setKeys(result.keys); setKeyInput(''); setShowKey(false); setKeyDialog(null);
      // The provider is detected from the key, so its default model becomes active.
      setProviderState(result.savedProvider); writeSetting('provider', result.savedProvider);
      setStatus(`${PROVIDER_LABELS[result.savedProvider]} key saved securely`);
    } catch (error) { setKeyError(messageOf(error)); }
    finally { setKeySaving(false); }
  }

  async function removeApiKey() {
    if (!keyDialog) return;
    setKeySaving(true);
    try {
      const removed = keyDialog;
      const result = await window.codeAgent.deleteApiKey(removed);
      setKeys(result.keys); setKeyInput(''); setShowKey(false); setKeyDialog(null);
      if (provider === removed && result.keys[removed] === 'none') setProviderState(KEY_PROVIDERS.find(name => result.keys[name] !== 'none') ?? 'local');
      setStatus(result.keys[removed] === 'environment' ? 'Saved key removed; using environment key' : 'API key removed');
    } catch (error) { setStatus(messageOf(error)); }
    finally { setKeySaving(false); }
  }

  const crumbs = activePath ? activePath.split('/') : [];
  const chatTitle = sidebarView === 'recent' ? 'Recent chats' : sidebarView === 'permissions' ? 'Allowed actions' : sidebarView === 'memory' ? 'Project memory' : (messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 48) || 'New chat');
  const renderCreate = (parent: string, depth: number) => creation && creation.parent === parent ? <div className="tree-row create-row" style={{ paddingLeft: 8 + depth * 8 }}>
    <span className="tree-chevron" />{!creation.directory && <FileGlyph name={newName || 'file'} />}
    <input autoFocus aria-label={creation.directory ? 'Folder name' : 'File name'} value={newName} onChange={event => setNewName(event.target.value)} onBlur={() => setCreation(null)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createEntry(); } else if (event.key === 'Escape') setCreation(null); }} />
  </div> : null;

  return <div className="app-shell editor-app">
    <main className="workbench" style={{ gridTemplateColumns: `48px ${explorerVisible ? `${explorerWidth}px 4px ` : ''}minmax(0,1fr)${agentVisible ? ` 4px ${agentWidth}px` : ''}` }}>
      <nav className="activity-bar" aria-label="Activity Bar">
        <button className={`activity-item ${explorerVisible ? 'active' : ''}`} title="Explorer (Ctrl+B)" aria-label="Explorer" onClick={() => setExplorerVisible(previous => !previous)}><Files size={24} strokeWidth={1.5} /></button>
        <button className={`activity-item ${agentVisible ? 'active' : ''}`} title="Agent (Ctrl+J)" aria-label="Agent" onClick={() => setAgentVisible(previous => !previous)}><MessageSquare size={24} strokeWidth={1.5} /></button>
      </nav>
      {explorerVisible && <aside className="explorer-pane">
        <div className="pane-title"><span>Explorer</span></div>
        {workspace ? <>
          <div className="section-header" role="button" tabIndex={0} aria-expanded={rootOpen} onClick={() => setRootOpen(previous => !previous)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setRootOpen(previous => !previous); } }}>
            {rootOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span className="section-name" title={workspace.root}>{workspace.name}</span>
            <div className="section-actions" onClick={event => event.stopPropagation()}>
              <button className="icon-button" title="New File..." aria-label="New File" onClick={() => beginCreate(false)}><FilePlus2 size={16} /></button>
              <button className="icon-button" title="New Folder..." aria-label="New Folder" onClick={() => beginCreate(true)}><FolderPlus size={16} /></button>
              <button className="icon-button" title="Refresh Explorer" aria-label="Refresh Explorer" onClick={refreshWorkspace}><RefreshCw size={16} /></button>
            </div>
          </div>
          {rootOpen && <div className="tree-scroll">{renderCreate('', 0)}{workspace.nodes.map(node => <TreeNode key={node.path} node={node} depth={0} expanded={expanded} toggle={toggle} selected={selectedNode?.path || null} selectFile={openFile} selectDirectory={setSelectedNode} openContextMenu={openContextMenu} renderCreate={renderCreate} />)}</div>}
        </> : <>
          <div className="section-header static"><ChevronDown size={16} /><span className="section-name">No Folder Opened</span></div>
          <div className="explorer-empty"><p>You have not yet opened a folder.</p><button className="empty-open-button" onClick={openFolder}>Open Folder</button></div>
        </>}
      </aside>}
      {explorerVisible && <div className="pane-resizer" role="separator" aria-label="Resize explorer" aria-orientation="vertical" onPointerDown={event => beginResize('explorer', event)} />}

      <section className="editor-pane">
        {tabs.length > 0 && <div className="editor-tabbar" role="tablist">
          {tabs.map(tab => {
            const dirty = tab.content !== tab.savedContent;
            const name = tab.path.split('/').at(-1) || tab.path;
            return <div role="tab" aria-selected={tab.path === activePath} className={`editor-tab ${tab.path === activePath ? 'active' : ''} ${dirty ? 'dirty' : ''}`} key={tab.path} title={tab.path}
              onClick={() => setActivePath(tab.path)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void closeTab(tab.path); } }}>
              <FileGlyph name={name} /><span className="tab-label">{name}</span>
              <button className="tab-close" title="Close (Ctrl+W)" aria-label={`Close ${name}`} onClick={event => { event.stopPropagation(); void closeTab(tab.path); }}><span className="tab-dot" /><X size={16} /></button>
            </div>;
          })}
        </div>}
        {activeTab && <div className="breadcrumbs" aria-label="Breadcrumbs">{crumbs.map((part, index) => <span className="crumb" key={index}>{index > 0 && <ChevronRight size={14} />}{index === crumbs.length - 1 && <FileGlyph name={part} size={14} />}<span>{part}</span></span>)}</div>}
        <Editor tabs={tabs} activePath={activePath} onChange={editFile} onCursor={setCursor} />
        {!activeTab && <div className="editor-empty">
          <Code2 size={170} strokeWidth={0.6} className="watermark" />
          <dl className="shortcuts">
            <dt>Open Folder</dt><dd><kbd>Ctrl</kbd> <kbd>O</kbd></dd>
            <dt>New File</dt><dd><kbd>Ctrl</kbd> <kbd>N</kbd></dd>
            <dt>Toggle Explorer</dt><dd><kbd>Ctrl</kbd> <kbd>B</kbd></dd>
            <dt>Toggle Agent</dt><dd><kbd>Ctrl</kbd> <kbd>J</kbd></dd>
          </dl>
        </div>}
      </section>

      {agentVisible && <div className="pane-resizer" role="separator" aria-label="Resize agent" aria-orientation="vertical" onPointerDown={event => beginResize('agent', event)} />}
      {agentVisible && <aside className="agent-pane">
        <div className="agent-title"><div><strong title={chatTitle}>{chatTitle}</strong></div><div className="agent-controls">
          <button className="icon-button" title="New chat" aria-label="New chat" disabled={Boolean(runId)} onClick={() => newChat()}><Plus size={16} /></button>
          <button className={`icon-button ${sidebarView === 'recent' ? 'active' : ''}`} title="Recent chats" aria-label="Recent chats" disabled={Boolean(approval)} onClick={() => setSidebarView(sidebarView === 'recent' ? 'chat' : 'recent')}><History size={16} /></button>
          <Dropdown groups={overflowGroups} ariaLabel="More actions" title="More actions" variant="icon" placement="bottom" align="end" width={200} disabled={Boolean(approval)} label={<Ellipsis size={16} />}
            onSelect={action => { if (action === 'key') { if (!runId) openKeyDialog(); } else setSidebarView(previous => previous === action ? 'chat' : action); }} />
        </div></div>
        {sidebarView === 'recent' ? <div className="conversation side-list"><div className="side-list-title">Recent chats</div>{recentChats.length ? recentChats.map(chat => <div className="recent-row" key={chat.id}>
          <button onClick={() => void openChat(chat.id)} title={`${chat.workspaceRoot}\n${chat.updatedAt}`}><strong>{chat.title}</strong><span>{chat.workspaceRoot.split(/[\\/]/).at(-1)} · {new Date(chat.updatedAt).toLocaleDateString()}</span></button>
          <button className="icon-button" title={`Delete ${chat.title}`} onClick={() => void deleteChat(chat.id)}><Trash2 size={14} /></button>
        </div>) : <div className="side-list-empty">No saved chats</div>}</div> : sidebarView === 'permissions' ? <div className="conversation side-list"><div className="side-list-title">Allowed actions</div><div className="side-list-context">{workspace?.name || 'Open a folder'}</div>{allowedActions.length ? allowedActions.map(tool => <div className="permission-row" key={tool}><span>{tool.replaceAll('_', ' ')}</span><button className="icon-button" title={`Revoke ${tool}`} onClick={() => void window.codeAgent.revokeAllowedAction(tool).then(setAllowedActions).catch(error => setStatus(messageOf(error)))}><X size={15} /></button></div>) : <div className="side-list-empty">No actions always allowed in this folder</div>}</div> : sidebarView === 'memory' ? <ProjectMemoryPanel workspaceRoot={workspace?.root} /> : <div className="conversation">
          {!chatMatchesWorkspace && <div className="chat-workspace-notice"><strong>{chatRoot?.split(/[\\/]/).at(-1)}</strong><span>This chat is linked to another folder. Open that folder to continue, or start a new chat here.</span><button onClick={() => void openFolder()}>Open folder</button></div>}
          {messages.length === 0 ? <div className="conversation-empty"><Code2 size={27} strokeWidth={1.5} /><strong>What are we working on?</strong><span>{workspace ? workspace.name : 'Open a repository to begin'}</span></div> : messages.map(message => <div className={`message ${message.role}`} key={message.id}>
            <div className="message-label">{message.role === 'user' ? 'You' : 'Agent'}</div>
            {message.retrieved && <details className="source-block"><summary>On-disk context · {message.retrieved.length} excerpt(s)</summary>
              {message.retrieved.length ? <ul>{message.retrieved.map(source => <li key={`${source.path}:${source.startLine}`}>{source.path}:{source.startLine}–{source.endLine} <small>({source.reason})</small></li>)}</ul> : <p>No automatic file excerpts; the agent can still use search and read tools.</p>}
            </details>}
            {message.memoriesUsed && <details className="source-block"><summary>Project memory · {message.memoriesUsed.length} item(s)</summary>{message.memoriesUsed.length ? <ul>{message.memoriesUsed.map(item => <li key={item.id}>{item.topic}</li>)}</ul> : <p>No relevant project memory used.</p>}</details>}
            {message.reasoning && <details className="reasoning-block"><summary>Reasoning summary</summary><div>{message.reasoning}</div></details>}
            {message.tools?.map(tool => <details className="tool-step" key={`${tool.id}-${Boolean(tool.diff)}`} open={Boolean(tool.diff) || Boolean(tool.children?.length)}>
              <summary><FileText size={13} /><span>{tool.name} · {tool.path}</span><small className={tool.success === false ? 'failed' : ''}>{tool.success === undefined ? 'Running' : tool.success ? 'Done' : 'Failed'}</small></summary>
              <div className="tool-description">{tool.description}</div>
              {tool.budget && <div className="subagent-budget">Subagent run budget: {tool.budget.estimated ? '~' : ''}{tool.budget.usedTokens.toLocaleString()} / {tool.budget.limitTokens.toLocaleString()} tokens</div>}
              {tool.children && <ol className="subagent-timeline" aria-label="Delegated investigations">{tool.children.map(child => <li key={child.index}>
                <span className={`subagent-state ${child.status}`}>{child.status}</span><span className="subagent-task">{child.task}</span>
                {child.dependsOn && child.dependsOn.length > 0 && <small>after {child.dependsOn.join(', ')}</small>}
                <small>{new Date(child.at).toLocaleTimeString()}{child.usage ? ` · ${child.usage.inputTokens + child.usage.outputTokens} tokens` : ''}</small>
              </li>)}</ol>}
              {tool.diff && <DiffView diff={tool.diff} />}
              {tool.content !== undefined && <pre>{tool.content || '(no output)'}</pre>}
            </details>)}
            {message.text ? message.role === 'assistant' && !message.error ? <MarkdownMessage text={message.text} /> : <div className={`message-text ${message.error ? 'message-error' : ''}`}>{message.text}</div> : runId === message.id ? <div className="message-text thinking">Thinking</div> : null}
          </div>)}
          {approval && <section className="approval-inline" aria-label={`Review ${approval.tool} on ${approval.path}`}>
            <div className="approval-inline-heading"><strong>{approval.tool.replaceAll('_', ' ')}</strong><span>{approval.path}</span></div>
            {approval.details && <p>{approval.details}</p>}
            <details open><summary>Review changes</summary><div className="approval-inline-code">{approval.diff ? <div><strong>Diff</strong><DiffView diff={approval.diff} /></div> : null}<div><strong>Current</strong><pre>{approval.before ?? '(does not exist)'}</pre></div><div><strong>Proposed</strong><pre>{approval.after || (approval.tool.startsWith('delete_') ? '(deleted)' : '(empty)')}</pre></div></div></details>
            <div className="approval-inline-actions"><button onClick={() => void answerApproval('deny')}>Reject</button><button onClick={() => void answerApproval('once')}>Allow once</button>{approval.allowAlways !== false && <button className="primary" title={`Always allow ${approval.tool} in this folder`} onClick={() => void answerApproval('always')}>Always allow</button>}</div>
          </section>}
          <div ref={messageEnd} />
        </div>}
        <div className="composer-wrap">
          {provider !== 'local' && <ContextControls settings={contextSettings} usage={contextUsage} checkpoints={contextCheckpoints}
            onSettingsSaved={settings => { setContextSettings(settings); setStatus('Context preferences saved'); }} />}
          <div className="composer">
            {(activePath || workspace) && <div className="composer-chips">{activePath ? <span className="chip" title={activePath}><FileGlyph name={activePath.split('/').at(-1) || activePath} size={14} />{activePath.split('/').at(-1)}</span> : <span className="chip muted">{workspace?.name}</span>}</div>}
            <textarea ref={promptRef} rows={2} aria-label="Message to agent" placeholder={chatMatchesWorkspace ? 'Ask about this repository' : 'Open the linked folder to continue'} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} disabled={!workspace || !chatMatchesWorkspace || Boolean(runId)} />
            <div className="composer-foot">
              <Dropdown groups={providerGroups} value={provider} onSelect={selectProvider} ariaLabel="Provider" title="Provider" placement="top" width={280} disabled={Boolean(runId)} label={providerShortNames[provider]} />
              {keyProvider && <Dropdown groups={modelGroupsFor(keyProvider)} value={model} onSelect={next => { setModels(previous => ({ ...previous, [keyProvider]: next })); writeSetting(`model.${keyProvider}`, next); }} ariaLabel="Model" title="Model" placement="top" width={330} disabled={Boolean(runId)} label={MODEL_CATALOG.find(entry => entry.id === model)?.label || model} />}
              {keyProvider && supportsReasoning(model) && <Dropdown groups={effortGroups} value={effort} onSelect={next => { setEfforts(previous => ({ ...previous, [keyProvider]: next })); writeSetting(`effort.${keyProvider}`, next); }} ariaLabel="Reasoning effort" title="Reasoning effort" placement="top" width={250} disabled={Boolean(runId)} />}
              <span className="composer-spacer" />
              <button className="send-button" title={runId ? 'Stop response' : 'Send message'} aria-label={runId ? 'Stop response' : 'Send message'} disabled={!runId && (!workspace || !chatMatchesWorkspace || !prompt.trim())} onClick={() => void send()}>{runId ? <Square size={11} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.4} />}</button>
            </div>
          </div></div>
      </aside>}
    </main>
    <footer className="statusbar">
      <div className="status-left"><span className="status-item" title={status}>{status}</span>{dirtyCount > 0 && <span className="status-item">{dirtyCount} unsaved</span>}</div>
      <div className="status-right">{activeTab && cursor && <>
        <span className="status-item">Ln {cursor.line}, Col {cursor.column}{cursor.selected ? ` (${cursor.selected} selected)` : ''}</span>
        <span className="status-item">{cursor.insertSpaces ? 'Spaces' : 'Tab Size'}: {cursor.tabSize}</span>
        <span className="status-item">UTF-8</span><span className="status-item">{cursor.eol}</span><span className="status-item">{cursor.language}</span>
      </>}</div>
    </footer>
    {keyDialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !keySaving) setKeyDialog(null); }}><form className="create-dialog key-dialog" onSubmit={event => { event.preventDefault(); void saveApiKey(); }}>
      <h2>{KEY_PROVIDERS.every(name => keys[name] === 'none') ? 'Add your API key' : 'API key'}</h2>
      <div className="key-tabs" role="tablist" aria-label="Provider">{KEY_PROVIDERS.map(name => <button type="button" role="tab" aria-selected={keyDialog === name} className={keyDialog === name ? 'active' : ''} key={name} onClick={() => { setKeyDialog(name); setKeyError(''); }}>{PROVIDER_LABELS[name]}{keys[name] !== 'none' && <i className="key-dot" title="Key available" />}</button>)}</div>
      <p>{keys[keyDialog] === 'saved' ? 'A key is encrypted and saved on this device.' : keys[keyDialog] === 'environment' ? `Using ${keyDialog === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} from the app environment.` : keyDialog === 'anthropic' ? 'Claude is the default provider. Paste an Anthropic API key to start.' : 'Paste an OpenAI API key to use OpenAI models.'}</p>
      <label htmlFor="api-key">API key</label><div className="secret-input"><input id="api-key" autoFocus type={showKey ? 'text' : 'password'} value={keyInput} onChange={event => { setKeyInput(event.target.value); setKeyError(''); const detected = detectKeyProvider(event.target.value); if (detected) setKeyDialog(detected); }} placeholder={KEY_PLACEHOLDERS[keyDialog]} autoComplete="off" spellCheck={false} /><button type="button" className="icon-button" title={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(previous => !previous)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      {keyError && <p role="alert" className="message-error">{keyError}</p>}
      <small>The provider is detected from the key (Anthropic keys start with sk-ant-, OpenAI keys with sk-) and its default model is selected. The key is encrypted with your operating system credentials and is never added to chat history or sent to the editor.</small>
      <div className="dialog-actions">{keys[keyDialog] === 'saved' && <button type="button" className="danger" disabled={keySaving} onClick={() => void removeApiKey()}>Remove saved key</button>}<span /><button type="button" disabled={keySaving} onClick={() => setKeyDialog(null)}>{KEY_PROVIDERS.every(name => keys[name] === 'none') ? 'Not now' : 'Cancel'}</button><button type="submit" className="primary" disabled={keySaving || !keyInput.trim()}>{keySaving ? 'Saving...' : 'Save key'}</button></div>
    </form></div>}
    {contextMenu && <div className="file-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={event => event.stopPropagation()}>
      {!contextMenu.node.directory && <button role="menuitem" onClick={() => { void openFile(contextMenu.node); setContextMenu(null); }}><FileCode2 size={14} />Open</button>}
      {!contextMenu.node.directory && tabs.some(tab => tab.path === contextMenu.node.path && tab.content !== tab.savedContent) && <button role="menuitem" onClick={() => { void saveTab(contextMenu.node.path); setContextMenu(null); }}><Save size={14} />Save</button>}
      <button role="menuitem" onClick={() => { void navigator.clipboard.writeText(contextMenu.node.path).then(() => setStatus('Relative path copied')); setContextMenu(null); }}><Copy size={14} />Copy relative path</button>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => { beginCreate(false, contextMenu.node.directory ? contextMenu.node.path : parentOf(contextMenu.node.path)); setContextMenu(null); }}><FilePlus2 size={14} />New file here</button>
      <button role="menuitem" onClick={() => { beginCreate(true, contextMenu.node.directory ? contextMenu.node.path : parentOf(contextMenu.node.path)); setContextMenu(null); }}><FolderPlus size={14} />New folder here</button>
      {!contextMenu.node.directory && tabs.some(tab => tab.path === contextMenu.node.path) && <><div className="context-separator" /><button role="menuitem" onClick={() => { void closeTab(contextMenu.node.path); setContextMenu(null); }}><X size={14} />Close editor</button></>}
      <div className="context-separator" /><button className="danger" role="menuitem" onClick={() => { void deleteEntry(contextMenu.node); setContextMenu(null); }}><Trash2 size={14} />Delete</button>
    </div>}
  </div>;
}
