// Dependency-free structural extraction. Reads source text only; never executes it.
// Each file yields symbols (nodes), imports, and name references that the builder resolves into edges.

export type Lang = 'js' | 'py';
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method';

export interface RawSymbol { name: string; kind: SymbolKind; line: number; endLine: number; parent: number; exported: boolean; isDefault: boolean; indent: number }
export interface RawRef { symbol: number; name: string; receiver?: string; call: boolean; member: boolean }
export interface RawBinding { local: string; imported: string }
export interface RawImport { spec: string; bindings: RawBinding[]; reexport: boolean }
export interface RawHeritage { symbol: number; rel: 'extends' | 'implements'; name: string }
export interface FileFacts { lang: Lang; lineCount: number; symbols: RawSymbol[]; refs: RawRef[]; imports: RawImport[]; heritage: RawHeritage[] }

const jsExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
export const codeExtensions = [...jsExtensions, '.py'];
export const maxSymbolsPerFile = 400;

export function languageOf(file: string): Lang | null {
  const lower = file.toLowerCase();
  if (lower.endsWith('.d.ts')) return null;
  if (lower.endsWith('.py')) return 'py';
  return jsExtensions.some(extension => lower.endsWith(extension)) ? 'js' : null;
}

const blank = (text: string) => text.replace(/[^\n]/g, ' ');

// Replaces comments (and, unless keepStrings, string contents) with spaces so offsets and line numbers stay intact.
function mask(text: string, lang: Lang, keepStrings: boolean): string {
  const out: string[] = [];
  const length = text.length;
  let index = 0;
  while (index < length) {
    const char = text[index];
    const next = text[index + 1];
    if (lang === 'js' && char === '/' && next === '/') {
      let end = text.indexOf('\n', index); if (end < 0) end = length;
      out.push(blank(text.slice(index, end))); index = end; continue;
    }
    if (lang === 'js' && char === '/' && next === '*') {
      let end = text.indexOf('*/', index + 2); end = end < 0 ? length : end + 2;
      out.push(blank(text.slice(index, end))); index = end; continue;
    }
    if (lang === 'py' && char === '#') {
      let end = text.indexOf('\n', index); if (end < 0) end = length;
      out.push(blank(text.slice(index, end))); index = end; continue;
    }
    if (lang === 'py' && (text.startsWith('"""', index) || text.startsWith("'''", index))) {
      const quote = text.slice(index, index + 3);
      let end = text.indexOf(quote, index + 3); end = end < 0 ? length : end + 3;
      out.push(keepStrings ? text.slice(index, end) : blank(text.slice(index, end))); index = end; continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      while (end < length && text[end] !== char) {
        if (text[end] === '\\') end++;
        else if (text[end] === '\n' && char !== '`') break;
        end++;
      }
      end = Math.min(length, end + 1);
      const slice = text.slice(index, end);
      out.push(keepStrings ? slice : char + blank(slice.slice(1, -1)) + (slice.length > 1 ? char : ''));
      index = end; continue;
    }
    out.push(char); index++;
  }
  return out.join('');
}


const jsKeywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'with', 'function', 'else', 'do', 'try', 'typeof', 'void', 'new', 'await', 'yield', 'super', 'import', 'delete', 'throw', 'in', 'of', 'instanceof', 'case', 'default', 'break', 'continue', 'class', 'const', 'let', 'var', 'async', 'export', 'extends', 'implements', 'as', 'is', 'keyof', 'readonly', 'static', 'get', 'set', 'this', 'true', 'false', 'null', 'undefined']);
const pyKeywords = new Set(['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'return', 'yield', 'raise', 'assert', 'lambda', 'print', 'not', 'and', 'or', 'in', 'is', 'await', 'async', 'def', 'class', 'import', 'from', 'as', 'pass', 'del', 'global', 'nonlocal', 'None', 'True', 'False', 'self', 'cls', 'super']);

// Last line (1-based) of the brace-delimited or statement-delimited construct starting at lineIndex.
function jsBlockEnd(lines: string[], lineIndex: number): number {
  let depth = 0; let paren = 0; let seenBrace = false;
  for (let i = lineIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '(' || char === '[') paren++;
      else if (char === ')' || char === ']') paren--;
      else if (char === '{') { depth++; seenBrace = true; }
      else if (char === '}') { depth--; if (seenBrace && depth <= 0) return i + 1; }
      else if (char === ';' && !seenBrace && paren <= 0) return i + 1;
    }
    if (!seenBrace && paren <= 0) {
      const trimmed = line.trimEnd();
      const next = lines.slice(i + 1).find(candidate => candidate.trim());
      if (trimmed && !/[=,|&?:({[+\-*/<]$|=>$/.test(trimmed) && !(next && /^\s*[|&?:.+\-*/=<>]/.test(next))) return i + 1;
    }
  }
  return lines.length;
}

const pyBlockEnd = (lines: string[], lineIndex: number, indent: number): number => {
  let end = lineIndex + 1;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (lines[i].length - lines[i].trimStart().length <= indent) break;
    end = i + 1;
  }
  return end;
};

const identifier = /[A-Za-z_$][\w$]*/g;

function parseJsClause(clause: string): RawBinding[] {
  const bindings: RawBinding[] = [];
  const named = /\{([^}]*)\}/.exec(clause);
  const rest = named ? clause.replace(named[0], ',') : clause;
  const namespace = /\*\s*as\s+([\w$]+)/.exec(rest);
  if (namespace) bindings.push({ local: namespace[1], imported: '*' });
  const defaultName = /^\s*(?:type\s+)?([\w$]+)\s*(?:,|$)/.exec(rest.replace(/\*\s*as\s+[\w$]+/, ''));
  if (defaultName && defaultName[1] !== 'type') bindings.push({ local: defaultName[1], imported: 'default' });
  for (const part of (named?.[1] || '').split(',')) {
    const match = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
    if (match) bindings.push({ local: match[2] || match[1], imported: match[1] });
  }
  return bindings;
}

function jsImports(text: string): RawImport[] {
  const imports: RawImport[] = [];
  for (const match of text.matchAll(/\bimport\s+(?:type\s+)?([\w$\s{},*]+?)\s*from\s*['"]([^'"\n]+)['"]/g)) imports.push({ spec: match[2], bindings: parseJsClause(match[1]), reexport: false });
  for (const match of text.matchAll(/\bimport\s*['"]([^'"\n]+)['"]/g)) imports.push({ spec: match[1], bindings: [], reexport: false });
  for (const match of text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) imports.push({ spec: match[1], bindings: [], reexport: false });
  for (const match of text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"\n]+)['"]/g)) {
    const bindings = parseJsClause(`{${match[1]}}`).map(binding => ({ local: binding.local, imported: binding.imported }));
    imports.push({ spec: match[2], bindings, reexport: true });
  }
  for (const match of text.matchAll(/\bexport\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"]([^'"\n]+)['"]/g)) {
    imports.push({ spec: match[2], bindings: [{ local: match[1] || '*', imported: '*' }], reexport: true });
  }
  return imports;
}

function pyImports(text: string): RawImport[] {
  const imports: RawImport[] = [];
  for (const match of text.matchAll(/^[ \t]*import[ \t]+([^\n]+)/gm)) {
    for (const part of match[1].split(',')) {
      const item = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (item) imports.push({ spec: item[1], bindings: [{ local: item[2] || item[1].split('.').pop() || item[1], imported: '*' }], reexport: false });
    }
  }
  for (const match of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm)) {
    const bindings: RawBinding[] = [];
    for (const part of match[2].replace(/[()]/g, ' ').split(',')) {
      const item = /^\s*(\w+|\*)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (item) bindings.push({ local: item[2] || item[1], imported: item[1] });
    }
    imports.push({ spec: match[1], bindings, reexport: false });
  }
  return imports;
}

