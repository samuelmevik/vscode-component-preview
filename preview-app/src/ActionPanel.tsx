import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
  Globe,
  ExternalLink,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { ActionLogItem } from './MockReduxProvider';
import { navigateToSource } from './errorLocationParser';

interface ActionPanelProps {
  logs: ActionLogItem[];
  onClear: () => void;
}

type FilterType = 'all' | 'errors' | 'network' | 'redux' | 'console' | 'callback';

const LogSourceBadge: React.FC<{
  source: ActionLogItem['source'];
  level?: ActionLogItem['level'];
}> = ({ source, level }) => {
  if (source === 'error' || level === 'error') {
    return <><AlertCircle size={11} /> ERROR</>;
  }
  if (source === 'network') {
    return <><Globe size={11} /> HTTP</>;
  }
  if (source === 'redux') {
    return <><Radio size={11} /> REDUX</>;
  }
  if (source === 'callback') {
    return <><Zap size={11} /> CALLBACK</>;
  }
  switch (level) {
    case 'warn':
      return <><AlertTriangle size={11} /> WARN</>;
    case 'info':
      return <><Info size={11} /> INFO</>;
    default:
      return <><Terminal size={11} /> LOG</>;
  }
};

const DEFAULT_PANEL_HEIGHT = 270;
const MIN_PANEL_HEIGHT = 80;
const STORAGE_KEY = 'component-preview-drawer-height';

