import path from 'node:path';
import { createHash } from 'node:crypto';
import { listFiles, readAgentFile } from '../workspace';
import { extractFacts, languageOf, type FileFacts, type RawBinding, type SymbolKind } from './extract';

export type Relation = 'contains' | 'imports' | 'calls' | 'uses' | 'extends' | 'implements';
// EXTRACTED: stated directly in source and resolved unambiguously. INFERRED: a heuristic guess with a score below 1.
export type Confidence = 'EXTRACTED' | 'INFERRED';

export interface GraphNode { id: string; name: string; kind: SymbolKind | 'file'; file: string; line: number; endLine: number; community: number; degree: number; exported: boolean }
export interface GraphEdge { from: string; to: string; rel: Relation; confidence: Confidence; score: number; count: number }
export interface Community { id: number; label: string; files: string[]; size: number; cohesion: number }
export interface CodeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  out: Map<string, GraphEdge[]>;
  inn: Map<string, GraphEdge[]>;
  communities: Community[];
  stats: { files: number; symbols: number; edges: number; extracted: number; inferred: number; truncated: boolean };
}

const maxFiles = 2000;
const buildDeadlineMs = 15_000;
const commonMembers = new Set(['map', 'filter', 'reduce', 'push', 'pop', 'join', 'split', 'slice', 'splice', 'then', 'catch', 'finally', 'get', 'set', 'has', 'add', 'delete', 'clear', 'keys', 'values', 'entries', 'forEach', 'some', 'every', 'find', 'includes', 'indexOf', 'trim', 'replace', 'test', 'exec', 'match', 'toString', 'startsWith', 'endsWith', 'call', 'apply', 'bind', 'log', 'error', 'warn', 'append', 'extend', 'update', 'items', 'format', 'read', 'write', 'close', 'open', 'send', 'on', 'off', 'emit', 'resolve', 'reject', 'all', 'parse', 'stringify']);
const relationWeight: Record<Relation, number> = { contains: 0, imports: 1, calls: 1, uses: 0.5, extends: 1.5, implements: 1 };

interface CacheEntry { hash: string; facts: FileFacts | null }
const caches = new Map<string, Map<string, CacheEntry>>();

export function clearGraphCache(): void { caches.clear(); }

async function loadFacts(root: string, files: string[], signal: AbortSignal): Promise<{ facts: Map<string, FileFacts>; truncated: boolean }> {
  let cache = caches.get(root);
  if (!cache) { cache = new Map(); caches.set(root, cache); if (caches.size > 3) caches.delete(caches.keys().next().value as string); }
  const facts = new Map<string, FileFacts>();
  const started = Date.now();
  let truncated = false;
  for (const file of files) {
    signal.throwIfAborted();
    if (Date.now() - started > buildDeadlineMs) { truncated = true; break; }
    const lang = languageOf(file);
    if (!lang) continue;
    let content: string;
    try { content = await readAgentFile(root, file); } catch { continue; }
    const hash = createHash('sha1').update(content).digest('hex');
    let entry = cache.get(file);
    if (!entry || entry.hash !== hash) {
      let extracted: FileFacts | null = null;
      try { extracted = extractFacts(content, lang); } catch { /* an unparsable file stays a bare file node */ }
      entry = { hash, facts: extracted };
      cache.set(file, entry);
    }
    if (entry.facts) facts.set(file, entry.facts);
  }
  for (const file of [...cache.keys()]) if (!files.includes(file)) cache.delete(file);
  return { facts, truncated };
}

interface SymbolRef { id: string; file: string; name: string; kind: SymbolKind; exported: boolean; isDefault: boolean; parent: string | null }

function resolveSpec(from: string, spec: string, lang: 'js' | 'py', known: Set<string>, names: string[]): string[] {
  const dir = path.posix.dirname(from);
  const found: string[] = [];
  const take = (candidate: string) => { const normalized = path.posix.normalize(candidate); if (known.has(normalized) && !found.includes(normalized)) found.push(normalized); };
  if (lang === 'js') {
    if (!spec.startsWith('.')) return found;
    const base = path.posix.join(dir, spec);
    const stripped = base.replace(/\.(m|c)?jsx?$/, '');
    for (const stem of [stripped, base]) for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '']) take(stem + extension);
    for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) take(`${base}/index${extension}`);
    return found;
  }
  const dots = /^\.*/.exec(spec)?.[0].length || 0;
  const parts = spec.slice(dots).split('.').filter(Boolean);
  const bases = dots ? [path.posix.join(dir, ...Array<string>(dots - 1).fill('..'))] : ['.', dir, 'src'];
  for (const base of bases) {
    const module = path.posix.join(base, ...parts);
    if (parts.length) { take(`${module}.py`); take(`${module}/__init__.py`); }
    else take(`${module}/__init__.py`);
    for (const name of names) { take(`${module}/${name}.py`); }
  }
  return found;
}

