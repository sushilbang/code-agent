import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption<T extends string> { value: T; label: string; description?: string; icon?: ReactNode; danger?: boolean; separatorBefore?: boolean }
export interface DropdownGroup<T extends string> { label?: string; options: DropdownOption<T>[] }

interface Props<T extends string> {
  groups: DropdownGroup<T>[];
  onSelect: (value: T) => void;
  value?: T;                       // marks the selected option; omit for action menus
  label?: ReactNode;               // trigger content (defaults to the selected option's label)
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom';    // which side of the trigger the menu opens on
  align?: 'start' | 'end';         // which trigger edge the menu lines up with
  variant?: 'ghost' | 'icon' | 'field';
  width?: number;
  caret?: boolean;
}

// A themed replacement for <select>. The menu is position:fixed so clipped containers cannot hide it.
export default function Dropdown<T extends string>({ groups, onSelect, value, label, ariaLabel, title, disabled, placement = 'bottom', align = 'start', variant = 'ghost', width = 240, caret = true }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = groups.flatMap(group => group.options);
  const selected = options.find(option => option.value === value);

  const close = useCallback((restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); }, []);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(align === 'end' ? rect.right - width : rect.left, window.innerWidth - width - margin));
    if (placement === 'top') setPosition({ left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(120, rect.top - margin - 4) });
    else setPosition({ left, top: rect.bottom + 4, maxHeight: Math.max(120, window.innerHeight - rect.bottom - margin - 4) });
  }, [open, placement, align, width]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };
    window.addEventListener('pointerdown', onPointer, true); window.addEventListener('keydown', onKey, true); window.addEventListener('blur', () => close(), { once: true });
    window.addEventListener('resize', onResize); function onResize() { close(); }
    return () => { window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
  }, [open, close]);

  useEffect(() => {
    if (open && position) (menu.current?.querySelector<HTMLElement>('[aria-selected="true"]') || menu.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open, position]);

  function onMenuKey(event: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="option"]') || [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
    else if (event.key === 'Tab') close();
  }

  return <>
    <button ref={trigger} type="button" className={`dd-trigger dd-${variant} ${open ? 'open' : ''}`} aria-label={ariaLabel} title={title || ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => setOpen(previous => !previous)}
      onKeyDown={event => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); setOpen(true); } }}>
      <span className="dd-label">{label ?? selected?.label ?? ''}</span>{caret && variant !== 'icon' && <ChevronDown size={14} className="dd-caret" />}
    </button>
    {open && position && <div ref={menu} id={id} className="dd-menu" role="listbox" aria-label={ariaLabel} style={{ ...position, width }} onKeyDown={onMenuKey}>
      {groups.map((group, groupIndex) => <div role="group" aria-label={group.label} key={group.label || groupIndex}>
        {group.label && <div className="dd-group">{group.label}</div>}
        {group.options.map(option => <div key={option.value}>
          {option.separatorBefore && <div className="dd-separator" />}
          <button type="button" role="option" aria-selected={option.value === value} className={`dd-item ${option.danger ? 'danger' : ''}`} tabIndex={-1}
            onClick={() => { close(true); onSelect(option.value); }}>
            <span className="dd-check">{option.value === value ? <Check size={14} /> : option.icon}</span>
            <span className="dd-text"><span className="dd-item-label">{option.label}</span>{option.description && <span className="dd-item-description">{option.description}</span>}</span>
          </button>
        </div>)}
      </div>)}
    </div>}
  </>;
}
