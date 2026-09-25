import React, { useState, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Zap,
  Radio,
  Terminal,
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  Copy,
  Check,
} from 'lucide-react';
import { ActionLogItem } from './MockReduxProvider';

interface ActionPanelProps {
  logs: ActionLogItem[];
  onClear: () => void;
}

type FilterType = 'all' | 'console' | 'redux' | 'callback';

const LogSourceBadge: React.FC<{
  source: ActionLogItem['source'];
  level?: ActionLogItem['level'];
}> = ({ source, level }) => {
  if (source === 'redux') {
    return <><Radio size={11} /> REDUX</>;
  }
  if (source === 'callback') {
    return <><Zap size={11} /> CALLBACK</>;
  }
  switch (level) {
    case 'error':
      return <><AlertCircle size={11} /> ERROR</>;
    case 'warn':
      return <><AlertTriangle size={11} /> WARN</>;
    case 'info':
      return <><Info size={11} /> INFO</>;
    default:
      return <><Terminal size={11} /> LOG</>;
  }
};

export const ActionPanel: React.FC<ActionPanelProps> = ({ logs, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (filter !== 'all') {
      result = result.filter((log) => log.source === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((log) => {
        if (log.name.toLowerCase().includes(q)) return true;
        if (log.payload !== undefined) {
          const payloadStr = typeof log.payload === 'object'
            ? JSON.stringify(log.payload)
            : String(log.payload);
          if (payloadStr.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    return result;
  }, [logs, filter, searchQuery]);

  const counts = useMemo(() => {
    let consoleCount = 0;
    let reduxCount = 0;
    let callbackCount = 0;
    let errorCount = 0;
    let warnCount = 0;

    for (const log of logs) {
      if (log.source === 'console') consoleCount++;
      else if (log.source === 'redux') reduxCount++;
      else if (log.source === 'callback') callbackCount++;

      if (log.level === 'error') errorCount++;
      else if (log.level === 'warn') warnCount++;
    }

    return { consoleCount, reduxCount, callbackCount, errorCount, warnCount };
  }, [logs]);

  const { consoleCount, reduxCount, callbackCount, errorCount, warnCount } = counts;

  return (
    <div className={`action-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="action-panel-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="action-panel-title">
          <Terminal size={14} className="title-icon" />
          <span>Console &amp; Actions</span>
          {logs.length > 0 && <span className="action-badge">{logs.length}</span>}
          {errorCount > 0 && (
            <span className="action-badge error" title={`${errorCount} console error(s)`}>
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && errorCount === 0 && (
            <span className="action-badge warn" title={`${warnCount} console warning(s)`}>
              {warnCount} warn{warnCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="action-panel-actions" onClick={(e) => e.stopPropagation()}>
          {logs.length > 0 && (
            <button className="clear-btn" onClick={onClear} title="Clear all logs">
              <Trash2 size={13} />
            </button>
          )}
          <button className="toggle-btn" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="action-panel-toolbar">
            <div className="filter-tabs">
              {(['all', 'console', 'redux', 'callback'] as const).map((type) => {
                const count =
                  type === 'all'
                    ? logs.length
                    : type === 'console'
                    ? consoleCount
                    : type === 'redux'
                    ? reduxCount
                    : callbackCount;
                const label = type.charAt(0).toUpperCase() + type.slice(1);
                return (
                  <button
                    key={type}
                    className={`filter-tab ${filter === type ? 'active' : ''}`}
                    onClick={() => setFilter(type)}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="toolbar-right">
              <div className="search-input-wrapper">
                <Search size={11} className="search-icon" />
                <input
                  type="text"
                  placeholder="Filter logs &amp; actions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                {searchQuery && (
                  <button className="search-clear-btn" onClick={() => setSearchQuery('')}>×</button>
                )}
              </div>

              {logs.length > 0 && (
                <button className="clear-text-btn" onClick={onClear} title="Clear all logs">
                  <Trash2 size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="action-panel-body">
            {filteredLogs.length === 0 ? (
              <div className="action-empty">
                <span>No {filter === 'all' ? 'actions or console logs' : filter} recorded yet.</span>
                <small>Console output, button clicks, and Redux dispatches will appear here live.</small>
              </div>
            ) : (
              <div className="action-list">
                {filteredLogs.map((log) => (
                  <div key={log.id} className={`action-item ${log.source} ${log.level || ''}`}>
                    <div className="action-item-header">
                      <span className="source-tag">
                        <LogSourceBadge source={log.source} level={log.level} />
                      </span>
                      <span className="action-name">{log.name}</span>
                      <div className="action-header-right">
                        <button
                          className="copy-log-btn"
                          title="Copy payload to clipboard"
                          onClick={() => {
                            const textToCopy =
                              typeof log.payload === 'object'
                                ? JSON.stringify(log.payload, null, 2)
                                : String(log.payload ?? log.name);
                            navigator.clipboard?.writeText(textToCopy);
                            setCopiedId(log.id);
                            setTimeout(() => setCopiedId(null), 1500);
                          }}
                        >
                          {copiedId === log.id ? <Check size={11} className="copied-icon" /> : <Copy size={11} />}
                        </button>
                        <span className="action-time">{log.timestamp}</span>
                      </div>
                    </div>
                    {log.payload !== undefined && (
                      <pre className="action-payload">
                        {typeof log.payload === 'object'
                          ? JSON.stringify(log.payload, null, 2)
                          : String(log.payload)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
