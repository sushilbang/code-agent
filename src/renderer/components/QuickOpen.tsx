import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rankPaths } from '../../shared/fuzzy';

interface Props {
  files: string[];                       // every workspace file, relative paths
  recent: string[];                      // open files, most relevant first; shown when the query is empty
  renderIcon: (name: string) => ReactNode;
  onOpen: (path: string) => void;
  onClose: () => void;
}

function Highlighted({ text, indexes, offset }: { text: string; indexes: Set<number>; offset: number }) {
  const parts: ReactNode[] = [];
  let run = '', marked = false;
  const flush = (key: number) => { if (run) parts.push(marked ? <b key={key}>{run}</b> : run); run = ''; };
  for (let index = 0; index < text.length; index++) {
    const isMarked = indexes.has(index + offset);
    if (isMarked !== marked) { flush(index); marked = isMarked; }
    run += text[index];
  }
  flush(text.length);
  return <>{parts}</>;
}

// VS Code style "Go to File": a floating input over the editor with a fuzzy-ranked list.
export default function QuickOpen({ files, recent, renderIcon, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => {
    const open = recent.filter(path => files.includes(path));
    const rest = files.filter(path => !open.includes(path));
    // Build output and packaged releases are rarely what you are looking for, so they sort last.
    const generated = (path: string) => /^(release|build|out|coverage|\.next)\//.test(path);
    return [...open, ...rest.filter(path => !generated(path)), ...rest.filter(generated)];
  }, [files, recent]);
  const results = useMemo(() => rankPaths(query, ordered, 100), [query, ordered]);

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected, results]);

  function onKeyDown(event: React.KeyboardEvent) {
    const last = results.length - 1;
    const move = (to: number) => { event.preventDefault(); setSelected(Math.max(0, Math.min(last, to))); };
    if (event.key === 'ArrowDown') move(selected >= last ? 0 : selected + 1);
    else if (event.key === 'ArrowUp') move(selected <= 0 ? last : selected - 1);
    else if (event.key === 'PageDown') move(selected + 10);
    else if (event.key === 'PageUp') move(selected - 10);
    else if (event.key === 'Enter') { event.preventDefault(); if (results[selected]) onOpen(results[selected].path); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }

  return <div className="quickopen-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="quickopen" role="dialog" aria-label="Go to file" onKeyDown={onKeyDown}>
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onBlur={event => { if (!event.relatedTarget) onClose(); }}
        placeholder="Search files by name" aria-label="Search files by name" aria-controls="quickopen-list" role="combobox" aria-expanded="true" aria-activedescendant={results[selected] ? `qo-${selected}` : undefined} spellCheck={false} autoComplete="off" />
      <div className="quickopen-list" id="quickopen-list" role="listbox" ref={list}>
        {results.length === 0 ? <div className="quickopen-empty">No matching files</div> : results.map((result, index) => {
          const slash = result.path.lastIndexOf('/');
          const name = result.path.slice(slash + 1), directory = slash < 0 ? '' : result.path.slice(0, slash);
          const marked = new Set(result.indexes);
          return <div id={`qo-${index}`} key={result.path} role="option" aria-selected={index === selected} className={`quickopen-row ${index === selected ? 'selected' : ''}`}
            onMouseMove={() => { if (selected !== index) setSelected(index); }} onMouseDown={event => event.preventDefault()} onClick={() => onOpen(result.path)}>
            {renderIcon(name)}
            <span className="quickopen-name"><Highlighted text={name} indexes={marked} offset={slash + 1} /></span>
            {directory && <span className="quickopen-dir"><Highlighted text={directory} indexes={marked} offset={0} /></span>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