export const ActionPanel: React.FC<ActionPanelProps> = ({ logs, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resizable drawer height
  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_PANEL_HEIGHT) {
          return parsed;
        }
      }
    } catch {}
    return DEFAULT_PANEL_HEIGHT;
  });

  const [isResizing, setIsResizing] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const preMaximizedHeightRef = useRef<number>(height);

  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(height);

  // Save non-maximized height to localStorage
  useEffect(() => {
    if (!isMaximized && height >= MIN_PANEL_HEIGHT) {
      try {
        localStorage.setItem(STORAGE_KEY, String(height));
      } catch {}
    }
  }, [height, isMaximized]);

  // Adjust height on window resize to ensure drawer remains within viewport
  useEffect(() => {
    const handleWindowResize = () => {
      const maxH = typeof window !== 'undefined' ? window.innerHeight - 45 : 700;
      if (isMaximized) {
        setHeight(Math.max(MIN_PANEL_HEIGHT, maxH));
      } else {
        setHeight((prev) => {
          if (prev > maxH && maxH >= MIN_PANEL_HEIGHT) {
            return maxH;
          }
          return prev;
        });
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [isMaximized]);

  // Handle pointer down on resizer top handle
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      setIsMaximized(false);

      const startY = e.clientY;
      startYRef.current = startY;
      const initialHeight = isExpanded ? height : 34;
      startHeightRef.current = initialHeight;

      let hasMoved = false;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const deltaY = startYRef.current - moveEvent.clientY;
        if (Math.abs(deltaY) > 3) {
          hasMoved = true;
        }

        const maxH = typeof window !== 'undefined' ? window.innerHeight - 45 : 800;
        const calculated = startHeightRef.current + deltaY;

        if (!isExpanded && deltaY > 15) {
          setIsExpanded(true);
        }

        const clamped = Math.max(MIN_PANEL_HEIGHT, Math.min(maxH, calculated));
        setHeight(clamped);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        setIsResizing(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        const deltaY = startYRef.current - upEvent.clientY;
        // If dragged down towards the bottom past snap threshold, collapse
        if (startHeightRef.current + deltaY < 60) {
          setIsExpanded(false);
          setHeight((prev) => Math.max(prev, DEFAULT_PANEL_HEIGHT));
        } else if (hasMoved) {
          const maxH = typeof window !== 'undefined' ? window.innerHeight - 45 : 800;
          const clamped = Math.max(MIN_PANEL_HEIGHT, Math.min(maxH, startHeightRef.current + deltaY));
          setHeight(clamped);
        }
      };

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [isExpanded, height]
  );

  const handleDoubleClickResizer = useCallback(() => {
    if (!isExpanded) {
      setIsExpanded(true);
    } else {
      setIsMaximized(false);
      setHeight(DEFAULT_PANEL_HEIGHT);
    }
  }, [isExpanded]);

  const handleToggleMaximize = useCallback(() => {
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 45 : 700;
    if (!isExpanded) {
      setIsExpanded(true);
      setIsMaximized(true);
      preMaximizedHeightRef.current = height;
      setHeight(maxH);
    } else if (!isMaximized) {
      setIsMaximized(true);
      preMaximizedHeightRef.current = height;
      setHeight(maxH);
    } else {
      setIsMaximized(false);
      setHeight(preMaximizedHeightRef.current || DEFAULT_PANEL_HEIGHT);
    }
  }, [isExpanded, isMaximized, height]);

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (filter === 'errors') {
      result = result.filter((log) => log.source === 'error' || log.level === 'error');
    } else if (filter !== 'all') {
      result = result.filter((log) => log.source === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((log) => {
        if (log.name.toLowerCase().includes(q)) return true;
        if (log.url && log.url.toLowerCase().includes(q)) return true;
        if (log.method && log.method.toLowerCase().includes(q)) return true;
        if (log.status && String(log.status).includes(q)) return true;
        if (log.location?.fileName?.toLowerCase().includes(q)) return true;
        if (log.location?.functionName?.toLowerCase().includes(q)) return true;
        if (log.payload !== undefined) {
          const payloadStr =
            typeof log.payload === 'object' ? JSON.stringify(log.payload) : String(log.payload);
          if (payloadStr.toLowerCase().includes(q)) return true;
        }
        if (log.response !== undefined) {
          const respStr =
            typeof log.response === 'object' ? JSON.stringify(log.response) : String(log.response);
          if (respStr.toLowerCase().includes(q)) return true;
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
    let networkCount = 0;
    let errorCount = 0;
    let warnCount = 0;

    for (const log of logs) {
      if (log.source === 'console') consoleCount++;
      else if (log.source === 'redux') reduxCount++;
      else if (log.source === 'callback') callbackCount++;
      else if (log.source === 'network') networkCount++;
      else if (log.source === 'error') errorCount++;

      if (log.level === 'error' && log.source !== 'error') errorCount++;
      else if (log.level === 'warn') warnCount++;
    }

    return { consoleCount, reduxCount, callbackCount, networkCount, errorCount, warnCount };
  }, [logs]);

  const { consoleCount, reduxCount, callbackCount, networkCount, errorCount, warnCount } = counts;

  return (
    <div
      className={`action-panel ${isExpanded ? 'expanded' : 'collapsed'} ${isResizing ? 'is-resizing' : ''}`}
      style={{ height: isExpanded ? `${height}px` : undefined }}
    >
      {/* Resizer Handle */}
      <div
        className={`action-panel-resizer ${isResizing ? 'active' : ''}`}
        onPointerDown={handleResizeStart}
        onDoubleClick={handleDoubleClickResizer}
        title="Drag to resize drawer (double-click to reset)"
      >
        <div className="resizer-handle-line" />
      </div>

      <div
        className="action-panel-header"
        onClick={() => {
          if (isExpanded) {
            setIsExpanded(false);
            setIsMaximized(false);
          } else {
            setIsExpanded(true);
          }
        }}
      >
        <div className="action-panel-title">
          <Terminal size={14} className="title-icon" />
          <span>Console &amp; Actions</span>
          {logs.length > 0 && <span className="action-badge">{logs.length}</span>}
          {networkCount > 0 && (
            <span className="action-badge network" title={`${networkCount} HTTP request(s)`}>
              {networkCount} HTTP
            </span>
          )}
          {errorCount > 0 && (
            <span className="action-badge error" title={`${errorCount} error(s)`}>
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && errorCount === 0 && (
            <span className="action-badge warn" title={`${warnCount} warning(s)`}>
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
          {isExpanded && (
            <button
              className="maximize-btn"
              onClick={handleToggleMaximize}
              title={isMaximized ? 'Restore drawer height' : 'Maximize drawer'}
            >
              {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button
            className="toggle-btn"
            onClick={() => {
              if (isExpanded) {
                setIsExpanded(false);
                setIsMaximized(false);
              } else {
                setIsExpanded(true);
              }
            }}
            title={isExpanded ? 'Collapse drawer' : 'Expand drawer'}
          >
            {isExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="action-panel-toolbar">
            <div className="filter-tabs">
              {(['all', 'errors', 'network', 'redux', 'console', 'callback'] as const).map((type) => {
                const count =
                  type === 'all'
                    ? logs.length
                    : type === 'errors'
                    ? errorCount
                    : type === 'network'
                    ? networkCount
                    : type === 'console'
                    ? consoleCount
                    : type === 'redux'
                    ? reduxCount
                    : callbackCount;
                const label =
                  type === 'network'
                    ? 'HTTP'
                    : type === 'errors'
                    ? 'Errors'
                    : type.charAt(0).toUpperCase() + type.slice(1);
                const hasErrors = type === 'errors' && errorCount > 0;
                return (
                  <button
                    key={type}
                    className={`filter-tab ${filter === type ? 'active' : ''} ${hasErrors ? 'has-errors' : ''}`}
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
                  placeholder="Filter by url, method, payload..."
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
                <span>No {filter === 'all' ? 'actions, HTTP requests, or console logs' : filter} recorded yet.</span>
                <small>HTTP requests (axios/fetch/RTK Query), button clicks, console logs, and Redux dispatches appear here live.</small>
              </div>
            ) : (
              <div className="action-list">
                {filteredLogs.map((log) => {
                  if (log.source === 'network') {
                    const isSuccess = log.status && log.status >= 200 && log.status < 400;
                    const isClientError = log.status && log.status >= 400 && log.status < 500;
                    const statusType = isSuccess ? 'success' : isClientError ? 'warn' : 'error';
                    const method = log.method || 'GET';

                    return (
                      <div key={log.id} className={`action-item network ${statusType}`}>
                        <div className="action-item-header">
                          <span className="source-tag">
                            <Globe size={11} /> HTTP
                          </span>
                          <span className={`method-badge method-${method.toLowerCase()}`}>
                            {method}
                          </span>
                          <span className="network-url" title={log.url}>{log.url}</span>
                          <div className="action-header-right">
                            {log.status !== undefined && (
                              <span className={`network-status-badge ${statusType}`}>
                                {log.status} {log.statusText || (log.status === 200 ? 'OK' : '')}
                              </span>
                            )}
                            {log.duration && <span className="network-duration">{log.duration}</span>}
                            <button
                              className="copy-log-btn"
                              title="Copy request and response data"
                              onClick={() => {
                                const dataToCopy = {
                                  method: log.method,
                                  url: log.url,
                                  status: log.status,
                                  duration: log.duration,
                                  payload: log.payload,
                                  response: log.response,
                                };
                                navigator.clipboard?.writeText(JSON.stringify(dataToCopy, null, 2));
                                setCopiedId(log.id);
                                setTimeout(() => setCopiedId(null), 1500);
                              }}
                            >
                              {copiedId === log.id ? <Check size={11} className="copied-icon" /> : <Copy size={11} />}
                            </button>
                            <span className="action-time">{log.timestamp}</span>
                          </div>
                        </div>

                        {/* Clean Request Payload & Response Data */}
                        <div className="network-details">
                          {log.payload !== undefined && (
                            <div className="network-section">
                              <div className="network-section-title">
                                <span className="section-dot payload-dot"></span> Request Payload
                              </div>
                              <pre className="action-payload">
                                {typeof log.payload === 'object'
                                  ? JSON.stringify(log.payload, null, 2)
                                  : String(log.payload)}
                              </pre>
                            </div>
                          )}

                          {log.response !== undefined && (
                            <div className="network-section">
                              <div className="network-section-title">
                                <span className="section-dot response-dot"></span> Response Data
                              </div>
                              <pre className="action-payload response-payload">
                                {typeof log.response === 'object'
                                  ? JSON.stringify(log.response, null, 2)
                                  : String(log.response)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Non-network items (redux, callback, console)
                  return (
                    <div key={log.id} className={`action-item ${log.source} ${log.level || ''}`}>
                      <div className="action-item-header">
                        <span className="source-tag">
                          <LogSourceBadge source={log.source} level={log.level} />
                        </span>
                        <span className="action-name">{log.name}</span>
                        {log.location && (
                          <button
                            className="action-jump-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToSource(log.location!);
                            }}
                            title={`Open ${log.location.filePath}:${log.location.line} in VS Code`}
                          >
                            <ExternalLink size={10} />
                            <span>{log.location.fileName}:{log.location.line}</span>
                          </button>
                        )}
                        <div className="action-header-right">
                          <button
                            className="copy-log-btn"
                            title="Copy payload to clipboard"
                            onClick={() => {
                              const textToCopy =
                                typeof log.payload === 'object'
                                  ? (log.payload.__isError || log.payload.stack
                                      ? `${log.payload.message || ''}\n\n${log.payload.stack || ''}`.trim()
                                      : JSON.stringify(log.payload, null, 2))
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
                            ? (log.payload.__isError || log.payload.stack
                                ? `${log.payload.message || ''}\n\n${log.payload.stack || ''}`.trim()
                                : JSON.stringify(log.payload, null, 2))
                            : String(log.payload)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
