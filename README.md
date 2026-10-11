# Code Agent

A desktop coding-agent workspace built with TypeScript, Electron, React, and Monaco. The explorer and code editor are local; repository access, agent tools, and model requests run in Electron's main process.

## Run

Requires Node.js 22 or newer. On this Windows setup, use `npm.cmd` because PowerShell blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd start
```

Use the native **File** menu to open a folder, create a file or folder, save, or close an editor. **Edit**, **View**, and **Window** contain standard editing, pane, zoom, and window commands. Select a file in the explorer to edit it in Monaco. Unsaved tabs are marked and protected by discard prompts; saving refuses to overwrite a file that changed on disk.

The agent pane shows detailed, expandable tool activity. When the model returns an optional reasoning summary, it appears in a collapsible section. Raw model reasoning is not available through the API.

For OpenAI responses, select **OpenAI** and use the key button in the agent header. The key is sent through Electron's isolated IPC to the main process, encrypted with Electron `safeStorage` (the operating system's credential protection), and saved in the app user-data directory. Only key availability is returned to the renderer; the plaintext key is never stored in chat history or browser storage. A saved key takes precedence over `OPENAI_API_KEY`.

Choose the OpenAI model from the fixed selector beside the active file name in the message composer. Model names cannot be entered manually.

You can alternatively set a key in the same terminal before starting:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:OPENAI_MODEL = "gpt-5.4"
npm.cmd start
```

The OpenAI agent can list, glob, search, and read files; inspect structured Git status and bounded staged or unstaged diffs; edit files; create or delete files and folders; run approved standard package diagnostics; and run approved workspace commands. Search and Git inspection tools are read-only and bounded by file, result, output, and time limits. Diagnostics only select an existing `typecheck`, `check`, `lint`, `test`, or `build` package script and require approval every time because project scripts can execute arbitrary code. General commands run an executable directly with a separate argument array rather than through an implicit shell, require approval every time, use a workspace-contained working directory, stream bounded output, and stop on cancellation or timeout. Mutating file actions are reviewed inline in the chat with **Reject**, **Allow once**, and **Always allow**. File changes show a contextual unified diff during review and retain it in the chat after the action succeeds, including for always-allowed actions. Always-allow applies to that file action in the current folder and can be revoked from the gear icon in the agent pane. Unsaved editor changes are protected, and deleted folders are limited to 200 entries and 10 MB. Approved changes refresh the explorer and editor. Responses stream with Markdown and code-block formatting. Local inspection works without an API key. Model requests and secrets stay in the main process.

The explorer and agent panes are resizable and collapsible from their headers. Their reveal buttons remain in the editor tab bar while collapsed. Right-click an explorer item to open it, save an open file, copy its relative path, create a file or folder beside it, close its editor, or delete it after confirmation. Deletion refuses affected unsaved files and rechecks the target after confirmation. Use explorer refresh after files change outside the app, such as from Git, a terminal, another editor, or a build tool.

Chats are saved locally in Electron's user-data directory as `chats.json` (on Windows, normally `%APPDATA%\code-agent\chats.json`). Allowed actions are stored beside it in `permissions.json`. Use the clock icon to open recent chats. Each chat remembers its folder, but opening a chat does not automatically open or switch folders; select the matching folder to continue the conversation. The root `example.ts` test fixture was removed; tests use temporary workspaces.

The context indicator above the OpenAI composer shows input tokens for the latest model request. `~` marks a local estimate; the API-reported count replaces it when the response completes. Click it to set a working budget and warning/compaction percentages. The budget is a planning preference, not the model's hard context limit. OpenAI automatically compacts an active response chain when its rendered context crosses the configured threshold. The indicator records completed compactions and shows a local checkpoint of recent visible requests and tool paths; this is **not** the provider's opaque internal summary. New runs send up to the last 12 non-error chat messages (each capped at 10,000 characters), the new prompt, bounded relevant on-disk file excerpts, and matching user-saved project-memory items—not unsaved editor buffers. The agent pane lists file sources and memory topics included in the request. Project memory can be added, corrected, disabled, or deleted from the brain icon; it is local and **not encrypted**, so do not put secrets there. Obvious credential patterns are rejected on save and filtered from older memories before model selection, but this cannot detect every secret. Within a run, OpenAI retains prior turns through `previous_response_id`, including tool calls and bounded tool results. The full visible chat remains locally saved, but it is not all sent to the model. See [context-management.md](docs/concepts/context-management.md), [retrieval.md](docs/concepts/retrieval.md), and [project-memory.md](docs/concepts/project-memory.md) for the design and limits.

## Verify

```powershell
npm.cmd test
```

The TypeScript/Electron project at the repository root is the active implementation.
