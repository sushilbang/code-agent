# Read-only sub-agents

The parent OpenAI agent has a `delegate_investigations` tool for two or three genuinely independent repository questions. The tool starts those investigations concurrently and returns their reports to the parent, which remains responsible for synthesis and the final user response.

## Isolation and permissions

Each investigation starts with its own task, locally retrieved excerpts, response chain, and tool loop. It does not inherit the parent chat history, project memories, previous response ID, or another sub-agent's output. Its tool registry contains only file listing/reading, bounded glob and text search, and read-only Git status/diff inspection.

Sub-agents cannot write or delete files, execute commands or diagnostics, request approvals, delegate recursively, or send renderer events directly. They share the parent's cancellation signal, so stopping the parent stops all active investigations.

## Bounds and aggregation

- One delegation contains two or three tasks, each capped at 500 characters.
- Investigations run concurrently with at most three active for one delegation.
- Each investigation has at most six model turns and an 800-token output cap per turn.
- A final report is capped at 4,000 characters, and the combined tool result is capped at 14,000 characters.
- API-reported input and output usage is accumulated per investigation and returned with the report.
- One failed investigation is reported alongside successful siblings; cancellation still stops the entire delegation.

This first increment intentionally supports read-only fan-out rather than a general autonomous agent graph. Dependency-aware scheduling, run-wide cost budgets, visible per-child lifecycle events, persisted timelines, and any edit-capable delegation remain future work.
