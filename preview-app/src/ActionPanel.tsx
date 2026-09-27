import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
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
  Layers,
  ArrowDownUp,
  Download,
  Pin,
  Database,
} from 'lucide-react';
import { ActionLogItem } from './MockReduxProvider';
import { navigateToSource } from './errorLocationParser';
import { JsonTreeView, highlightMatch } from './JsonTreeView';
import { getLiveStoreState } from './reduxInterceptor';

interface ActionPanelProps {
  logs: ActionLogItem[];
  onClear: () => void;
}

type FilterType = 'all' | 'errors' | 'network' | 'redux' | 'console' | 'callback';

const DEFAULT_PANEL_HEIGHT = 270;
const MIN_PANEL_HEIGHT = 80;
const STORAGE_HEIGHT_KEY = 'component-preview-drawer-height';
const STORAGE_GROUP_KEY = 'component-preview-group-similar';
const STORAGE_PRESERVE_KEY = 'component-preview-preserve-log';
const STORAGE_SORT_KEY = 'component-preview-sort-order';

function getStatusDescription(status?: number): string {
  if (!status) return '';
  const statusMap: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return statusMap[status] || '';
}

function parseQueryParams(rawUrl?: string): [string, string][] {
  if (!rawUrl || !rawUrl.includes('?')) return [];
  try {
    const dummyBase = 'http://127.0.0.1';
    const parsed = new URL(rawUrl, dummyBase);
    return Array.from(parsed.searchParams.entries());
  } catch {
    const qIndex = rawUrl.indexOf('?');
    const qStr = rawUrl.slice(qIndex + 1);
    const params: [string, string][] = [];
    qStr.split('&').forEach((pair) => {
      const [k, v] = pair.split('=');
      if (k) params.push([decodeURIComponent(k), decodeURIComponent(v || '')]);
    });
    return params;
  }
}

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

interface GroupedLogItem {
  key: string;
  signature: string;
  log: ActionLogItem;
  count: number;
  firstTimestamp: string;
  latestTimestamp: string;
}

function getLogSignature(log: ActionLogItem): string {
  const parts = [
    log.source,
    log.level || '',
    log.name,
    log.method || '',
    log.url || '',
    log.status || '',
    log.asyncStatus || '',
    log.endpoint || '',
  ];
  if (log.payload !== undefined) {
    parts.push(typeof log.payload === 'object' ? JSON.stringify(log.payload) : String(log.payload));
  }
  if (log.response !== undefined) {
    parts.push(typeof log.response === 'object' ? JSON.stringify(log.response) : String(log.response));
  }
  return parts.join('||');
}