export async function buildCodeGraph(root: string, signal: AbortSignal): Promise<CodeGraph> {
  const listed = await listFiles(root, '.', maxFiles, signal);
  const { facts, truncated } = await loadFacts(root, listed, signal);
  const nodes = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const known = new Set(facts.keys());
  const topLevel = new Map<string, Map<string, SymbolRef[]>>(); // file -> name -> symbols
  const symbolIds = new Map<string, string[]>(); // file -> id per raw symbol index
  const methodsByName = new Map<string, SymbolRef[]>();
  const methodsByClass = new Map<string, Map<string, SymbolRef>>();

  for (const [file, fileFacts] of facts) {
    nodes.set(file, { id: file, name: path.posix.basename(file), kind: 'file', file, line: 1, endLine: fileFacts.lineCount, community: -1, degree: 0, exported: true });
    const ids: string[] = [];
    const used = new Set<string>();
    const table = new Map<string, SymbolRef[]>();
    fileFacts.symbols.forEach((symbol, index) => {
      const parentId = symbol.parent >= 0 ? ids[symbol.parent] : null;
      const qualified = parentId ? `${parentId.split('#')[1]}.${symbol.name}` : symbol.name;
      let id = `${file}#${qualified}`;
      if (used.has(id)) id = `${id}:${symbol.line}`;
      used.add(id); ids[index] = id;
      nodes.set(id, { id, name: parentId ? qualified : symbol.name, kind: symbol.kind, file, line: symbol.line, endLine: symbol.endLine, community: -1, degree: 0, exported: symbol.exported });
      const ref: SymbolRef = { id, file, name: symbol.name, kind: symbol.kind, exported: symbol.exported, isDefault: symbol.isDefault, parent: parentId };
      if (parentId) {
        methodsByName.set(symbol.name, [...(methodsByName.get(symbol.name) || []), ref]);
        const byClass = methodsByClass.get(parentId) || new Map<string, SymbolRef>();
        byClass.set(symbol.name, ref); methodsByClass.set(parentId, byClass);
      } else {
        table.set(symbol.name, [...(table.get(symbol.name) || []), ref]);
        if (symbol.kind === 'function') methodsByName.set(symbol.name, [...(methodsByName.get(symbol.name) || []), ref]);
      }
    });
    symbolIds.set(file, ids); topLevel.set(file, table);
  }

  const addEdge = (from: string, to: string, rel: Relation, confidence: Confidence, score = 1) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = `${from}\0${to}\0${rel}`;
    const existing = edgeMap.get(key);
    if (existing) { existing.count++; if (confidence === 'EXTRACTED' && existing.confidence === 'INFERRED') { existing.confidence = 'EXTRACTED'; existing.score = 1; } return; }
    edgeMap.set(key, { from, to, rel, confidence, score, count: 1 });
  };

  // Import bindings per file, resolved lazily through re-export chains.
  const importTargets = new Map<string, Map<string, { files: string[]; binding: RawBinding }>>();
  const fileImports = new Map<string, Set<string>>();
  for (const [file, fileFacts] of facts) {
    const bindings = new Map<string, { files: string[]; binding: RawBinding }>();
    const imported = new Set<string>();
    for (const item of fileFacts.imports) {
      const targets = resolveSpec(file, item.spec, fileFacts.lang, known, item.bindings.map(binding => binding.imported));
      for (const target of targets) { if (target !== file) { addEdge(file, target, 'imports', 'EXTRACTED'); imported.add(target); } }
      if (!item.reexport) for (const binding of item.bindings) bindings.set(binding.local, { files: targets, binding });
    }
    importTargets.set(file, bindings); fileImports.set(file, imported);
  }

  const resolveExport = (file: string, name: string, depth = 0): SymbolRef | null => {
    const table = topLevel.get(file);
    const direct = (table?.get(name) || []).find(symbol => symbol.exported || facts.get(file)?.lang === 'py') || (name === 'default' ? [...(table?.values() || [])].flat().find(symbol => symbol.isDefault) : undefined);
    if (direct) return direct;
    if (depth >= 3) return null;
    for (const item of facts.get(file)?.imports || []) {
      if (!item.reexport) continue;
      const targets = resolveSpec(file, item.spec, facts.get(file)!.lang, known, item.bindings.map(binding => binding.imported));
      const binding = item.bindings.find(candidate => candidate.local === name) || item.bindings.find(candidate => candidate.local === '*');
      if (!binding) continue;
      for (const target of targets) { const found = resolveExport(target, binding.local === '*' ? name : binding.imported, depth + 1); if (found) return found; }
    }
    return null;
  };

  const resolveName = (file: string, name: string): SymbolRef | null => {
    const local = topLevel.get(file)?.get(name)?.[0];
    if (local) return local;
    const imported = importTargets.get(file)?.get(name);
    if (!imported || imported.binding.imported === '*') return null;
    for (const target of imported.files) { const found = resolveExport(target, imported.binding.imported); if (found) return found; }
    return null;
  };

  const classMethod = (classId: string, name: string, facts_: Map<string, FileFacts>, depth = 0): SymbolRef | null => {
    const direct = methodsByClass.get(classId)?.get(name);
    if (direct) return direct;
    if (depth >= 4) return null;
    for (const edge of out(classId)) if (edge.rel === 'extends') { const found = classMethod(edge.to, name, facts_, depth + 1); if (found) return found; }
    return null;
  };
  const adjacency = new Map<string, GraphEdge[]>();
  const out = (id: string) => adjacency.get(id) || [];

  // Containment and inheritance first so method lookup can follow base classes.
  for (const [file, fileFacts] of facts) {
    const ids = symbolIds.get(file)!;
    fileFacts.symbols.forEach((symbol, index) => addEdge(symbol.parent >= 0 ? ids[symbol.parent] : file, ids[index], 'contains', 'EXTRACTED'));
    for (const item of fileFacts.heritage) {
      const target = resolveName(file, item.name);
      if (target && ids[item.symbol]) addEdge(ids[item.symbol], target.id, item.rel, 'EXTRACTED');
    }
  }
  for (const edge of edgeMap.values()) adjacency.set(edge.from, [...out(edge.from), edge]);

  for (const [file, fileFacts] of facts) {
    const ids = symbolIds.get(file)!;
    const imports = fileImports.get(file) || new Set<string>();
    for (const ref of fileFacts.refs) {
      const from = ref.symbol >= 0 ? ids[ref.symbol] : file;
      const rel: Relation = ref.call ? 'calls' : 'uses';
      if (!ref.member) {
        const target = resolveName(file, ref.name);
        if (target) addEdge(from, target.id, rel, 'EXTRACTED');
        continue;
      }
      const receiver = ref.receiver;
      const containing = ref.symbol >= 0 ? (nodes.get(from)?.id.split('#')[1] || '').split('.')[0] : '';
      if ((receiver === 'this' || receiver === 'self' || receiver === 'cls') && containing) {
        const target = classMethod(`${file}#${containing}`, ref.name, facts);
        if (target) { addEdge(from, target.id, 'calls', 'EXTRACTED'); continue; }
      }
      if (receiver) {
        const namespace = importTargets.get(file)?.get(receiver);
        if (namespace?.binding.imported === '*') {
          let found: SymbolRef | null = null;
          for (const target of namespace.files) { found = resolveExport(target, ref.name); if (found) break; }
          if (found) { addEdge(from, found.id, 'calls', 'EXTRACTED'); continue; }
        }
        const holder = resolveName(file, receiver);
        if (holder?.kind === 'class') {
          const target = classMethod(holder.id, ref.name, facts);
          if (target) { addEdge(from, target.id, 'calls', 'EXTRACTED'); continue; }
        }
        if (namespace && namespace.binding.imported === '*' || receiver === 'this' || receiver === 'self') continue;
      }
      if (commonMembers.has(ref.name) || ref.name.length < 4) continue;
      const candidates = (methodsByName.get(ref.name) || []).filter(candidate => candidate.id !== from);
      if (candidates.length === 1) addEdge(from, candidates[0].id, 'calls', 'INFERRED', imports.has(candidates[0].file) || candidates[0].file === file ? 0.7 : 0.4);
      else if (candidates.length > 1) {
        const near = candidates.filter(candidate => imports.has(candidate.file) || candidate.file === file);
        if (near.length === 1) addEdge(from, near[0].id, 'calls', 'INFERRED', 0.6);
      }
    }
  }

  const edges = [...edgeMap.values()];
  const out_ = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    out_.set(edge.from, [...(out_.get(edge.from) || []), edge]);
    inn.set(edge.to, [...(inn.get(edge.to) || []), edge]);
    if (edge.rel !== 'contains') { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  }
  const communities = detectCommunities(nodes, edges);
  const inferred = edges.filter(edge => edge.confidence === 'INFERRED').length;
  return {
    nodes, edges, out: out_, inn, communities,
    stats: { files: facts.size, symbols: nodes.size - facts.size, edges: edges.length, extracted: edges.length - inferred, inferred, truncated: truncated || listed.length >= maxFiles }
  };
}

