import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryNode, NoCategory } from '@dcvr/shared';

export const NO_CATEGORY: NoCategory = '__none__';

interface Props {
  tree: CategoryNode[];
  uncategorized: number;
  selected: string[];
  onChange: (selected: string[]) => void;
}

const isWithin = (path: string, ancestor: string) => path.startsWith(ancestor + '/');

/**
 * Selecting a category implies all its descendants, so the selection only ever
 * holds the topmost chosen paths; descendants of a selected node are shown checked
 * and locked until the parent is unchecked.
 */
export function CategoryFilter({ tree, uncategorized, selected, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const needle = search.trim().toLowerCase();

  const visible = useMemo(() => (needle ? filterTree(tree, needle) : tree), [tree, needle]);

  const toggle = (path: string) => {
    if (selected.includes(path)) onChange(selected.filter((p) => p !== path));
    else onChange([...selected.filter((p) => !isWithin(p, path)), path]);
  };

  const toggleExpanded = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <section className="panel filter">
      <header className="filter__header">
        <h2>Category</h2>
        {selected.length > 0 && (
          <button className="link-button" onClick={() => onChange([])}>
            Сбросить ({selected.length})
          </button>
        )}
      </header>
      <input
        className="search"
        type="search"
        placeholder="Поиск категории"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="options tree">
        {!needle && (
          <li>
            <label className="option">
              <input
                type="checkbox"
                checked={selected.includes(NO_CATEGORY)}
                onChange={() => toggle(NO_CATEGORY)}
              />
              <span className="option__label muted">Без категории</span>
              <span className="count">{uncategorized.toLocaleString('ru-RU')}</span>
            </label>
          </li>
        )}
        {visible.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            selected={selected}
            expanded={expanded}
            forceExpanded={Boolean(needle)}
            onToggle={toggle}
            onToggleExpanded={toggleExpanded}
          />
        ))}
        {needle && !visible.length && <li className="muted">Ничего не найдено</li>}
      </ul>
    </section>
  );
}

interface TreeItemProps {
  node: CategoryNode;
  selected: string[];
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onToggleExpanded: (path: string) => void;
}

function TreeItem({
  node,
  selected,
  expanded,
  forceExpanded,
  onToggle,
  onToggleExpanded,
}: TreeItemProps) {
  const checkbox = useRef<HTMLInputElement>(null);
  const isSelected = selected.includes(node.path);
  const ancestorSelected = selected.some((p) => isWithin(node.path, p));
  const descendantSelected = selected.some((p) => isWithin(p, node.path));
  const open = forceExpanded || expanded.has(node.path);
  const hasChildren = node.children.length > 0;

  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = !isSelected && descendantSelected;
  }, [isSelected, descendantSelected]);

  return (
    <li>
      <div className="tree__row">
        {hasChildren ? (
          <button
            className="tree__toggle"
            aria-label={open ? 'Свернуть' : 'Развернуть'}
            aria-expanded={open}
            onClick={() => onToggleExpanded(node.path)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree__toggle" />
        )}
        <label className="option" title={node.path}>
          <input
            ref={checkbox}
            type="checkbox"
            checked={isSelected || ancestorSelected}
            disabled={ancestorSelected}
            onChange={() => onToggle(node.path)}
          />
          <span className="option__label">{node.name}</span>
          <span className="count">{node.count.toLocaleString('ru-RU')}</span>
        </label>
      </div>
      {hasChildren && open && (
        <ul className="tree__children">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              selected={selected}
              expanded={expanded}
              forceExpanded={forceExpanded}
              onToggle={onToggle}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Keeps nodes whose name matches, plus the ancestors leading to them. */
function filterTree(nodes: CategoryNode[], needle: string): CategoryNode[] {
  return nodes.flatMap((node) => {
    if (node.name.toLowerCase().includes(needle)) return [node];
    const children = filterTree(node.children, needle);
    return children.length ? [{ ...node, children }] : [];
  });
}
