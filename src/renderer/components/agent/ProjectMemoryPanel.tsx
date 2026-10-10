import { useEffect, useState } from 'react';
import type { ProjectMemory, ProjectMemoryInput } from '../../../shared/types';

const empty: ProjectMemoryInput = { topic: '', value: '', source: { kind: 'user' }, enabled: true };
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function ProjectMemoryPanel({ workspaceRoot }: { workspaceRoot?: string }) {
  const [items, setItems] = useState<ProjectMemory[]>([]);
  const [draft, setDraft] = useState<ProjectMemoryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(null); setError(''); setItems([]);
    if (workspaceRoot) void window.codeAgent.listProjectMemories().then(setItems).catch(cause => setError(messageOf(cause)));
  }, [workspaceRoot]);

  async function save(input: ProjectMemoryInput) {
    setBusy(true); setError('');
    try { setItems(await window.codeAgent.saveProjectMemory(input)); setDraft(null); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError('');
    try { const result = await window.codeAgent.deleteProjectMemory(id); if (result) { setItems(result); setDraft(null); } }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  return <div className="conversation side-list memory-panel">
    <div className="memory-heading"><div><div className="side-list-title">Project memory</div><div className="side-list-context">{workspaceRoot?.split(/[\\/]/).at(-1) || 'Open a folder'}</div></div><button disabled={!workspaceRoot || busy} onClick={() => setDraft({ ...empty, source: { kind: 'user' } })}>Add</button></div>
    <p className="memory-help">Facts you explicitly save here can be used in relevant future prompts. They are separate from chat history and stored locally, unencrypted. Do not save secrets.</p>
    {error && <p className="memory-error" role="alert">{error}</p>}
    {draft && <form className="memory-form" onSubmit={event => { event.preventDefault(); void save(draft); }}>
      <label>Topic<input value={draft.topic} maxLength={80} onChange={event => setDraft({ ...draft, topic: event.target.value })} placeholder="e.g. Testing approach" /></label>
      <label>Fact or decision<textarea value={draft.value} maxLength={1000} onChange={event => setDraft({ ...draft, value: event.target.value })} placeholder="What should the agent remember?" /></label>
      <label>Source<select value={draft.source.kind} onChange={event => setDraft({ ...draft, source: { kind: event.target.value as 'user' | 'file' } })}><option value="user">My note</option><option value="file">File reference</option></select></label>
      <label>Reference {draft.source.kind === 'file' ? '(required)' : '(optional)'}<input value={draft.source.reference || ''} maxLength={300} onChange={event => setDraft({ ...draft, source: { ...draft.source, reference: event.target.value } })} placeholder={draft.source.kind === 'file' ? 'docs/architecture.md' : 'Why this is true'} /></label>
      <label className="memory-check"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Eligible for agent context</label>
      <div className="memory-actions"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="primary" disabled={busy || !draft.topic.trim() || !draft.value.trim() || (draft.source.kind === 'file' && !draft.source.reference?.trim())}>Save</button></div>
    </form>}
    {!workspaceRoot ? <div className="side-list-empty">Open a folder to manage its memory.</div> : !items.length ? <div className="side-list-empty">No project memory yet.</div> : items.map(item => <section className="memory-item" key={item.id}>
      <div className="memory-item-title"><strong>{item.topic}</strong><label title={item.enabled ? 'Eligible for future context' : 'Excluded from future context'}><input type="checkbox" checked={item.enabled} disabled={busy} onChange={() => void save({ id: item.id, topic: item.topic, value: item.value, source: item.source, enabled: !item.enabled })} /> Use</label></div>
      <p>{item.value}</p><small>{item.source.kind === 'file' ? 'File reference' : 'Your note'}{item.source.reference ? ` · ${item.source.reference}` : ''} · updated {new Date(item.updatedAt).toLocaleDateString()}</small>
      <div className="memory-actions"><button disabled={busy} onClick={() => setDraft({ id: item.id, topic: item.topic, value: item.value, source: { ...item.source }, enabled: item.enabled })}>Edit</button><button className="danger" disabled={busy} onClick={() => void remove(item.id)}>Delete</button></div>
    </section>)}
  </div>;
}
