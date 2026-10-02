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

For OpenAI responses, set the key in the same terminal before starting:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:OPENAI_MODEL = "gpt-5.4"
npm.cmd start
```

The OpenAI agent can inspect files, edit them, create files or folders, and delete files or folders. Mutating actions are reviewed inline in the chat with **Reject**, **Allow once**, and **Always allow**. File changes show a contextual unified diff during review and retain it in the chat after the action succeeds, including for always-allowed actions. Always-allow applies to that action in the current folder and can be revoked from the gear icon in the agent pane. Unsaved editor changes are protected, and deleted folders are limited to 200 entries and 10 MB. Approved changes refresh the explorer and editor. Responses stream with Markdown and code-block formatting. Local inspection works without an API key. The key stays in the main process.

Chats are saved locally in Electron's user-data directory as `chats.json` (on Windows, normally `%APPDATA%\code-agent\chats.json`). Allowed actions are stored beside it in `permissions.json`. Use the clock icon to open recent chats. Each chat remembers its folder, but opening a chat does not automatically open or switch folders; select the matching folder to continue the conversation. The root `example.ts` test fixture was removed; tests use temporary workspaces.

## Verify

```powershell
npm.cmd test
```

The TypeScript/Electron project at the repository root is the active implementation.
