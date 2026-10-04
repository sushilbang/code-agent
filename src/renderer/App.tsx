import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, Code2, Copy, Eye, EyeOff, FileCode2, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, GitBranch, History, KeyRound, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Plus, RefreshCw, Save, Settings2, Square, Trash2, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AgentApprovalRequest, AgentEvent, ApprovalDecision, ChatMessage, ChatSummary, FileNode, WorkspaceSnapshot } from '../shared/types';
import { DEFAULT_OPENAI_MODEL, isOpenAIModel, OPENAI_MODELS } from '../shared/models';
import Editor, { type EditorTab } from './Editor';

type Message = ChatMessage;

function TreeNode({ node, depth, expanded, toggle, selected, selectFile, selectDirectory, openContextMenu }: {
  node: FileNode; depth: number; expanded: Set<string>; toggle: (path: string) => void;
  selected: string | null; selectFile: (node: FileNode) => void; selectDirectory: (node: FileNode) => void;
  openContextMenu: (node: FileNode, x: number, y: number) => void;
}) {
  const open = expanded.has(node.path);
  const Icon = node.directory ? (open ? FolderOpen : Folder) : /\.(md|txt|log)$/i.test(node.name) ? FileText : FileCode2;
  return <>
    <button className={`tree-row ${selected === node.path ? 'selected' : ''}`} style={{ paddingLeft: 12 + depth * 15 }}
      title={node.path} onClick={() => node.directory ? (selectDirectory(node), toggle(node.path)) : selectFile(node)}
      onContextMenu={event => { event.preventDefault(); openContextMenu(node, event.clientX, event.clientY); }}>
      <span className="tree-chevron">{node.directory ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
      <Icon size={15} className={node.directory ? 'folder-icon' : 'file-icon'} strokeWidth={1.8} />
      <span className="tree-name">{node.name}</span>
    </button>
    {node.directory && open && node.children?.map(child => <TreeNode key={child.path} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} selectFile={selectFile} selectDirectory={selectDirectory} openContextMenu={openContextMenu} />)}
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
  const [agentVisible, setAgentVisible] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(246);
  const [agentWidth, setAgentWidth] = useState(390);
  const [contextMenu, setContextMenu] = useState<{ node: FileNode; x: number; y: number } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [chatRoot, setChatRoot] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSummary[]>([]);
  const [sidebarView, setSidebarView] = useState<'chat' | 'recent' | 'permissions'>('chat');
  const [allowedActions, setAllowedActions] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<'local' | 'openai'>('local');
  const [model, setModel] = useState<string>(DEFAULT_OPENAI_MODEL);
  const [hasKey, setHasKey] = useState(false);
  const [keySource, setKeySource] = useState<'saved' | 'environment' | 'none'>('none');
  const [keyDialog, setKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
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
      setHasKey(environment.hasOpenAIKey);
      setKeySource(environment.keySource);
      setModel(isOpenAIModel(environment.defaultModel) ? environment.defaultModel : DEFAULT_OPENAI_MODEL);
      setProvider(environment.hasOpenAIKey ? 'openai' : 'local');
    });
    void window.codeAgent.listChats().then(setRecentChats).catch(error => setStatus(messageOf(error)));
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
      void window.codeAgent.saveChat({ id: chatId, title, workspaceRoot: chatRoot, updatedAt: new Date().toISOString(), messages })
        .then(() => window.codeAgent.listChats()).then(setRecentChats).catch(error => setStatus(messageOf(error)));
    }, 600);
    return () => clearTimeout(timer);
  }, [chatId, chatRoot, messages]);

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
      if (chatRoot !== next.root) { void persistCurrentChat(); setMessages([]); setChatId(crypto.randomUUID()); setChatRoot(next.root); }
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
    setCreation({ directory, parent }); setNewName('');
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
    try { await window.codeAgent.startAgent({ runId: id, prompt: text, provider, model, selectedFile: activePath || undefined, history }); }
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
    try { await window.codeAgent.saveChat({ id: chatId, title, workspaceRoot: chatRoot, updatedAt: new Date().toISOString(), messages }); }
    catch (error) { setStatus(messageOf(error)); }
  }

  function newChat(saveCurrent = true) {
    if (runRef.current) return;
    if (saveCurrent) void persistCurrentChat();
    setChatId(crypto.randomUUID()); setChatRoot(workspace?.root || null); setMessages([]); setSidebarView('chat');
  }

  async function openChat(id: string) {
    if (runRef.current) return;
    try {
      const chat = await window.codeAgent.getChat(id);
      if (!chat) { setStatus('Chat not found'); return; }
      if (id !== chatId) await persistCurrentChat();
      skipPersist.current = true;
      setChatId(chat.id); setChatRoot(chat.workspaceRoot); setMessages(chat.messages); setSidebarView('chat');
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

  async function saveApiKey() {
    if (!keyInput.trim()) return;
    setKeySaving(true);
    try {
      const result = await window.codeAgent.saveOpenAIKey(keyInput);
      setHasKey(result.hasOpenAIKey); setKeySource(result.keySource); setKeyInput(''); setShowKey(false); setKeyDialog(false);
      setProvider('openai'); setStatus('API key saved securely');
    } catch (error) { setStatus(messageOf(error)); }
    finally { setKeySaving(false); }
  }

  async function removeApiKey() {
    setKeySaving(true);
    try {
      const result = await window.codeAgent.deleteOpenAIKey();
      setHasKey(result.hasOpenAIKey); setKeySource(result.keySource); setKeyInput(''); setShowKey(false); setKeyDialog(false);
      if (!result.hasOpenAIKey) setProvider('local');
      setStatus(result.hasOpenAIKey ? 'Saved key removed; using environment key' : 'API key removed');
    } catch (error) { setStatus(messageOf(error)); }
    finally { setKeySaving(false); }
  }

  return <div className="app-shell editor-app">
    <main className="workbench" style={{ gridTemplateColumns: `${explorerVisible ? `${explorerWidth}px 4px ` : ''}minmax(0,1fr)${agentVisible ? ` 4px ${agentWidth}px` : ''}` }}>
      {explorerVisible && <aside className="explorer-pane">
        <div className="pane-title"><span>EXPLORER</span><div className="pane-actions">
          <button className="icon-button" title="New file" disabled={!workspace} onClick={() => beginCreate(false)}><FilePlus2 size={15} /></button>
          <button className="icon-button" title="New folder" disabled={!workspace} onClick={() => beginCreate(true)}><FolderPlus size={15} /></button>
          <button className="icon-button" title="Refresh files" disabled={!workspace} onClick={refreshWorkspace}><RefreshCw size={15} /></button>
          <button className="icon-button" title="Collapse explorer" aria-label="Collapse explorer" onClick={() => setExplorerVisible(false)}><PanelLeftClose size={15} /></button>
        </div></div>
        {workspace ? <>
          <div className="repo-heading"><GitBranch size={14} /><span title={workspace.root}>{workspace.name}</span><small>{workspace.fileCount}</small></div>
          <div className="tree-scroll">{workspace.nodes.map(node => <TreeNode key={node.path} node={node} depth={0} expanded={expanded} toggle={toggle} selected={selectedNode?.path || null} selectFile={openFile} selectDirectory={setSelectedNode} openContextMenu={openContextMenu} />)}</div>
        </> : <div className="explorer-empty"><button className="empty-open-button" onClick={openFolder}>Open folder</button></div>}
      </aside>}
      {explorerVisible && <div className="pane-resizer" role="separator" aria-label="Resize explorer" aria-orientation="vertical" onPointerDown={event => beginResize('explorer', event)} />}

      <section className="editor-pane">
        <div className="editor-tabbar">
          {!explorerVisible && <button className="icon-button reveal-pane" title="Show explorer" onClick={() => setExplorerVisible(true)}><PanelLeft size={16} /></button>}
          {tabs.length ? tabs.map(tab => <div className={`editor-tab ${tab.path === activePath ? 'active' : ''}`} key={tab.path} title={tab.path} onClick={() => setActivePath(tab.path)}>
            <FileCode2 size={14} /><span>{tab.path.split('/').at(-1)}</span>{tab.content !== tab.savedContent && <i className="dirty-dot" title="Unsaved changes" />}
            <button className="tab-close" title={`Close ${tab.path}`} onClick={event => { event.stopPropagation(); void closeTab(tab.path); }}><X size={13} /></button>
          </div>) : <span className="editor-label">EDITOR</span>}
          {!agentVisible && <button className="icon-button reveal-pane right" title="Show agent" onClick={() => setAgentVisible(true)}><PanelRight size={16} /></button>}
        </div>
        <Editor tabs={tabs} activePath={activePath} onChange={editFile} />
        {!activeTab && <div className="editor-empty"><Code2 size={37} strokeWidth={1.25} /><strong>Open a file</strong><span>Choose a file from the explorer</span></div>}
      </section>

      {agentVisible && <div className="pane-resizer" role="separator" aria-label="Resize agent" aria-orientation="vertical" onPointerDown={event => beginResize('agent', event)} />}
      {agentVisible && <aside className="agent-pane">
        <div className="agent-title"><div><button className="icon-button" title="New chat" disabled={Boolean(runId)} onClick={() => newChat()}><Plus size={16} /></button><strong>Agent</strong></div><div className="agent-controls">
          <button className={`icon-button ${sidebarView === 'recent' ? 'active' : ''}`} title="Recent chats" disabled={Boolean(approval)} onClick={() => setSidebarView(sidebarView === 'recent' ? 'chat' : 'recent')}><History size={16} /></button>
          <button className={`icon-button ${sidebarView === 'permissions' ? 'active' : ''}`} title="Allowed actions" disabled={Boolean(approval)} onClick={() => setSidebarView(sidebarView === 'permissions' ? 'chat' : 'permissions')}><Settings2 size={16} /></button>
          <button className={`icon-button ${keyDialog ? 'active' : ''}`} title="API key settings" disabled={Boolean(runId)} onClick={() => setKeyDialog(true)}><KeyRound size={15} /></button>
          <button className="icon-button" title="Collapse agent" aria-label="Collapse agent" onClick={() => setAgentVisible(false)}><PanelRightClose size={15} /></button>
          <select aria-label="Model provider" value={provider} disabled={Boolean(runId)} onChange={event => setProvider(event.target.value as 'local' | 'openai')}><option value="local">Local inspection</option><option value="openai">OpenAI</option></select>
        </div></div>
        {sidebarView === 'recent' ? <div className="conversation side-list"><div className="side-list-title">Recent chats</div>{recentChats.length ? recentChats.map(chat => <div className="recent-row" key={chat.id}>
          <button onClick={() => void openChat(chat.id)} title={`${chat.workspaceRoot}\n${chat.updatedAt}`}><strong>{chat.title}</strong><span>{chat.workspaceRoot.split(/[\\/]/).at(-1)} · {new Date(chat.updatedAt).toLocaleDateString()}</span></button>
          <button className="icon-button" title={`Delete ${chat.title}`} onClick={() => void deleteChat(chat.id)}><Trash2 size={14} /></button>
        </div>) : <div className="side-list-empty">No saved chats</div>}</div> : sidebarView === 'permissions' ? <div className="conversation side-list"><div className="side-list-title">Allowed actions</div><div className="side-list-context">{workspace?.name || 'Open a folder'}</div>{allowedActions.length ? allowedActions.map(tool => <div className="permission-row" key={tool}><span>{tool.replaceAll('_', ' ')}</span><button className="icon-button" title={`Revoke ${tool}`} onClick={() => void window.codeAgent.revokeAllowedAction(tool).then(setAllowedActions).catch(error => setStatus(messageOf(error)))}><X size={15} /></button></div>) : <div className="side-list-empty">No actions always allowed in this folder</div>}</div> : <div className="conversation">
          {!chatMatchesWorkspace && <div className="chat-workspace-notice"><strong>{chatRoot?.split(/[\\/]/).at(-1)}</strong><span>This chat is linked to another folder. Open that folder to continue, or start a new chat here.</span><button onClick={() => void openFolder()}>Open folder</button></div>}
          {messages.length === 0 ? <div className="conversation-empty"><Code2 size={27} strokeWidth={1.5} /><strong>What are we working on?</strong><span>{workspace ? workspace.name : 'Open a repository to begin'}</span></div> : messages.map(message => <div className={`message ${message.role}`} key={message.id}>
            <div className="message-label">{message.role === 'user' ? 'You' : 'Agent'}</div>
            {message.reasoning && <details className="reasoning-block"><summary>Reasoning summary</summary><div>{message.reasoning}</div></details>}
            {message.tools?.map(tool => <details className="tool-step" key={`${tool.id}-${Boolean(tool.diff)}`} open={Boolean(tool.diff)}>
              <summary><FileText size={13} /><span>{tool.name} · {tool.path}</span><small className={tool.success === false ? 'failed' : ''}>{tool.success === undefined ? 'Running' : tool.success ? 'Done' : 'Failed'}</small></summary>
              <div className="tool-description">{tool.description}</div>
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
        <div className="composer-wrap"><div className="composer">
          <textarea aria-label="Message to agent" placeholder={chatMatchesWorkspace ? 'Ask about this repository' : 'Open the linked folder to continue'} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} disabled={!workspace || !chatMatchesWorkspace || Boolean(runId)} />
          <div className="composer-foot"><span className="composer-context" title={activePath || undefined}>{activePath ? activePath.split('/').at(-1) : workspace?.name || ''}</span>{provider === 'openai' && <select className="composer-model" aria-label="OpenAI model" title="Model" value={model} disabled={Boolean(runId)} onChange={event => setModel(event.target.value)}>{OPENAI_MODELS.map(name => <option value={name} key={name}>{name}</option>)}</select>}<button className="send-button" title={runId ? 'Stop response' : 'Send message'} aria-label={runId ? 'Stop response' : 'Send message'} disabled={!runId && (!workspace || !chatMatchesWorkspace || !prompt.trim())} onClick={() => void send()}>{runId ? <Square size={12} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2.4} />}</button></div>
        </div></div>
      </aside>}
    </main>
    <footer className="statusbar"><span title={status}>{status}</span><span>{activeTab ? `${activeTab.lines} lines  ·  ${formatSize(activeTab.size)}${activeTab.content !== activeTab.savedContent ? '  ·  Unsaved' : ''}` : workspace ? `${workspace.fileCount} files${dirtyCount ? `  ·  ${dirtyCount} unsaved` : ''}` : ''}</span></footer>
    {creation && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreation(null); }}><form className="create-dialog" onSubmit={event => { event.preventDefault(); void createEntry(); }}>
      <h2>{creation.directory ? 'New folder' : 'New file'}</h2><p>{creation.parent || workspace?.name}</p>
      <input autoFocus aria-label={creation.directory ? 'Folder name' : 'File name'} value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setCreation(null); }} placeholder={creation.directory ? 'folder-name' : 'filename.ts'} />
      <div className="dialog-actions"><button type="button" onClick={() => setCreation(null)}>Cancel</button><button type="submit" className="primary" disabled={!newName.trim()}>Create</button></div>
    </form></div>}
    {keyDialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !keySaving) setKeyDialog(false); }}><form className="create-dialog key-dialog" onSubmit={event => { event.preventDefault(); void saveApiKey(); }}>
      <h2>OpenAI API key</h2><p>{keySource === 'saved' ? 'A key is encrypted and saved on this device.' : keySource === 'environment' ? 'Using OPENAI_API_KEY from the app environment.' : 'Add a key to use OpenAI models.'}</p>
      <label htmlFor="api-key">API key</label><div className="secret-input"><input id="api-key" autoFocus type={showKey ? 'text' : 'password'} value={keyInput} onChange={event => setKeyInput(event.target.value)} placeholder="sk-..." autoComplete="off" spellCheck={false} /><button type="button" className="icon-button" title={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(previous => !previous)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      <small>The key is encrypted with your operating system credentials. It is never added to chat history or sent to the editor.</small>
      <div className="dialog-actions">{keySource === 'saved' && <button type="button" className="danger" disabled={keySaving} onClick={() => void removeApiKey()}>Remove saved key</button>}<span /><button type="button" disabled={keySaving} onClick={() => setKeyDialog(false)}>Cancel</button><button type="submit" className="primary" disabled={keySaving || !keyInput.trim()}>{keySaving ? 'Saving...' : 'Save key'}</button></div>
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
