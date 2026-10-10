# Context and memory design

## Research conclusions

There is no single memory mechanism that does every job well. Use three layers:

1. **Active model context:** send only the recent conversation and relevant workspace material. Long input alone does not guarantee reliable recall: [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) finds that relevant facts buried in the middle of long contexts are often harder to use. Retrieval should select files/snippets for the task rather than fill the window indiscriminately; see [Retrieval-Augmented Generation](https://papers.neurips.cc/paper/2020/file/6b493230205f780e1bc26945df7481e5-Paper.pdf).
2. **Compacted working memory:** when an active run grows, preserve task goals, constraints, decisions, pending work, file references, and unresolved questions in a compact continuation. For this OpenAI Responses integration, [server-side compaction](https://developers.openai.com/api/docs/guides/compaction) with `previous_response_id` is the best first implementation. Avoid manually truncating a provider-managed response chain. Keep a visible summary/checkpoint for human verification, and evaluate it against the full transcript.
3. **Durable memory:** store selected project facts and decisions across chats with source/provenance and a way to revise or forget stale facts. Do not treat a running summary as a permanent truth. [LongMemEval](https://arxiv.org/abs/2410.10813) highlights extraction, temporal changes, multi-session reasoning, and abstention as distinct challenges. [MemGPT](https://arxiv.org/abs/2310.08560) motivates separating fast working context from slower archival memory.

Measure actual usage where available. The [Responses API](https://developers.openai.com/api/docs/guides/conversation-state) reports usage and can carry conversation state via `previous_response_id`. The [input-token counting endpoint](https://developers.openai.com/api/docs/guides/token-counting) can preflight a complete request; a local bytes-per-token estimate cannot account precisely for model tokenization, tool schemas, cached state, or provider framing.

## Current implementation

- The renderer sends up to 12 recent non-error visible messages, each capped at 10,000 characters, plus the new prompt and selected file **path**. The editor buffer is not automatically inserted. The main-process agent adds instructions and tool definitions; later tool turns use `previous_response_id` and bounded tool outputs.
- Before each request, the main process emits an approximate input-token count. On `response.completed`, it emits the API-reported input/output count if present. The latest count and its source are saved with the chat; no hidden reasoning is saved for this feature.
- The composer shows the latest request's input count against a configurable working budget. Warning and compaction-target settings change the indicator only. They do not yet limit requests, compact context, or change what the model receives.
- The full local chat transcript is distinct from model context. Restored usage is the last known request's count, not a prediction of a future request.

## Next milestone

Implement automatic compaction in the main-process Responses chain, with a clear checkpoint/summary and recovery path. Test long tool-result sequences, retained task constraints, conflicting updates, cancellation, restart behavior, and API usage accounting. Then add task-relevant file retrieval and separate durable project memory with provenance and user controls.
