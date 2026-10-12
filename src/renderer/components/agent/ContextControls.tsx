import { useState } from 'react';
import type { ContextCheckpoint, ContextSettings, ContextUsage } from '../../../shared/types';
import { contextLevel, isContextSettings } from '../../../shared/context';

interface Props {
  settings: ContextSettings;
  usage: ContextUsage | null;
  checkpoints: ContextCheckpoint[];
  onSettingsSaved(settings: ContextSettings): void;
}

function formatTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

export default function ContextControls({ settings, usage, checkpoints, onSettingsSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ContextSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const level = usage ? contextLevel(usage, settings) : 'normal';
  const latest = checkpoints.at(-1);

  async function save() {
    if (!isContextSettings(draft)) return;
    setSaving(true); setError('');
    try {
      onSettingsSaved(await window.codeAgent.saveContextSettings(draft));
      setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <button className={`context-indicator ${level}`} type="button" onClick={() => { setDraft(settings); setError(''); setOpen(true); }}
      title={usage ? `${usage.source === 'api' ? 'API reported' : 'Estimated'} input tokens for the latest model request. Working budget is a preference, not the model limit.` : 'Context usage appears after an OpenAI request. Configure the working budget.'}>
      <span>Context</span><strong>{usage ? `${usage.source === 'estimate' ? '~' : ''}${formatTokens(usage.inputTokens)} / ${formatTokens(settings.workingBudgetTokens)}` : `— / ${formatTokens(settings.workingBudgetTokens)}`}</strong>
      {checkpoints.length > 0 && <span>Compacted</span>}
      {level !== 'normal' && <span>{level === 'warning' ? 'Near budget' : 'Review context'}</span>}
    </button>
    {open && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}><form className="create-dialog context-dialog" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>Context usage</h2>
      <p>The indicator shows input tokens for the latest model request. API counts replace local estimates when available. The working budget is your planning limit, not the model's maximum context window.</p>
      {usage && <p>Latest request: {usage.source === 'estimate' ? 'approximately ' : ''}{usage.inputTokens.toLocaleString()} input tokens{usage.outputTokens === undefined ? '' : `, ${usage.outputTokens.toLocaleString()} output tokens`}.</p>}
      {latest && <section className="context-checkpoint"><strong>Last compaction · {new Date(latest.at).toLocaleString()}</strong>
        <p>OpenAI compacted this run's internal context. The encrypted state is not readable here. This is a local checkpoint from visible activity, not the contents of that state.</p>
        <div>Recent requests</div><ul>{latest.recentRequests.map((text, index) => <li key={index}>{text}</li>)}</ul>
        {latest.selectedFile && <p>Selected file: {latest.selectedFile}</p>}
        {latest.toolPaths.length > 0 && <p>Tool paths: {latest.toolPaths.join(', ')}</p>}
      </section>}
      <label htmlFor="context-budget">Working budget (tokens)</label><input id="context-budget" type="number" min={16000} max={500000} step={1000} value={draft.workingBudgetTokens} onChange={event => setDraft(previous => ({ ...previous, workingBudgetTokens: Number(event.target.value) }))} />
      <label htmlFor="context-warning">Warn at (%)</label><input id="context-warning" type="number" min={50} max={90} value={draft.warningPercent} onChange={event => setDraft(previous => ({ ...previous, warningPercent: Number(event.target.value) }))} />
      <label htmlFor="context-compaction">Compact at (%)</label><input id="context-compaction" type="number" min={55} max={99} value={draft.compactionPercent} onChange={event => setDraft(previous => ({ ...previous, compactionPercent: Number(event.target.value) }))} />
      <small>OpenAI automatically compacts an active run when its rendered context crosses this threshold. New runs still use recent visible chat history; the provider's opaque state is not saved locally.</small>
      <label htmlFor="subagent-budget">Subagent budget per run (tokens)</label><input id="subagent-budget" type="number" min={4000} max={200000} step={1000} value={draft.subAgentBudgetTokens} onChange={event => setDraft(previous => ({ ...previous, subAgentBudgetTokens: Number(event.target.value) }))} />
      <small>Shared by every delegated investigation in one parent run. Estimates reserve tokens before concurrent requests; API usage replaces them afterward, so a response can exceed the limit slightly.</small>
      {error && <p role="alert" className="message-error">{error}</p>}
      <div className="dialog-actions"><span /><button type="button" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={saving || !isContextSettings(draft)}>{saving ? 'Saving...' : 'Save preferences'}</button></div>
    </form></div>}
  </>;
}
