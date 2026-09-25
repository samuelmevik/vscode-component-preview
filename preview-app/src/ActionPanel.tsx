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
} from 'lucide-react';
import { ActionLogItem } from './MockReduxProvider';

interface ActionPanelProps {
  logs: ActionLogItem[];
  onClear: () => void;
}

type FilterType = 'all' | 'console' | 'redux' | 'callback';

export const ActionPanel: React.FC<ActionPanelProps> = ({ logs, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((log) => log.source === filter);
  }, [logs, filter]);

  const consoleCount = useMemo(() => logs.filter((l) => l.source === 'console').length, [logs]);
  const reduxCount = useMemo(() => logs.filter((l) => l.source === 'redux').length, [logs]);
  const callbackCount = useMemo(() => logs.filter((l) => l.source === 'callback').length, [logs]);

  const errorCount = useMemo(
    () => logs.filter((l) => l.level === 'error').length,
    [logs]
  );
  const warnCount = useMemo(
    () => logs.filter((l) => l.level === 'warn').length,
    [logs]
  );

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
              <button
                className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All ({logs.length})
              </button>
              <button
                className={`filter-tab ${filter === 'console' ? 'active' : ''}`}
                onClick={() => setFilter('console')}
              >
                Console ({consoleCount})
              </button>
              <button
                className={`filter-tab ${filter === 'redux' ? 'active' : ''}`}
                onClick={() => setFilter('redux')}
              >
                Redux ({reduxCount})
              </button>
              <button
                className={`filter-tab ${filter === 'callback' ? 'active' : ''}`}
                onClick={() => setFilter('callback')}
              >
                Callbacks ({callbackCount})
              </button>
            </div>
            {logs.length > 0 && (
              <button className="clear-text-btn" onClick={onClear} title="Clear all logs">
                <Trash2 size={11} /> Clear
              </button>
            )}
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
                          {log.source === 'redux' ? (
                            <>
                              <Radio size={11} /> REDUX
                            </>
                        ) : log.source === 'callback' ? (
                          <>
                            <Zap size={11} /> CALLBACK
                            </>
                          ) : log.level === 'error' ? (
                            <>
                              <AlertCircle size={11} /> ERROR
                            </>
                          ) : log.level === 'warn' ? (
                            <>
                              <AlertTriangle size={11} /> WARN
                            </>
                          ) : log.level === 'info' ? (
                            <>
                              <Info size={11} /> INFO
                            </>
                          ) : (
                            <>
                              <Terminal size={11} /> LOG
                          </>
                        )}
                      </span>
                      <span className="action-name">{log.name}</span>
                      <span className="action-time">{log.timestamp}</span>
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
