# Task-relevant workspace retrieval

Before a new OpenAI run, the Electron main process selects up to four on-disk file excerpts. This is a small local, deterministic retrieval step and not an external vector index or a replacement for the agent's `glob_files`, `search_text`, and `read_file` tools. The [official OpenAI Docs](https://developers.openai.com/api/docs/guides/prompt-engineering) recommend adding relevant context rather than filling a model's context window indiscriminately.

## Selection and provenance

- The selected editor file has highest priority when it is safe and readable. Otherwise, the prompt's distinctive words rank file names and paths; matching source lines can surface files with less obvious names.
- The main process re-reads files from disk for each run. It sends short line-numbered excerpts with workspace-relative paths, not a stale index or unsaved Monaco content. The chat records source paths and line ranges, so users can inspect what informed the request; excerpt text itself is not duplicated in chat storage.
- Retrieved content is labeled as untrusted source data in a higher-priority instruction and in the request. A file's text cannot grant tool permission or override the approval flow. The agent should verify a file again before editing it.

## Bounds and exclusions

The scan considers at most 2,000 workspace files, reads at most 160 ranked candidates, and stops after five seconds. Existing workspace helpers reject symlinks, traversal, binary files, and files over 100 KB. Generated/dependency directories are skipped. The request includes at most four excerpts of 2,500 characters each. Automatic retrieval excludes common credential and secret filenames, certificates, lockfiles, and source maps. This is a conservative filter, **not** a complete secret detector; the future security milestone should add content-level redaction and controls for network disclosure.

If no suitable excerpt is found, the request continues without one and the agent can still use search/read tools. A scan limited to the first 2,000 files or 160 candidates can miss relevant material; the source list is evidence of what was sent, not a claim that retrieval was exhaustive. Tests cover ranking, current disk snapshots, sensitive/binary/large-file exclusions, cancellation, bounds, model-request inclusion, and chat restoration. Real-task retrieval quality and cost should be evaluated before adding indexing or semantic retrieval.

## Evaluation-informed direction

Repository-task evaluations confirmed that lexical retrieval can miss primary implementation files even when secondary documentation or tests still support a useful answer. Small stemming and source-file-reservation experiments shifted the omissions instead of improving them consistently, so the shipped ranker remains unchanged. Broaden the labeled task set and compare a small semantic or hybrid pilot before changing retrieval globally or introducing an index.

Evaluation runs must use a clean temporary workspace that excludes their own prompts and expected labels. Otherwise the benchmark can retrieve its own answer key and produce invalid results. Detailed run records, model outputs, timings, and token usage are local evaluation artifacts rather than durable product documentation.
