import type { CodeGraph, GraphEdge, GraphNode } from './build';

const maxOutput = 12_000;
const stopwords = new Set(['about', 'and', 'are', 'does', 'how', 'the', 'what', 'where', 'which', 'who', 'why', 'with', 'work', 'works', 'use', 'used', 'uses', 'code', 'file', 'files', 'function', 'class', 'find', 'show', 'for', 'from', 'that', 'this', 'into', 'between', 'connected', 'connect', 'relate', 'related']);

const place = (node: GraphNode) => node.kind === 'file' ? node.id : `${node.file}:${node.line}`;
const label = (node: GraphNode) => node.kind === 'file' ? node.id : `${node.name} (${node.kind}, ${place(node)})`;
const short = (node: GraphNode) => node.kind === 'file' ? node.id : node.name;
const edgeText = (graph: CodeGraph, edge: GraphEdge) => {
  const confidence = edge.confidence === 'INFERRED' ? ` INFERRED ${edge.score}` : '';
  return `${short(graph.nodes.get(edge.from)!)} --${edge.rel}--> ${short(graph.nodes.get(edge.to)!)}${confidence}`;
};

function words(text: string): string[] {
  return [...new Set((text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map(word => word.toLowerCase()).filter(word => !stopwords.has(word)))];
}

function score(node: GraphNode, terms: string[], identifiers: Set<string>): number {
  const name = node.name.toLowerCase();
  const tokens = words(node.name.replace(/\.[a-z]+$/, ''));
  const file = node.file.toLowerCase();
  let total = identifiers.has(node.name) || identifiers.has(node.name.split('.').pop() || '') ? 12 : 0;
  for (const term of terms) {
    if (name === term) total += 10;
    else if (tokens.includes(term)) total += 6;
    else if (name.includes(term)) total += 4;
    else if (file.includes(term)) total += node.kind === 'file' ? 2.5 : 1;
  }
  return node.kind === 'file' ? total * 0.8 : total;
}

export function findNodes(graph: CodeGraph, text: string, limit: number): { node: GraphNode; score: number }[] {
  const terms = words(text);
  const identifiers = new Set(text.match(/[A-Za-z_$][\w$.]*/g) || []);
  return [...graph.nodes.values()].map(node => ({ node, score: score(node, terms, identifiers) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.node.degree - a.node.degree || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}

function neighbors(graph: CodeGraph, id: string): { edge: GraphEdge; other: string }[] {
  const result: { edge: GraphEdge; other: string }[] = [];
  for (const edge of graph.out.get(id) || []) result.push({ edge, other: edge.to });
  for (const edge of graph.inn.get(id) || []) result.push({ edge, other: edge.from });
  return result;
}

export function overviewText(graph: CodeGraph): string {
  const { stats } = graph;
  if (!stats.files) return 'No supported source files found (TypeScript, JavaScript, Python).';
  const lines = [`Code graph: ${stats.files} files, ${stats.symbols} symbols, ${stats.edges} relationships (${stats.extracted} extracted, ${stats.inferred} inferred).${stats.truncated ? ' The scan was truncated.' : ''}`, ''];
  const gods = [...graph.nodes.values()].filter(node => node.kind !== 'file' && node.degree > 0).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)).slice(0, 10);
  lines.push('Most connected symbols (the architecture hubs):');
  for (const node of gods) lines.push(`- ${label(node)} — ${node.degree} links`);
  lines.push('', 'Communities (files that change and call together):');
  const multi = graph.communities.filter(community => community.size > 1);
  for (const community of multi.slice(0, 12)) {
    const members = [...graph.nodes.values()].filter(node => node.community === community.id && node.kind !== 'file').sort((a, b) => b.degree - a.degree).slice(0, 4).map(node => node.name);
    lines.push(`- [${community.id}] ${community.label}: ${community.size} file${community.size === 1 ? '' : 's'}, cohesion ${community.cohesion}${members.length ? `; key: ${members.join(', ')}` : ''}`);
  }
  const hidden = graph.communities.length - Math.min(12, multi.length);
  if (hidden > 0) lines.push(`- ... and ${hidden} single-file or smaller communities`);
  const bridges = graph.edges.filter(edge => edge.rel !== 'contains' && edge.rel !== 'imports' && graph.nodes.get(edge.from)!.community !== graph.nodes.get(edge.to)!.community)
    .sort((a, b) => (a.confidence === 'INFERRED' ? 0 : 1) - (b.confidence === 'INFERRED' ? 0 : 1) || b.count - a.count).slice(0, 6);
  if (bridges.length) {
    lines.push('', 'Cross-community connections (surprising couplings worth knowing):');
    for (const edge of bridges) lines.push(`- ${edgeText(graph, edge)} [${graph.nodes.get(edge.from)!.community} → ${graph.nodes.get(edge.to)!.community}]`);
  }
  lines.push('', 'Use graph_query to explore around a concept, graph_path to connect two symbols, then read_file for the exact code.');
  return lines.join('\n').slice(0, maxOutput);
}

export function queryText(graph: CodeGraph, question: string, depth = 2, limit = 30): string {
  if (!graph.stats.files) return 'No supported source files found (TypeScript, JavaScript, Python).';
  const maxDepth = Math.max(1, Math.min(3, Math.trunc(depth)));
  const budget = Math.max(5, Math.min(80, Math.trunc(limit)));
  const seeds = findNodes(graph, question, 4);
  if (!seeds.length) return `No graph nodes match "${question.slice(0, 100)}". Try a symbol or file name, or use search_text.`;
  const visited = new Map<string, number>(seeds.map(seed => [seed.node.id, 0]));
  const shown: GraphEdge[] = []; const shownKeys = new Set<string>();
  let frontier = seeds.map(seed => seed.node.id);
  for (let level = 1; level <= maxDepth && frontier.length && visited.size < budget; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = graph.nodes.get(id)!;
      const options = neighbors(graph, id)
        .filter(({ edge }) => node.kind === 'file' ? edge.rel === 'contains' || edge.rel === 'imports' : edge.rel !== 'contains' || edge.to === id)
        .filter(({ edge }) => !(node.kind === 'file' && edge.rel === 'contains' && level > 1))
        .sort((a, b) => (a.edge.confidence === b.edge.confidence ? 0 : a.edge.confidence === 'EXTRACTED' ? -1 : 1) || graph.nodes.get(b.other)!.degree - graph.nodes.get(a.other)!.degree || a.other.localeCompare(b.other))
        .slice(0, 8);
      for (const { edge, other } of options) {
        if (visited.size >= budget && !visited.has(other)) continue;
        const key = `${edge.from}\0${edge.to}\0${edge.rel}`;
        if (!shownKeys.has(key)) { shownKeys.add(key); if (edge.rel !== 'contains') shown.push(edge); }
        if (!visited.has(other)) { visited.set(other, level); next.push(other); }
      }
    }
    frontier = next;
  }
  const lines = [`Graph query "${question.slice(0, 100)}" — ${visited.size} nodes, ${shown.length} relationships (depth ${maxDepth}).`, '', 'Nodes (closest first):'];
  for (const [id, level] of [...visited].sort((a, b) => a[1] - b[1])) {
    const node = graph.nodes.get(id)!;
    lines.push(`- ${level === 0 ? '* ' : ''}${label(node)} [community ${node.community}]`);
  }
  lines.push('', 'Relationships:');
  for (const edge of shown) lines.push(`- ${edgeText(graph, edge)}`);
  lines.push('', '* marks the best matches. Read the listed file:line locations to confirm behavior; INFERRED links are heuristic.');
  return lines.join('\n').slice(0, maxOutput);
}

export function pathText(graph: CodeGraph, fromText: string, toText: string): string {
  const from = findNodes(graph, fromText, 1)[0]?.node;
  const to = findNodes(graph, toText, 1)[0]?.node;
  if (!from) return `No graph node matches "${fromText.slice(0, 100)}".`;
  if (!to) return `No graph node matches "${toText.slice(0, 100)}".`;
  if (from.id === to.id) return `Both ends resolve to ${label(from)}.`;
  const previous = new Map<string, { id: string; edge: GraphEdge } | null>([[from.id, null]]);
  let frontier = [from.id];
  for (let hop = 0; hop < 8 && frontier.length && !previous.has(to.id); hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const { edge, other } of neighbors(graph, id)) {
      if (previous.has(other)) continue;
      previous.set(other, { id, edge }); next.push(other);
    }
    frontier = next;
  }
  if (!previous.has(to.id)) return `No path within 8 hops between ${label(from)} and ${label(to)}.`;
  const chain: GraphEdge[] = [];
  for (let step = previous.get(to.id); step; step = previous.get(step.id)) chain.unshift(step.edge);
  return [`Path from ${label(from)} to ${label(to)} (${chain.length} hop${chain.length === 1 ? '' : 's'}):`, ...chain.map(edge => `- ${edgeText(graph, edge)}`)].join('\n').slice(0, maxOutput);
}
