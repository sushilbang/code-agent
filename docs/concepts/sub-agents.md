# Read-only sub-agents

The parent OpenAI agent has a `delegate_investigations` tool for two or three repository questions. A legacy `tasks` string array starts independent investigations together. A `graph` array gives tasks IDs, questions, and optional `dependsOn` IDs. Ready tasks run together; a dependent task starts only after all prerequisites complete. The parent remains responsible for synthesis and the final user response.

Graph input is validated before execution: IDs must be unique, dependencies must exist, and cycles are rejected. A failed prerequisite causes its dependents to be skipped. A dependent child receives at most 1,500 characters from each prerequisite report as explicitly untrusted context and still has its own retrieval, response chain, and read-only tools.

## Isolation and permissions

Each investigation starts with its own task, locally retrieved excerpts, response chain, and tool loop. It does not inherit the parent chat history, project memories, previous response ID, or another sub-agent's output. Its tool registry contains only file listing/reading, bounded glob and text search, and read-only Git status/diff inspection.

Sub-agents cannot write or delete files, execute commands or diagnostics, request approvals, delegate recursively, or send renderer events directly. They share the parent's cancellation signal, so stopping the parent stops all active investigations.

## Bounds and aggregation

- One delegation contains two or three tasks, each question capped at 500 characters.
- Investigations run concurrently with at most three active for one delegation.
- Each investigation has at most six model turns and an 800-token output cap per turn.
- A final report is capped at 4,000 characters, and the combined tool result is capped at 14,000 characters.
- API-reported input and output usage is accumulated per investigation and returned with the report.
- One failed investigation is reported alongside successful siblings; downstream tasks are skipped and cancellation still stops the entire delegation.
- The parent emits per-child queued, running, completed, failed, skipped, or cancelled events. The delegation tool entry shows a compact timeline with task, dependencies, latest status, time, and reported token usage; it is saved with the chat.
- One token budget is shared by every sub-agent request in a parent run, including later delegations. The default is 20,000 tokens; the context preferences dialog accepts 4,000–200,000. Before each concurrent model request, the main process reserves estimated input plus the 800-token output cap. API-reported input and output usage replace the reservation when available. If the remainder cannot cover a reservation, that child reports a budget failure without starting a request. Missing usage keeps the estimate charged. A response can exceed its reservation, so this is a spending guard rather than an exact hard cap. The delegation entry displays the run's current use and limit.

## Process and IPC boundary

Sub-agents are concurrent async functions inside Electron's main process, not separate operating-system processes or windows. Each function makes its own OpenAI requests and executes its own restricted tool loop. Network and file I/O can overlap while JavaScript scheduling remains in the main process. The parent runner invokes the delegation tool directly; child-to-parent results and budget accounting are in-process function calls.

The renderer (React UI) communicates with the main process through Electron inter-process communication (IPC). The context-isolated preload exposes a small typed `window.codeAgent` API, which uses `ipcRenderer.invoke('agent:start', request)`. `ipcMain.handle('agent:start', ...)` in `main.ts` validates the request and starts the parent run. The main process sends progress back over `agent:event`; preload subscribes and forwards those events to the renderer. `ipcMain` is Electron's main-process IPC endpoint, not a separate process called “mainIPC.” No child has its own IPC channel to the renderer.

Edit-capable delegation and overlapping-file conflict handling remain future work.