const NetworkLogItemRow: React.FC<{
  log: ActionLogItem;
  count: number;
  latestTimestamp: string;
  searchQuery: string;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ log, count, latestTimestamp, searchQuery, copiedId, onCopy }) => {
  const [showPayload, setShowPayload] = useState(true);
  const [showResponse, setShowResponse] = useState(true);
  const [showParams, setShowParams] = useState(true);

  const isSuccess = log.status && log.status >= 200 && log.status < 400;
  const isClientError = log.status && log.status >= 400 && log.status < 500;
  const statusType = isSuccess ? 'success' : isClientError ? 'warn' : 'error';
  const method = log.method || 'GET';
  const statusDesc = getStatusDescription(log.status);
  const queryParams = useMemo(() => parseQueryParams(log.url), [log.url]);

  return (
    <div className={`action-item network ${statusType}`}>
      <div className="action-item-header">
        <span className="source-tag">
          <Globe size={11} /> HTTP
        </span>
        <span className={`method-badge method-${method.toLowerCase()}`}>
          {method}
        </span>
        <span className="network-url" title={log.url}>
          {highlightMatch(log.url || '', searchQuery)}
        </span>
        {count > 1 && (
          <span className="log-count-badge" title={`Repeated ${count} times`}>
            ×{count}
          </span>
        )}
        <div className="action-header-right">
          {log.status !== undefined && (
            <span className={`network-status-badge ${statusType}`} title={statusDesc}>
              {log.status} {log.statusText || statusDesc || ''}
            </span>
          )}
          {log.duration && <span className="network-duration">{log.duration}</span>}
          <button
            className="copy-log-btn"
            title="Copy request and response JSON"
            onClick={() => {
              onCopy(
                log.id,
                JSON.stringify(
                  {
                    method: log.method,
                    url: log.url,
                    status: log.status,
                    duration: log.duration,
                    queryParams,
                    payload: log.payload,
                    response: log.response,
                  },
                  null,
                  2
                )
              );
            }}
          >
            {copiedId === log.id ? <Check size={11} className="copied-icon" /> : <Copy size={11} />}
          </button>
          <span className="action-time">{latestTimestamp || log.timestamp}</span>
        </div>
      </div>

      <div className="network-details">
        {/* Parsed Query Parameters */}
        {queryParams.length > 0 && (
          <div className="network-section">
            <div
              className="network-section-header"
              onClick={() => setShowParams(!showParams)}
            >
              <button className={`section-toggle-btn ${showParams ? 'open' : ''}`}>
                <ChevronRight size={10} />
              </button>
              <span className="section-dot query-dot" />
              <span className="network-section-title">Query Parameters ({queryParams.length})</span>
            </div>
            {showParams && (
              <div className="query-params-table">
                {queryParams.map(([k, v], idx) => (
                  <div key={idx} className="query-param-row">
                    <span className="query-param-key">{highlightMatch(k, searchQuery)}</span>
                    <span className="query-param-sep">=</span>
                    <span className="query-param-val">{highlightMatch(v, searchQuery)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Request Payload */}
        {log.payload !== undefined && (
          <div className="network-section">
            <div
              className="network-section-header"
              onClick={() => setShowPayload(!showPayload)}
            >
              <button className={`section-toggle-btn ${showPayload ? 'open' : ''}`}>
                <ChevronRight size={10} />
              </button>
              <span className="section-dot payload-dot" />
              <span className="network-section-title">Request Payload</span>
            </div>
            {showPayload && (
              <div className="json-wrapper">
                <JsonTreeView data={log.payload} searchQuery={searchQuery} />
              </div>
            )}
          </div>
        )}

        {/* Response Data */}
        {log.response !== undefined && (
          <div className="network-section">
            <div
              className="network-section-header"
              onClick={() => setShowResponse(!showResponse)}
            >
              <button className={`section-toggle-btn ${showResponse ? 'open' : ''}`}>
                <ChevronRight size={10} />
              </button>
              <span className="section-dot response-dot" />
              <span className="network-section-title">Response Data</span>
            </div>
            {showResponse && (
              <div className="json-wrapper">
                <JsonTreeView data={log.response} searchQuery={searchQuery} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const StandardLogItemRow: React.FC<{
  log: ActionLogItem;
  count: number;
  latestTimestamp: string;
  searchQuery: string;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ log, count, latestTimestamp, searchQuery, copiedId, onCopy }) => {
  const [showState, setShowState] = useState(false);
  const isErrorPayload =
    log.payload && typeof log.payload === 'object' && (log.payload.__isError || log.payload.stack);

  return (
    <div className={`action-item ${log.source} ${log.level || ''}`}>
      <div className="action-item-header">
        <span className="source-tag">
          <LogSourceBadge source={log.source} level={log.level} />
        </span>
        <span className="action-name">
          {highlightMatch(log.name, searchQuery)}
        </span>
        {log.endpoint && (
          <span className="redux-endpoint-pill" title={`Endpoint: ${log.endpoint}`}>
            {highlightMatch(log.endpoint, searchQuery)}
          </span>
        )}
        {log.asyncStatus && (
          <span
            className={`async-status-pill ${log.asyncStatus}`}
            title={`Async status: ${log.asyncStatus}`}
          >
            {log.asyncStatus.toUpperCase()}
          </span>
        )}
        {log.changedSlices && log.changedSlices.length > 0 && (
          <span
            className="redux-slice-pill"
            title={`Slices updated: ${log.changedSlices.join(', ')}`}
          >
            {log.changedSlices.length === 1
              ? `slice: ${log.changedSlices[0]}`
              : `slices: ${log.changedSlices.join(', ')}`}
          </span>
        )}
        {count > 1 && (
          <span className="log-count-badge" title={`Repeated ${count} times`}>
            ×{count}
          </span>
        )}
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
            <span>
              {log.location.fileName}:{log.location.line}
            </span>
          </button>
        )}
        <div className="action-header-right">
          {log.duration && <span className="network-duration">{log.duration}</span>}
          <button
            className="copy-log-btn"
            title="Copy payload to clipboard"
            onClick={() => {
              let textToCopy: string;
              if (log.source === 'redux' && (log.endpoint || log.asyncStatus || log.queryArgs || log.changedSlices)) {
                textToCopy = JSON.stringify(
                  {
                    action: log.name,
                    endpoint: log.endpoint,
                    status: log.asyncStatus,
                    duration: log.duration,
                    slices: log.changedSlices,
                    args: log.queryArgs,
                    payload: log.payload,
                  },
                  null,
                  2
                );
              } else if (typeof log.payload === 'object') {
                textToCopy = isErrorPayload
                  ? `${log.payload.message || ''}\n\n${log.payload.stack || ''}`.trim()
                  : JSON.stringify(log.payload, null, 2);
              } else {
                textToCopy = String(log.payload ?? log.name);
              }
              onCopy(log.id, textToCopy);
            }}
          >
            {copiedId === log.id ? <Check size={11} className="copied-icon" /> : <Copy size={11} />}
          </button>
          <span className="action-time">{latestTimestamp || log.timestamp}</span>
        </div>
      </div>

      {/* Redux Query Arguments + Response Payload view for fulfilled async actions */}
      {log.source === 'redux' && log.queryArgs !== undefined && log.asyncStatus === 'fulfilled' ? (
        <div className="standard-log-body">
          <div className="redux-section">
            <div className="network-section-header">
              <span className="section-dot query-dot" />
              <span className="network-section-title">Query Arguments</span>
            </div>
            <div className="json-wrapper">
              <JsonTreeView data={log.queryArgs} searchQuery={searchQuery} />
            </div>
          </div>
          <div className="redux-section" style={{ marginTop: 6 }}>
            <div className="network-section-header">
              <span className="section-dot response-dot" />
              <span className="network-section-title">Result Data</span>
            </div>
            <div className="json-wrapper">
              <JsonTreeView data={log.payload} searchQuery={searchQuery} />
            </div>
          </div>
        </div>
      ) : (
        log.payload !== undefined && (
          <div className="standard-log-body">
            {isErrorPayload ? (
              <div className="error-payload-view">
                {log.payload.message && (
                  <div className="error-payload-msg">{highlightMatch(log.payload.message, searchQuery)}</div>
                )}
                {log.payload.stack && (
                  <pre className="error-payload-stack">{highlightMatch(log.payload.stack, searchQuery)}</pre>
                )}
              </div>
            ) : typeof log.payload === 'object' ? (
              <div className="json-wrapper">
                <JsonTreeView data={log.payload} searchQuery={searchQuery} />
              </div>
            ) : (
              <pre className="action-payload">{highlightMatch(String(log.payload), searchQuery)}</pre>
            )}
          </div>
        )
      )}
    </div>
  );
};

export const ActionPanel: React.FC<ActionPanelProps> = ({ logs, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [viewStoreState, setViewStoreState] = useState(false);

  // Group similar consecutive logs
  const [groupSimilar, setGroupSimilar] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_GROUP_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // Preserve log across reloads
  const [preserveLog, setPreserveLog] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_PRESERVE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Sort order: newest first (top) vs oldest first (stream)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SORT_KEY);
      return saved === 'oldest' ? 'oldest' : 'newest';
    } catch {
      return 'newest';
    }
  });

  // Resizable drawer height
  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_HEIGHT_KEY);
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
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  // Save non-maximized height to localStorage
  useEffect(() => {
    if (!isMaximized && height >= MIN_PANEL_HEIGHT) {
      try {
        localStorage.setItem(STORAGE_HEIGHT_KEY, String(height));
      } catch {}
    }
  }, [height, isMaximized]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GROUP_KEY, String(groupSimilar));
    } catch {}
  }, [groupSimilar]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PRESERVE_KEY, String(preserveLog));
    } catch {}
  }, [preserveLog]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SORT_KEY, sortOrder);
    } catch {}
  }, [sortOrder]);

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

  // Global hotkey: Ctrl+` or Cmd+` or Ctrl+J to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key === '~' || e.key.toLowerCase() === 'j')) {
        e.preventDefault();
        setIsExpanded((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
        if (log.endpoint && log.endpoint.toLowerCase().includes(q)) return true;
        if (log.asyncStatus && log.asyncStatus.toLowerCase().includes(q)) return true;
        if (log.url && log.url.toLowerCase().includes(q)) return true;
        if (log.method && log.method.toLowerCase().includes(q)) return true;
        if (log.status && String(log.status).includes(q)) return true;
        if (log.location?.fileName?.toLowerCase().includes(q)) return true;
        if (log.location?.functionName?.toLowerCase().includes(q)) return true;
        if (log.queryArgs !== undefined) {
          const argsStr =
            typeof log.queryArgs === 'object' ? JSON.stringify(log.queryArgs) : String(log.queryArgs);
          if (argsStr.toLowerCase().includes(q)) return true;
        }
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

  // Group similar consecutive logs
  const groupedLogs = useMemo(() => {
    const list = sortOrder === 'oldest' ? [...filteredLogs].reverse() : filteredLogs;
    if (!groupSimilar) {
      return list.map((log) => ({
        key: log.id,
        log,
        count: 1,
        firstTimestamp: log.timestamp,
        latestTimestamp: log.timestamp,
      }));
    }

    const groups: GroupedLogItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const log = list[i];
      const sig = getLogSignature(log);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.signature === sig) {
        lastGroup.count++;
        lastGroup.latestTimestamp = log.timestamp;
      } else {
        groups.push({
          key: log.id || `group-${i}`,
          signature: sig,
          log,
          count: 1,
          firstTimestamp: log.timestamp,
          latestTimestamp: log.timestamp,
        });
      }
    }
    return groups;
  }, [filteredLogs, groupSimilar, sortOrder]);

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

  // Auto-scroll management for stream mode
  const handleScroll = useCallback(() => {
    if (!listBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listBodyRef.current;
    isNearBottomRef.current = scrollHeight - (scrollTop + clientHeight) < 40;
  }, []);

  useEffect(() => {
    if (sortOrder === 'oldest' && isNearBottomRef.current && listBodyRef.current) {
      listBodyRef.current.scrollTop = listBodyRef.current.scrollHeight;
    }
  }, [groupedLogs, sortOrder]);

  const handleCopyLog = useCallback((id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  }, []);

  const handleCopyAll = useCallback(() => {
    const exportData = filteredLogs.map((item) => ({
      source: item.source,
      level: item.level,
      name: item.name,
      method: item.method,
      url: item.url,
      status: item.status,
      duration: item.duration,
      payload: item.payload,
      response: item.response,
      location: item.location ? `${item.location.fileName}:${item.location.line}` : undefined,
      timestamp: item.timestamp,
    }));
    navigator.clipboard?.writeText(JSON.stringify(exportData, null, 2));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }, [filteredLogs]);

  const handleDownloadLogs = useCallback(() => {
    const exportData = filteredLogs.map((item) => ({
      source: item.source,
      level: item.level,
      name: item.name,
      method: item.method,
      url: item.url,
      status: item.status,
      duration: item.duration,
      payload: item.payload,
      response: item.response,
      location: item.location ? `${item.location.fileName}:${item.location.line}` : undefined,
      timestamp: item.timestamp,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preview-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

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
            title={isExpanded ? 'Collapse drawer (Ctrl+`)' : 'Expand drawer (Ctrl+`)'}
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
              {/* Search Bar */}
              <div className="search-input-wrapper">
                <Search size={11} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search logs, URLs, payloads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                {searchQuery && (
                  <button className="search-clear-btn" onClick={() => setSearchQuery('')}>×</button>
                )}
              </div>

              {/* Group Similar Logs Toggle */}
              <button
                className={`toolbar-icon-btn ${groupSimilar ? 'active' : ''}`}
                onClick={() => setGroupSimilar(!groupSimilar)}
                title={groupSimilar ? 'Grouping consecutive identical logs (Click to un-group)' : 'Click to group consecutive logs'}
              >
                <Layers size={11} />
                <span>Group</span>
              </button>

              {/* Sort Order Toggle */}
              <button
                className={`toolbar-icon-btn ${sortOrder === 'oldest' ? 'active' : ''}`}
                onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                title={sortOrder === 'newest' ? 'Order: Newest first (Click for Stream mode)' : 'Order: Oldest first (Stream mode active)'}
              >
                <ArrowDownUp size={11} />
                <span>{sortOrder === 'newest' ? 'Newest' : 'Stream'}</span>
              </button>

              {/* Live Store State Toggle (when in Redux filter) */}
              {filter === 'redux' && (
                <button
                  className={`toolbar-icon-btn ${viewStoreState ? 'active' : ''}`}
                  onClick={() => setViewStoreState(!viewStoreState)}
                  title={viewStoreState ? 'Switch back to Redux Action stream' : 'Inspect live Redux store state on-demand'}
                >
                  <Database size={11} />
                  <span>{viewStoreState ? 'Actions' : 'Live State'}</span>
                </button>
              )}

              {/* Preserve Log Toggle */}
              <button
                className={`toolbar-icon-btn ${preserveLog ? 'active' : ''}`}
                onClick={() => setPreserveLog(!preserveLog)}
                title={preserveLog ? 'Preserve Log active (logs stay across reloads)' : 'Click to preserve logs across reloads'}
              >
                <Pin size={11} />
                <span>Preserve</span>
              </button>

              {/* Copy All Logs */}
              {filteredLogs.length > 0 && (
                <button
                  className="toolbar-icon-btn"
                  onClick={handleCopyAll}
                  title="Copy all filtered logs to clipboard as JSON"
                >
                  {copiedAll ? <Check size={11} className="copied-icon" /> : <Copy size={11} />}
                  <span>{copiedAll ? 'Copied!' : 'Copy All'}</span>
                </button>
              )}

              {/* Download Logs */}
              {filteredLogs.length > 0 && (
                <button
                  className="toolbar-icon-btn"
                  onClick={handleDownloadLogs}
                  title="Download logs as JSON file"
                >
                  <Download size={11} />
                </button>
              )}

              {/* Clear Logs */}
              {logs.length > 0 && (
                <button className="clear-text-btn" onClick={onClear} title="Clear all logs">
                  <Trash2 size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          <div
            className="action-panel-body"
            ref={listBodyRef}
            onScroll={handleScroll}
          >
            {filter === 'redux' && viewStoreState ? (
              <div className="live-store-view">
                <div className="live-store-header">
                  <div className="live-store-title">
                    <Database size={13} className="live-store-icon" />
                    <span>Live Redux Store State</span>
                    <span className="live-badge">Live</span>
                  </div>
                  <button
                    className="toolbar-icon-btn"
                    onClick={() => {
                      const state = getLiveStoreState();
                      navigator.clipboard?.writeText(JSON.stringify(state, null, 2));
                    }}
                    title="Copy full live store state as JSON"
                  >
                    <Copy size={11} />
                    <span>Copy State</span>
                  </button>
                </div>
                <div className="json-wrapper live-store-tree">
                  <JsonTreeView
                    data={getLiveStoreState()}
                    initialExpandedDepth={1}
                    searchQuery={searchQuery}
                  />
                </div>
              </div>
            ) : groupedLogs.length === 0 ? (
              <div className="action-empty">
                <span>No {filter === 'all' ? 'actions, HTTP requests, or console logs' : filter} recorded yet.</span>
                <small>HTTP requests (axios/fetch/RTK Query), button clicks, console logs, and Redux dispatches appear here live.</small>
              </div>
            ) : (
              <div className="action-list">
                {groupedLogs.map(({ key, log, count, latestTimestamp }) => {
                  if (log.source === 'network') {
                    return (
                      <NetworkLogItemRow
                        key={key}
                        log={log}
                        count={count}
                        latestTimestamp={latestTimestamp}
                        searchQuery={searchQuery}
                        copiedId={copiedId}
                        onCopy={handleCopyLog}
                      />
                    );
                  }

                  return (
                    <StandardLogItemRow
                      key={key}
                      log={log}
                      count={count}
                      latestTimestamp={latestTimestamp}
                      searchQuery={searchQuery}
                      copiedId={copiedId}
                      onCopy={handleCopyLog}
                    />
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
