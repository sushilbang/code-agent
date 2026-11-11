# Changelog

All notable changes to Code Agent. The Windows build is unsigned and has no
auto-update, so check the version in the installer filename against this list.

## [0.2.0] - 2026-11-11

### Added
- Claude provider alongside OpenAI, a multi-model catalog, and per-provider API keys.
- Code knowledge graph tools the agent can use to explore a repository.
- Quick Open (Ctrl+P) fuzzy file search.
- Read-only sub-agents with dependency graphs, lifecycle shown in the chat
  timeline, and a run-wide token budget.
- Retrieval evaluation and project memory.

### Changed
- Workbench restyled to look like VS Code, with a reworked agent pane.
- Violet theme across the app, Monaco editor and icon.
- Rebuilt installer on 2026-11-11 under the same version number
  (SHA-256 `53b9f19f07503a6b95ead291d95ff97a2ccca76c5dbd0e4e811b8cbf4a098bf1`).

### Security
- Bumped dompurify to 3.4.17 and electron, vite and undici patches to fix
  `npm audit` findings.

### Site
- Landing page at code-agent.sushilbang.com with rate-limited, range-capable
  downloads served from R2.
