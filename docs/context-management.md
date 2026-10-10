# Context and memory design

## Research conclusions

There is no single memory mechanism that does every job well. Use three layers:

1. **Active model context:** send only the recent conversation and relevant workspace material. Long input alone does not guarantee reliable recall: [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) finds that relevant facts buried in the middle of long contexts are often harder to use. Retrieval should select files/snippets for the task rather than fill the window indiscriminately; see [Retrieval-Augmented Generation](https://papers.neurips.cc/paper/2020/file/6b493230205f780e1bc26945df7481e5-Paper.pdf).
2. **Compacted working memory:** when an active run grows, preserve state needed to continue. This app uses [server-side compaction](https://developers.openai.com/api/docs/guides/compaction) with `previous_response_id`; it does not manually truncate a provider-managed response chain. The resulting encrypted state is opaque, so the visible local checkpoint must not be mistaken for a faithful summary of what the model retained.
3. **Durable memory:** store selected project facts and decisions across chats with source/provenance and a way to revise or forget stale facts. Do not treat a running summary as a permanent truth. [LongMemEval](https://arxiv.org/abs/2410.10813) highlights extraction, temporal changes, multi-session reasoning, and abstention as distinct challenges. [MemGPT](https://arxiv.org/abs/2310.08560) motivates separating fast working context from slower archival memory.

Measure actual usage where available. The [Responses API](https://developers.openai.com/api/docs/guides/conversation-state) reports usage and can carry conversation state via `previous_response_id`. The [input-token counting endpoint](https://developers.openai.com/api/docs/guides/token-counting) can preflight a complete request; a local bytes-per-token estimate cannot account precisely for model tokenization, tool schemas, cached state, or provider framing.

## Current implementation

- The renderer sends up to 12 recent non-error visible messages, each capped at 10,000 characters, plus the new prompt and selected file **path**. The main process retrieves a few relevant on-disk file excerpts with path/line provenance for the first request; unsaved editor buffers are never inserted automatically. See [retrieval.md](retrieval.md). The main-process agent adds instructions and tool definitions; later tool turns use `previous_response_id` and bounded tool outputs.
- Before each request, the main process emits an approximate input-token count. On `response.completed`, it emits the API-reported input/output count if present. The latest count and its source are saved with the chat; no hidden reasoning is saved for this feature.
- The composer shows the latest request's input count against a configurable working budget. Each OpenAI request passes the configured compaction threshold (`workingBudgetTokens × compactionPercent / 100`) to the Responses API. The provider decides when its rendered context crosses that threshold and compacts within the same response. This is a target, not a hard request cap; API usage after compaction may still reflect tokens processed before it.
- A completed compaction item in the response stream triggers a visible event and a locally saved checkpoint containing up to three recent user requests, the selected file path, and up to eight tool paths. The checkpoint contains only visible activity. It does **not** expose or replace the provider's encrypted compaction state. That state remains in the provider-managed chain and is not saved locally.
- The full local chat transcript is distinct from model context. Restored usage is the last known request's count, not a prediction of a future request.
- Cancellation or an incomplete response does not create a local compaction checkpoint. A restarted run begins from recent visible chat history, not from the prior run's opaque provider state. The response chain is continued only within the active run.

## Next milestone

Add task-relevant file retrieval and a durable, reviewable project memory layer with provenance and user controls. Before claiming reliable retention across compaction, evaluate long tool-result sequences, changing constraints, and restart behavior with real model runs; mocked stream tests only verify wiring and state handling.