// Weighted label propagation over the file-level projection of the graph. Symbols inherit their file's community.
function detectCommunities(nodes: Map<string, GraphNode>, edges: GraphEdge[]): Community[] {
  const files = [...nodes.values()].filter(node => node.kind === 'file').map(node => node.id).sort();
  const weights = new Map<string, Map<string, number>>(files.map(file => [file, new Map()]));
  for (const edge of edges) {
    if (edge.rel === 'contains') continue;
    const a = nodes.get(edge.from)!.file; const b = nodes.get(edge.to)!.file;
    if (a === b) continue;
    const weight = relationWeight[edge.rel] * (edge.confidence === 'INFERRED' ? edge.score : 1);
    weights.get(a)!.set(b, (weights.get(a)!.get(b) || 0) + weight);
    weights.get(b)!.set(a, (weights.get(b)!.get(a) || 0) + weight);
  }
  const label = new Map(files.map((file, index) => [file, index]));
  for (let round = 0; round < 30; round++) {
    let changed = false;
    for (const file of files) {
      const tally = new Map<number, number>();
      for (const [neighbor, weight] of weights.get(file)!) tally.set(label.get(neighbor)!, (tally.get(label.get(neighbor)!) || 0) + weight);
      if (!tally.size) continue;
      let best = label.get(file)!; let bestWeight = tally.get(best) || 0;
      for (const [candidate, weight] of [...tally].sort((a, b) => a[0] - b[0])) if (weight > bestWeight + 1e-9) { best = candidate; bestWeight = weight; }
      if (best !== label.get(file)) { label.set(file, best); changed = true; }
    }
    if (!changed) break;
  }
  let groups = new Map<number, string[]>();
  for (const file of files) groups.set(label.get(file)!, [...(groups.get(label.get(file)!) || []), file]);
  // Label propagation can collapse a tightly linked codebase into one blob; split oversized groups by directory.
  const split = new Map<string, string[]>();
  for (const [key, members] of groups) {
    if (members.length > 12 && members.length > files.length * 0.6) {
      for (const file of members) { const bucket = `${key}:${file.split('/').slice(0, Math.min(2, file.split('/').length - 1)).join('/')}`; split.set(bucket, [...(split.get(bucket) || []), file]); }
    } else split.set(String(key), members);
  }
  const ordered = [...split.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  groups = new Map(ordered.map((members, index) => [index, members]));
  const communityOf = new Map<string, number>();
  for (const [id, members] of groups) for (const file of members) communityOf.set(file, id);
  for (const node of nodes.values()) node.community = communityOf.get(node.file) ?? 0;
  const internal = new Map<number, number>(); const total = new Map<number, number>();
  for (const [file, neighbors] of weights) for (const [neighbor, weight] of neighbors) {
    const community = communityOf.get(file)!;
    total.set(community, (total.get(community) || 0) + weight);
    if (communityOf.get(neighbor) === community) internal.set(community, (internal.get(community) || 0) + weight);
  }
  return [...groups].map(([id, members]) => ({
    id, files: members, size: members.length,
    label: communityLabel(members, nodes),
    cohesion: total.get(id) ? Math.round(((internal.get(id) || 0) / total.get(id)!) * 100) / 100 : 1
  }));
}

function communityLabel(members: string[], nodes: Map<string, GraphNode>): string {
  const dirs = new Map<string, number>();
  for (const file of members) { const dir = path.posix.dirname(file); dirs.set(dir, (dirs.get(dir) || 0) + 1); }
  const [dir] = [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const top = [...nodes.values()].filter(node => node.kind !== 'file' && members.includes(node.file)).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0];
  const place = dir === '.' ? 'root' : dir;
  return top ? `${place} (${top.name})` : place;
}
