import type { AgentRequest, ContextCheckpoint } from '../../shared/types';

// A transparent local checkpoint of visible activity, not the provider's opaque compacted state.
export function createContextCheckpoint(request: AgentRequest, toolPaths: string[], at = new Date().toISOString()): ContextCheckpoint {
  return {
    at,
    recentRequests: [...(request.history || []).filter(item => item.role === 'user').map(item => item.content), request.prompt]
      .slice(-3).map(text => text.slice(0, 500)),
    selectedFile: request.selectedFile,
    toolPaths: [...new Set(toolPaths)].slice(-8)
  };
}
