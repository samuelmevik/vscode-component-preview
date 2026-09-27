import React, { useState, useMemo, useCallback } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';
import { copyToClipboard } from './clipboardUtils';

interface JsonTreeViewProps {
  data: any;
  initialExpandedDepth?: number;
  searchQuery?: string;
  maxInitialStringLength?: number;
  showControls?: boolean;
}

interface JsonNodeProps {
  name?: string | number;
  value: any;
  depth: number;
  initialExpandedDepth: number;
  searchQuery?: string;
  isLast?: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatch(text: string, query?: string): React.ReactNode {
  if (!query || !query.trim() || !text) {
    return text;
  }
  const cleanQ = query.trim();
  try {
    const regex = new RegExp(`(${escapeRegex(cleanQ)})`, 'gi');
    const parts = text.split(regex);
    if (parts.length === 1) return text;
    return parts.map((part, idx) =>
      part.toLowerCase() === cleanQ.toLowerCase() ? (
        <mark key={idx} className="search-highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  } catch {
    return text;
  }
}

function valueContainsQuery(val: any, query: string, depth = 0): boolean {
  if (depth > 6 || !query) return false;
  const q = query.toLowerCase();
  if (val === null || val === undefined) {
    return String(val).includes(q);
  }
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).toLowerCase().includes(q);
  }
  if (Array.isArray(val)) {
    return val.some((item) => valueContainsQuery(item, query, depth + 1));
  }
  if (typeof val === 'object') {
    return Object.entries(val).some(
      ([k, v]) => k.toLowerCase().includes(q) || valueContainsQuery(v, query, depth + 1)
    );
  }
  return false;
}

function getNodePreview(val: any): string {
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const previewItems = val
      .slice(0, 3)
      .map((item) => {
        if (item === null) return 'null';
        if (item === undefined) return 'undefined';
        if (typeof item === 'string') return `"${item.length > 15 ? item.slice(0, 15) + '…' : item}"`;
        if (typeof item === 'object') return Array.isArray(item) ? '[…]' : '{…}';
        return String(item);
      })
      .join(', ');
    return `[${previewItems}${val.length > 3 ? `, … +${val.length - 3}` : ''}] (${val.length} items)`;
  }
  if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const previewKeys = keys
      .slice(0, 3)
      .map((k) => `${k}: …`)
      .join(', ');
    return `{ ${previewKeys}${keys.length > 3 ? `, … +${keys.length - 3}` : ''} } (${keys.length} keys)`;
  }
  return String(val);
}