const fnDecl = /^(\s*)(export\s+)?(default\s+)?(?:declare\s+)?(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)/;
const classDecl = /^(\s*)(export\s+)?(default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)([^{]*)/;
const ifaceDecl = /^(\s*)(export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)([^{]*)/;
const typeDecl = /^(\s*)(export\s+)?(?:declare\s+)?(?:const\s+)?(type|enum)\s+([A-Za-z_$][\w$]*)/;
const varDecl = /^(\s*)(export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/;
const arrowValue = /^(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|<[^>]*>\s*\(|[A-Za-z_$][\w$]*\s*=>)/;
const methodDecl = /^(\s+)(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const propertyArrow = /^(\s+)(?:(?:public|private|protected|static|readonly|override)\s+)*([A-Za-z_$#][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|function\b)/;

function heritage(symbol: number, tail: string, out: RawHeritage[]): void {
  const extendsMatch = /\bextends\s+([\w$.]+)/.exec(tail);
  if (extendsMatch) out.push({ symbol, rel: 'extends', name: extendsMatch[1].split('.').pop() || extendsMatch[1] });
  const implementsMatch = /\bimplements\s+([\w$.,\s<>]+)/.exec(tail);
  if (implementsMatch) for (const name of implementsMatch[1].split(',')) {
    const clean = name.trim().replace(/<.*$/, '').split('.').pop();
    if (clean) out.push({ symbol, rel: 'implements', name: clean });
  }
}

function jsSymbols(lines: string[], heritages: RawHeritage[]): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  const classStack: { index: number; memberIndent: number }[] = [];
  const add = (symbol: RawSymbol) => { if (symbols.length < maxSymbolsPerFile) symbols.push(symbol); return symbols.length - 1; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineNo = i + 1;
    while (classStack.length && symbols[classStack[classStack.length - 1].index].endLine < lineNo) classStack.pop();
    const open = classStack[classStack.length - 1];
    if (open) {
      const owner = symbols[open.index];
      const indent = line.length - line.trimStart().length;
      if (indent > owner.indent && (open.memberIndent < 0 || indent === open.memberIndent)) {
        const arrow = propertyArrow.exec(line);
        const method = arrow || methodDecl.exec(line);
        const trimmed = line.trim();
        if (method && !jsKeywords.has(method[2]) || (method && method[2] === 'constructor')) {
          if (arrow || !trimmed.endsWith(';')) {
            open.memberIndent = indent;
            add({ name: method[2], kind: 'method', line: lineNo, endLine: jsBlockEnd(lines, i), parent: open.index, exported: false, isDefault: false, indent });
          }
        }
        continue;
      }
      if (indent > owner.indent) continue;
    }
    if (line.length - line.trimStart().length !== 0) continue;
    let match: RegExpExecArray | null;
    if ((match = classDecl.exec(line))) {
      const index = add({ name: match[4], kind: 'class', line: lineNo, endLine: jsBlockEnd(lines, i), parent: -1, exported: Boolean(match[2]), isDefault: Boolean(match[3]), indent: 0 });
      if (symbols[index]) { heritage(index, match[5] || '', heritages); classStack.push({ index, memberIndent: -1 }); }
    } else if ((match = fnDecl.exec(line))) {
      add({ name: match[4], kind: 'function', line: lineNo, endLine: jsBlockEnd(lines, i), parent: -1, exported: Boolean(match[2]), isDefault: Boolean(match[3]), indent: 0 });
    } else if ((match = ifaceDecl.exec(line))) {
      const index = add({ name: match[3], kind: 'interface', line: lineNo, endLine: jsBlockEnd(lines, i), parent: -1, exported: Boolean(match[2]), isDefault: false, indent: 0 });
      if (symbols[index]) { const extendsList = /\bextends\s+([\w$.,\s<>]+)/.exec(match[4]); for (const name of extendsList?.[1].split(',') || []) { const clean = name.trim().replace(/<.*$/, '').split('.').pop(); if (clean) heritages.push({ symbol: index, rel: 'extends', name: clean }); } }
    } else if ((match = typeDecl.exec(line))) {
      add({ name: match[4], kind: match[3] === 'enum' ? 'enum' : 'type', line: lineNo, endLine: jsBlockEnd(lines, i), parent: -1, exported: Boolean(match[2]), isDefault: false, indent: 0 });
    } else if ((match = varDecl.exec(line))) {
      const endLine = jsBlockEnd(lines, i);
      const isFunction = arrowValue.test(match[4].trim());
      const exported = Boolean(match[2]);
      if (isFunction || exported || endLine > lineNo) add({ name: match[3], kind: isFunction ? 'function' : 'const', line: lineNo, endLine, parent: -1, exported, isDefault: false, indent: 0 });
    }
  }
  return symbols;
}

function pySymbols(lines: string[], heritages: RawHeritage[]): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  const classStack: number[] = [];
  for (let i = 0; i < lines.length && symbols.length < maxSymbolsPerFile; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (classStack.length && (symbols[classStack[classStack.length - 1]].endLine < i + 1 || indent <= symbols[classStack[classStack.length - 1]].indent)) classStack.pop();
    const klass = /^(\s*)class\s+(\w+)\s*(?:\(([^)]*)\))?/.exec(line);
    const fn = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(line);
    const parent = classStack.length ? classStack[classStack.length - 1] : -1;
    if (indent > 0 && parent < 0) continue;
    if (klass) {
      const index = symbols.push({ name: klass[2], kind: 'class', line: i + 1, endLine: pyBlockEnd(lines, i, indent), parent, exported: !klass[2].startsWith('_'), isDefault: false, indent }) - 1;
      for (const base of (klass[3] || '').split(',')) { const clean = base.trim().split('.').pop(); if (clean && /^\w+$/.test(clean) && clean !== 'object') heritages.push({ symbol: index, rel: 'extends', name: clean }); }
      classStack.push(index);
    } else if (fn && (indent === 0 || parent >= 0)) {
      symbols.push({ name: fn[2], kind: parent >= 0 ? 'method' : 'function', line: i + 1, endLine: pyBlockEnd(lines, i, indent), parent, exported: !fn[2].startsWith('_'), isDefault: false, indent });
    } else if (indent === 0) {
      const constant = /^([A-Z][A-Z0-9_]+)\s*=/.exec(line);
      if (constant) symbols.push({ name: constant[1], kind: 'const', line: i + 1, endLine: i + 1, parent: -1, exported: true, isDefault: false, indent: 0 });
    }
  }
  return symbols;
}

export function extractFacts(text: string, lang: Lang): FileFacts {
  const withStrings = mask(text, lang, true);
  const masked = mask(text, lang, false).split(/\r?\n/);
  const heritages: RawHeritage[] = [];
  const symbols = lang === 'js' ? jsSymbols(masked, heritages) : pySymbols(masked, heritages);
  const imports = lang === 'js' ? jsImports(withStrings) : pyImports(withStrings);
  const keywords = lang === 'js' ? jsKeywords : pyKeywords;

  const owner = new Array<number>(masked.length + 1).fill(-1);
  symbols.forEach((symbol, index) => { for (let line = symbol.line; line <= Math.min(symbol.endLine, masked.length); line++) owner[line] = index; });
  const known = new Set<string>(imports.flatMap(item => item.bindings.map(binding => binding.local)));
  for (const symbol of symbols) if (symbol.parent < 0) known.add(symbol.name);

  const refs: RawRef[] = [];
  const seen = new Set<string>();
  const push = (ref: RawRef) => {
    const key = `${ref.symbol}|${ref.name}|${ref.receiver || ''}|${ref.call}|${ref.member}`;
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  };
  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    const symbolIndex = owner[i + 1];
    const declaration = symbolIndex >= 0 && symbols[symbolIndex].line === i + 1;
    const own = symbolIndex >= 0 ? symbols[symbolIndex].name : '';
    if (symbolIndex < 0 && !/\w\s*\(/.test(line)) continue;
    if (/^\s*(import|export\s+(type\s+)?(\{|\*))/.test(line) && lang === 'js') continue;
    if (/^\s*(from|import)\s/.test(line) && lang === 'py') continue;
    identifier.lastIndex = 0;
    for (let match = identifier.exec(line); match; match = identifier.exec(line)) {
      const name = match[0];
      if (keywords.has(name)) continue;
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + name.length);
      const member = /\.\s*$/.test(before) && !/\.\.\.\s*$/.test(before);
      const call = /^\s*(?:<[^>()]*>)?\s*\(/.test(after) || /\bnew\s+$/.test(before);
      if (declaration && name === own && !member) continue;
      if (member) {
        if (!call) continue;
        const receiver = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before)?.[1];
        push({ symbol: symbolIndex, name, receiver, call: true, member: true });
      } else if (call) {
        if (/\b(?:function|def|class|interface|type|enum)\s+$/.test(before)) continue;
        if (symbolIndex >= 0 || known.has(name)) push({ symbol: symbolIndex, name, call: true, member: false });
      } else if (symbolIndex >= 0 && known.has(name)) {
        if (/\b(?:function|def|class|interface|type|enum|const|let|var)\s+$/.test(before) || /^\s*:/.test(after) && /[{,]\s*$/.test(before)) continue;
        push({ symbol: symbolIndex, name, call: false, member: false });
      }
    }
  }
  return { lang, lineCount: masked.length, symbols, refs, imports, heritage: heritages };
}
