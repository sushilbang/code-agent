import type { AgentEvent } from '../../shared/types';

export type EmitAgentEvent = (event: AgentEvent) => void;
export type LocalAgentEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent ? Omit<Event, 'runId'> : never
  : never;

export function scopedEmitter(runId: string, emit: EmitAgentEvent): (event: LocalAgentEvent) => void {
  return event => emit({ ...event, runId } as AgentEvent);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