const JsonNode: React.FC<JsonNodeProps> = ({
  name,
  value,
  depth,
  initialExpandedDepth,
  searchQuery,
  isLast = true,
}) => {
  const isObject = typeof value === 'object' && value !== null;
  const isArray = Array.isArray(value);
  const isEmpty = isObject ? (isArray ? value.length === 0 : Object.keys(value).length === 0) : false;

  const hasMatchingChild = useMemo(() => {
    if (!searchQuery?.trim() || !isObject) return false;
    return valueContainsQuery(value, searchQuery.trim());
  }, [value, searchQuery, isObject]);

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (!isObject || isEmpty) return false;
    if (hasMatchingChild) return true;
    return depth < initialExpandedDepth;
  });

  const [copied, setCopied] = useState<boolean>(false);

  // Auto-expand if a nested child matches the active search query
  React.useEffect(() => {
    if (hasMatchingChild) {
      setIsOpen(true);
    }
  }, [hasMatchingChild]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    },
    [value]
  );

  const renderValue = () => {
    if (value === null) {
      return <span className="json-null">null</span>;
    }
    if (value === undefined) {
      return <span className="json-undefined">undefined</span>;
    }
    if (typeof value === 'boolean') {
      return (
        <span className="json-boolean">
          {highlightMatch(String(value), searchQuery)}
        </span>
      );
    }
    if (typeof value === 'number') {
      return (
        <span className="json-number">
          {highlightMatch(String(value), searchQuery)}
        </span>
      );
    }
    if (typeof value === 'string') {
      return (
        <span className="json-string">
          "{highlightMatch(value, searchQuery)}"
        </span>
      );
    }

    if (isEmpty) {
      return <span className="json-empty">{isArray ? '[]' : '{}'}</span>;
    }

    if (!isOpen) {
      return (
        <span
          className="json-preview"
          onClick={() => setIsOpen(true)}
          title="Click to expand"
        >
          {getNodePreview(value)}
        </span>
      );
    }

    return null;
  };

  const keyDisplay = name !== undefined && (
    <span className="json-key-wrapper">
      <span className="json-key">{highlightMatch(String(name), searchQuery)}</span>
      <span className="json-colon">:</span>
    </span>
  );

  if (!isObject || isEmpty) {
    return (
      <div className="json-node-row">
        {keyDisplay}
        {renderValue()}
        {!isLast && <span className="json-comma">,</span>}
        <button
          className="json-copy-btn"
          onClick={handleCopy}
          title="Copy value"
        >
          {copied ? <Check size={10} className="copied" /> : <Copy size={10} />}
        </button>
      </div>
    );
  }

  const entries = isArray
    ? value.map((val, idx) => ({ key: idx, val, isEnd: idx === value.length - 1 }))
    : Object.keys(value).map((k, idx, arr) => ({
        key: k,
        val: value[k],
        isEnd: idx === arr.length - 1,
      }));

  return (
    <div className={`json-node ${isOpen ? 'expanded' : 'collapsed'}`}>
      <div className="json-node-row" onClick={() => setIsOpen(!isOpen)}>
        <button
          className={`json-toggle-btn ${isOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={11} />
        </button>
        {keyDisplay}
        {isOpen ? (
          <span className="json-bracket-open">{isArray ? '[' : '{'}</span>
        ) : (
          renderValue()
        )}
        <button
          className="json-copy-btn"
          onClick={handleCopy}
          title="Copy subtree JSON"
        >
          {copied ? <Check size={10} className="copied" /> : <Copy size={10} />}
        </button>
      </div>

      {isOpen && (
        <div className="json-node-children">
          {entries.map(({ key, val, isEnd }) => (
            <JsonNode
              key={key}
              name={key}
              value={val}
              depth={depth + 1}
              initialExpandedDepth={initialExpandedDepth}
              searchQuery={searchQuery}
              isLast={isEnd}
            />
          ))}
          <div className="json-bracket-close">
            {isArray ? ']' : '}'}
            {!isLast && <span className="json-comma">,</span>}
          </div>
        </div>
      )}
    </div>
  );
};


export const JsonTreeView: React.FC<JsonTreeViewProps> = ({
  data,
  initialExpandedDepth = 1,
  searchQuery = '',
  showControls = false,
}) => {
  if (data === undefined) {
    return <span className="json-undefined">undefined</span>;
  }

  const [expandedDepth, setExpandedDepth] = useState<number>(initialExpandedDepth);
  const [treeKey, setTreeKey] = useState<number>(0);

  const handleExpandAll = useCallback(() => {
    setExpandedDepth(20);
    setTreeKey((k) => k + 1);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedDepth(0);
    setTreeKey((k) => k + 1);
  }, []);

  return (
    <div className="json-tree-container">
      {showControls && typeof data === 'object' && data !== null && (
        <div className="json-tree-controls">
          <button className="json-ctrl-btn" onClick={handleExpandAll} title="Expand all nodes">
            Expand All
          </button>
          <button className="json-ctrl-btn" onClick={handleCollapseAll} title="Collapse all nodes">
            Collapse All
          </button>
        </div>
      )}
      <div className="json-tree" key={treeKey}>
        <JsonNode
          value={data}
          depth={0}
          initialExpandedDepth={expandedDepth}
          searchQuery={searchQuery}
          isLast={true}
        />
      </div>
    </div>
  );
};
