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
  RotateCcw,
  Send,
  Play,
  Code,
  Table,
} from 'lucide-react';
import { ActionLogItem } from './MockReduxProvider';
import { navigateToSource } from './errorLocationParser';
import { JsonTreeView, highlightMatch } from './JsonTreeView';
import { copyToClipboard } from './clipboardUtils';
import {
  getLiveStoreState,
  replayAction,
  dispatchCustomAction,
  getKnownActionTypes,
  getKnownSliceNames,
} from './reduxInterceptor';
import {
  generateCurlCommand,
  generateFetchSnippet,
} from './networkInterceptor';
import {
  evaluateConsoleExpression,
} from './consoleInterceptor';

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
  isPinned: boolean;
  onTogglePin: (id: string) => void;
  onCopy: (id: string, text: string) => void;
}> = ({ log, count, latestTimestamp, searchQuery, copiedId, isPinned, onTogglePin, onCopy }) => {
  const [showPayload, setShowPayload] = useState(true);
  const [showResponse, setShowResponse] = useState(true);
  const [showParams, setShowParams] = useState(true);
  const [showReqHeaders, setShowReqHeaders] = useState(false);
  const [showResHeaders, setShowResHeaders] = useState(false);

  const isPending = log.isPending;
  const isSuccess = log.status && log.status >= 200 && log.status < 400;
  const isClientError = log.status && log.status >= 400 && log.status < 500;
  const statusType = isPending ? 'pending' : isSuccess ? 'success' : isClientError ? 'warn' : 'error';
  const method = log.method || 'GET';
  const statusDesc = getStatusDescription(log.status);
  const queryParams = useMemo(() => parseQueryParams(log.url), [log.url]);
  const reqHeadersEntries = useMemo(
    () => (log.requestHeaders ? Object.entries(log.requestHeaders) : []),
    [log.requestHeaders]
  );
  const resHeadersEntries = useMemo(
    () => (log.responseHeaders ? Object.entries(log.responseHeaders) : []),
    [log.responseHeaders]
  );

  return (
    <div className={`action-item network ${statusType} ${isPinned ? 'is-pinned' : ''}`}>
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
          {isPending ? (
            <span className="network-status-badge pending" title="Request in flight...">
              <span className="pending-pulse-dot" /> PENDING
            </span>
          ) : log.status !== undefined ? (
            <span className={`network-status-badge ${statusType}`} title={statusDesc}>
              {log.status} {log.statusText || statusDesc || ''}
            </span>
          ) : null}
          {log.duration && <span className="network-duration">{log.duration}</span>}

          {/* Copy as cURL */}
          <button
            className="copy-log-btn"
            title="Copy as cURL command"
            onClick={() => onCopy(log.id + '-curl', generateCurlCommand(log))}
          >
            {copiedId === log.id + '-curl' ? <Check size={11} className="copied-icon" /> : <Code size={11} />}
          </button>

          {/* Copy JSON */}
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
                    requestHeaders: log.requestHeaders,
                    responseHeaders: log.responseHeaders,
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

          {/* Pin toggle */}
          <button
            className={`pin-item-btn ${isPinned ? 'pinned' : ''}`}
            title={isPinned ? 'Unpin this log' : 'Pin this log to top'}
            onClick={() => onTogglePin(log.id)}
          >
            <Pin size={11} />
          </button>

          <span className="action-time">{latestTimestamp || log.timestamp}</span>
        </div>
      </div>

      <div className="network-details">
        {/* Request Headers */}
        {reqHeadersEntries.length > 0 && (
          <div className="network-section">
            <div
              className="network-section-header"
              onClick={() => setShowReqHeaders(!showReqHeaders)}
            >
              <button className={`section-toggle-btn ${showReqHeaders ? 'open' : ''}`}>
                <ChevronRight size={10} />
              </button>
              <span className="section-dot req-header-dot" />
              <span className="network-section-title">Request Headers ({reqHeadersEntries.length})</span>
            </div>
            {showReqHeaders && (
              <div className="headers-table">
                {reqHeadersEntries.map(([k, v], idx) => (
                  <div key={idx} className="header-row">
                    <span className="header-key">{highlightMatch(k, searchQuery)}</span>
                    <span className="header-colon">:</span>
                    <span className="header-val">{highlightMatch(v, searchQuery)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
                <JsonTreeView data={log.payload} searchQuery={searchQuery} showControls={true} />
              </div>
            )}
          </div>
        )}

        {/* Response Headers */}
        {resHeadersEntries.length > 0 && (
          <div className="network-section">
            <div
              className="network-section-header"
              onClick={() => setShowResHeaders(!showResHeaders)}
            >
              <button className={`section-toggle-btn ${showResHeaders ? 'open' : ''}`}>
                <ChevronRight size={10} />
              </button>
              <span className="section-dot res-header-dot" />
              <span className="network-section-title">Response Headers ({resHeadersEntries.length})</span>
            </div>
            {showResHeaders && (
              <div className="headers-table">
                {resHeadersEntries.map(([k, v], idx) => (
                  <div key={idx} className="header-row">
                    <span className="header-key">{highlightMatch(k, searchQuery)}</span>
                    <span className="header-colon">:</span>
                    <span className="header-val">{highlightMatch(v, searchQuery)}</span>
                  </div>
                ))}
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
                <JsonTreeView data={log.response} searchQuery={searchQuery} showControls={true} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ReduxQuerySection: React.FC<{
  log: ActionLogItem;
  searchQuery: string;
  onCopy: (id: string, text: string) => void;
  copiedId: string | null;
}> = ({ log, searchQuery, onCopy, copiedId }) => {
  const [activeTab, setActiveTab] = useState<'both' | 'result' | 'args'>('both');
  const [showArgs, setShowArgs] = useState(true);
  const [showResult, setShowResult] = useState(true);
  const [showError, setShowError] = useState(true);
  const [argsViewMode, setArgsViewMode] = useState<'table' | 'json'>('table');

  const isPending = log.asyncStatus === 'pending';
  const isFulfilled = log.asyncStatus === 'fulfilled';
  const isRejected = log.asyncStatus === 'rejected';

  // Format queryArgs
  const hasArgs = log.queryArgs !== undefined && log.queryArgs !== null;
  const isFlatArgsObject =
    hasArgs &&
    typeof log.queryArgs === 'object' &&
    !Array.isArray(log.queryArgs) &&
    Object.keys(log.queryArgs).length > 0 &&
    Object.values(log.queryArgs).every(
      (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    );
  const flatArgsEntries = isFlatArgsObject ? Object.entries(log.queryArgs) : [];
  const argsCount = hasArgs
    ? typeof log.queryArgs === 'object'
      ? Array.isArray(log.queryArgs)
        ? `${log.queryArgs.length} items`
        : `${Object.keys(log.queryArgs).length} param${Object.keys(log.queryArgs).length > 1 ? 's' : ''}`
      : typeof log.queryArgs
    : 'void';

  // Result data
  const resultData = isFulfilled ? log.payload : undefined;
  const hasResult = resultData !== undefined;
  const resultCount = hasResult
    ? Array.isArray(resultData)
      ? `${resultData.length} items`
      : typeof resultData === 'object' && resultData !== null
      ? `${Object.keys(resultData).length} fields`
      : typeof resultData
    : null;

  // Error data
  const errorInfo = isRejected ? (log.queryError || log.payload?.error || log.payload) : null;
  const errorResponse = isRejected ? (log.payload?.response || (log.payload?.status ? log.payload : null)) : null;
  const errorMessage =
    errorInfo?.message ||
    (typeof errorInfo === 'string' ? errorInfo : undefined) ||
    errorResponse?.data?.message ||
    (errorResponse?.status ? `HTTP ${errorResponse.status}` : 'Endpoint request rejected');

  return (
    <div className={`redux-query-card ${log.asyncStatus || 'fulfilled'}`}>
      {/* Query Card Header / Meta Bar */}
      <div className="query-card-header">
        <div className="query-meta-left">
          <span className={`query-type-tag ${log.queryType || 'query'}`}>
            {log.queryType === 'mutation' ? <Zap size={10} /> : <Database size={10} />}
            <span>{log.queryType ? log.queryType.toUpperCase() : 'RTK QUERY'}</span>
          </span>
          {log.endpoint && (
            <span className="query-endpoint-name" title={`Endpoint: ${log.endpoint}`}>
              {highlightMatch(log.endpoint, searchQuery)}
              <span className="endpoint-parens">()</span>
            </span>
          )}
          <span className={`query-status-badge ${log.asyncStatus || 'fulfilled'}`}>
            {isPending ? (
              <>
                <span className="pending-pulse-dot" /> PENDING
              </>
            ) : isRejected ? (
              <>
                <AlertCircle size={10} /> REJECTED
              </>
            ) : (
              <>
                <Check size={10} /> FULFILLED
              </>
            )}
          </span>
          {log.duration && (
            <span className="query-duration-pill" title={`Execution time: ${log.duration}`}>
              {log.duration}
            </span>
          )}
        </div>

        {/* View Switcher Tabs: Both, Result, Arguments */}
        {(isFulfilled || isRejected) && hasArgs && (
          <div className="query-view-tabs">
            <button
              className={`query-tab-btn ${activeTab === 'both' ? 'active' : ''}`}
              onClick={() => setActiveTab('both')}
              title="Show both Arguments and Result"
            >
              All
            </button>
            <button
              className={`query-tab-btn ${activeTab === 'result' ? 'active' : ''}`}
              onClick={() => setActiveTab('result')}
              title="Focus on Result Data"
            >
              {isRejected ? 'Error' : 'Result'}
            </button>
            <button
              className={`query-tab-btn ${activeTab === 'args' ? 'active' : ''}`}
              onClick={() => setActiveTab('args')}
              title="Focus on Query Arguments"
            >
              Arguments
            </button>
          </div>
        )}
      </div>

      {/* 1. Pending Banner */}
      {isPending && (
        <div className="query-pending-banner">
          <span className="pending-pulse-dot" />
          <span className="pending-banner-text">
            Request in flight... waiting for response from {log.endpoint || 'endpoint'}.
          </span>
        </div>
      )}

      {/* 2. Arguments Section */}
      {(activeTab === 'both' || activeTab === 'args') && (
        <div className="redux-query-box args-box">
          <div className="query-box-header" onClick={() => setShowArgs(!showArgs)}>
            <button className={`section-toggle-btn ${showArgs ? 'open' : ''}`}>
              <ChevronRight size={10} />
            </button>
            <span className="section-dot query-dot" />
            <span className="query-box-title">Query Arguments</span>
            <span className="query-count-badge">{argsCount}</span>

            <div className="query-box-actions" onClick={(e) => e.stopPropagation()}>
              {isFlatArgsObject && (
                <button
                  className={`query-mini-btn ${argsViewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setArgsViewMode(argsViewMode === 'table' ? 'json' : 'table')}
                  title={argsViewMode === 'table' ? 'Switch to JSON view' : 'Switch to Parameters Table view'}
                >
                  {argsViewMode === 'table' ? <Code size={10} /> : <Table size={10} />}
                  <span>{argsViewMode === 'table' ? 'JSON' : 'Table'}</span>
                </button>
              )}
              {hasArgs && (
                <button
                  className="query-mini-btn"
                  title="Copy query arguments to clipboard"
                  onClick={() => onCopy(log.id + '-args', JSON.stringify(log.queryArgs, null, 2))}
                >
                  {copiedId === log.id + '-args' ? <Check size={10} className="copied-icon" /> : <Copy size={10} />}
                  <span>{copiedId === log.id + '-args' ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>
          </div>

          {showArgs && (
            <div className="query-box-body">
              {!hasArgs || (typeof log.queryArgs === 'object' && Object.keys(log.queryArgs).length === 0) ? (
                <div className="query-empty-state">
                  <span className="empty-symbol">∅</span>
                  <span>No query arguments passed (void / default cache key)</span>
                </div>
              ) : isFlatArgsObject && argsViewMode === 'table' ? (
                <div className="query-params-table">
                  {flatArgsEntries.map(([k, v], idx) => {
                    const valType = typeof v;
                    return (
                      <div key={idx} className="query-param-row">
                        <span className="query-param-key">{highlightMatch(k, searchQuery)}</span>
                        <span className="query-param-sep">=</span>
                        <span className={`query-param-val val-${valType}`}>
                          {valType === 'string'
                            ? `"${highlightMatch(String(v), searchQuery)}"`
                            : highlightMatch(String(v), searchQuery)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="json-wrapper">
                  <JsonTreeView data={log.queryArgs} searchQuery={searchQuery} showControls={true} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Result Section (Fulfilled) */}
      {isFulfilled && (activeTab === 'both' || activeTab === 'result') && (
        <div className="redux-query-box result-box">
          <div className="query-box-header" onClick={() => setShowResult(!showResult)}>
            <button className={`section-toggle-btn ${showResult ? 'open' : ''}`}>
              <ChevronRight size={10} />
            </button>
            <span className="section-dot response-dot" />
            <span className="query-box-title">Result Data</span>
            {resultCount && <span className="query-count-badge result">{resultCount}</span>}

            <div className="query-box-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="query-mini-btn"
                title="Copy result payload to clipboard"
                onClick={() => onCopy(log.id + '-result', JSON.stringify(resultData, null, 2))}
              >
                {copiedId === log.id + '-result' ? <Check size={10} className="copied-icon" /> : <Copy size={10} />}
                <span>{copiedId === log.id + '-result' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {showResult && (
            <div className="query-box-body">
              {resultData === null || resultData === undefined ? (
                <div className="query-empty-state">
                  <span>Result is empty ({String(resultData)})</span>
                </div>
              ) : typeof resultData === 'object' ? (
                <div className="json-wrapper">
                  <JsonTreeView data={resultData} searchQuery={searchQuery} showControls={true} />
                </div>
              ) : (
                <pre className="action-payload">{highlightMatch(String(resultData), searchQuery)}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Error Section (Rejected) */}
      {isRejected && (activeTab === 'both' || activeTab === 'result') && (
        <div className="redux-query-box error-box">
          <div className="query-box-header" onClick={() => setShowError(!showError)}>
            <button className={`section-toggle-btn ${showError ? 'open' : ''}`}>
              <ChevronRight size={10} />
            </button>
            <span className="section-dot error-dot" />
            <span className="query-box-title">Query Rejected</span>
            {errorResponse?.status && (
              <span className="query-status-badge rejected">HTTP {errorResponse.status}</span>
            )}
          </div>

          {showError && (
            <div className="query-box-body">
              <div className="query-error-banner">
                <AlertCircle size={14} className="query-error-icon" />
                <div className="query-error-content">
                  <div className="query-error-title">{errorMessage}</div>
                  {errorResponse?.data && (
                    <div className="query-error-response-section">
                      <span className="query-error-subhead">Server Response:</span>
                      <div className="json-wrapper">
                        <JsonTreeView data={errorResponse.data} searchQuery={searchQuery} showControls={true} />
                      </div>
                    </div>
                  )}
                  {errorInfo?.stack && (
                    <pre className="error-payload-stack">{errorInfo.stack}</pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DiffUpdatedItem: React.FC<{
  fieldKey: string;
  chg: { before: any; after: any };
  searchQuery: string;
}> = ({ fieldKey, chg, searchQuery }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isComplex =
    (chg.before !== null && typeof chg.before === 'object') ||
    (chg.after !== null && typeof chg.after === 'object');

  if (!isComplex) {
    const renderPrimitiveVal = (val: any) => {
      if (val === null) return <span className="diff-val-null">null</span>;
      if (val === undefined) return <span className="diff-val-null">undefined</span>;
      if (typeof val === 'boolean') return <span className="diff-val-bool">{String(val)}</span>;
      if (typeof val === 'number') return <span className="diff-val-num">{val}</span>;
      if (typeof val === 'string') {
        const text = val === '' ? '""' : val;
        return <span className="diff-val-str">{highlightMatch(text, searchQuery)}</span>;
      }
      return <span>{String(val)}</span>;
    };

    return (
      <div className="diff-field-item primitive">
        <span className="diff-field-name">{highlightMatch(fieldKey, searchQuery)}:</span>
        <span className="diff-old-val">{renderPrimitiveVal(chg.before)}</span>
        <span className="diff-arrow">→</span>
        <span className="diff-new-val">{renderPrimitiveVal(chg.after)}</span>
      </div>
    );
  }

  const renderSummary = (val: any) => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (Array.isArray(val)) return `Array(${val.length})`;
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      return keys.length === 0 ? '{}' : `{ ${keys.length} ${keys.length === 1 ? 'field' : 'fields'} }`;
    }
    return String(val);
  };

  return (
    <div className={`diff-field-item complex ${isExpanded ? 'open' : ''}`}>
      <div className="diff-complex-header" onClick={() => setIsExpanded(!isExpanded)}>
        <button className={`section-toggle-btn ${isExpanded ? 'open' : ''}`}>
          <ChevronRight size={10} />
        </button>
        <span className="diff-field-name">{highlightMatch(fieldKey, searchQuery)}:</span>
        <span className="diff-complex-summary">
          <span className="diff-old-summary">{renderSummary(chg.before)}</span>
          <span className="diff-arrow">→</span>
          <span className="diff-new-summary">{renderSummary(chg.after)}</span>
        </span>
        <span className="diff-expand-btn">{isExpanded ? 'Collapse' : 'Inspect'}</span>
      </div>
      {isExpanded && (
        <div className="diff-complex-panes">
          <div className="diff-pane before-pane">
            <div className="diff-pane-title">Before</div>
            {chg.before === undefined || chg.before === null ? (
              <div className="diff-pane-empty">{String(chg.before)}</div>
            ) : typeof chg.before === 'object' ? (
              <div className="json-wrapper">
                <JsonTreeView data={chg.before} searchQuery={searchQuery} showControls={false} />
              </div>
            ) : (
              <div className="diff-pane-primitive">{String(chg.before)}</div>
            )}
          </div>
          <div className="diff-pane after-pane">
            <div className="diff-pane-title">After</div>
            {chg.after === undefined || chg.after === null ? (
              <div className="diff-pane-empty">{String(chg.after)}</div>
            ) : typeof chg.after === 'object' ? (
              <div className="json-wrapper">
                <JsonTreeView data={chg.after} searchQuery={searchQuery} showControls={false} />
              </div>
            ) : (
              <div className="diff-pane-primitive">{String(chg.after)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const StandardLogItemRow: React.FC<{
  log: ActionLogItem;
  count: number;
  latestTimestamp: string;
  searchQuery: string;
  copiedId: string | null;
  isPinned: boolean;
  onTogglePin: (id: string) => void;
  onCopy: (id: string, text: string) => void;
}> = ({ log, count, latestTimestamp, searchQuery, copiedId, isPinned, onTogglePin, onCopy }) => {
  const [replayed, setReplayed] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const isErrorPayload =
    log.payload && typeof log.payload === 'object' && (log.payload.__isError || log.payload.stack);

  const isQueryOrAsync =
    log.source === 'redux' &&
    (Boolean(log.endpoint) || log.queryArgs !== undefined || Boolean(log.asyncStatus));

  return (
    <div className={`action-item ${log.source} ${log.level || ''} ${isPinned ? 'is-pinned' : ''}`}>
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
        {log.queryType && (
          <span className={`query-type-pill ${log.queryType}`} title={`Query type: ${log.queryType}`}>
            {log.queryType === 'mutation' ? <Zap size={9} /> : <Database size={9} />}
            <span>{log.queryType.toUpperCase()}</span>
          </span>
        )}
        {log.asyncStatus && (
          <span
            className={`async-status-pill ${log.asyncStatus}`}
            title={`Async status: ${log.asyncStatus}`}
          >
            {log.asyncStatus === 'pending' && <span className="pending-pulse-dot" />}
            {log.asyncStatus === 'fulfilled' && <Check size={9} />}
            {log.asyncStatus === 'rejected' && <AlertCircle size={9} />}
            <span>{log.asyncStatus.toUpperCase()}</span>
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

          {/* Replay button for Redux actions */}
          {log.source === 'redux' && (
            <button
              className="replay-action-btn"
              title="Replay / Re-dispatch this action"
              onClick={(e) => {
                e.stopPropagation();
                const success = replayAction(log);
                if (success) {
                  setReplayed(true);
                  setTimeout(() => setReplayed(false), 1200);
                }
              }}
            >
              {replayed ? <Check size={11} className="copied-icon" /> : <RotateCcw size={11} />}
              <span>{replayed ? 'Dispatched' : 'Replay'}</span>
            </button>
          )}

          {/* Copy payload */}
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
                    stateDiff: log.stateDiff,
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

          {/* Pin toggle */}
          <button
            className={`pin-item-btn ${isPinned ? 'pinned' : ''}`}
            title={isPinned ? 'Unpin this log' : 'Pin this log to top'}
            onClick={() => onTogglePin(log.id)}
          >
            <Pin size={11} />
          </button>

          <span className="action-time">{latestTimestamp || log.timestamp}</span>
        </div>
      </div>

      {/* 1. Redux RTK Query / Async Thunk Detailed Inspector (Shown prominently above diff) */}
      {isQueryOrAsync && (
        <ReduxQuerySection
          log={log}
          searchQuery={searchQuery}
          onCopy={onCopy}
          copiedId={copiedId}
        />
      )}

      {/* 2. Redux State Diff Section */}
      {log.stateDiff && Object.keys(log.stateDiff).length > 0 && (
        <div className="state-diff-section">
          <div
            className="network-section-header"
            onClick={() => setShowDiff(!showDiff)}
          >
            <button className={`section-toggle-btn ${showDiff ? 'open' : ''}`}>
              <ChevronRight size={10} />
            </button>
            <span className="section-dot diff-dot" />
            <span className="network-section-title">
              State Diff ({Object.keys(log.stateDiff).join(', ')})
            </span>
          </div>
          {showDiff && (
            <div className="state-diff-body">
              {Object.entries(log.stateDiff).map(([sliceName, diff]: [string, any]) => {
                const isApiSlice = sliceName.toLowerCase().endsWith('api') || sliceName.includes('Api');
                return (
                  <div key={sliceName} className={`slice-diff-box ${isApiSlice ? 'api-cache' : ''}`}>
                    <div className="slice-diff-title">
                      <span>{sliceName}</span>
                      {isApiSlice && <span className="slice-type-pill">API CACHE</span>}
                    </div>
                    {diff.added && Object.keys(diff.added).length > 0 && (
                      <div className="diff-row diff-added">
                        <span className="diff-badge added">+ ADDED</span>
                        <JsonTreeView data={diff.added} searchQuery={searchQuery} showControls={true} />
                      </div>
                    )}
                    {diff.updated && Object.keys(diff.updated).length > 0 && (
                      <div className="diff-row diff-updated">
                        <span className="diff-badge updated">~ UPDATED</span>
                        <div className="diff-updated-fields">
                          {Object.entries(diff.updated).map(([fieldKey, chg]: [string, any]) => (
                            <DiffUpdatedItem
                              key={fieldKey}
                              fieldKey={fieldKey}
                              chg={chg}
                              searchQuery={searchQuery}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {diff.deleted && diff.deleted.length > 0 && (
                      <div className="diff-row diff-deleted">
                        <span className="diff-badge deleted">- REMOVED</span>
                        <span className="diff-deleted-names">{diff.deleted.join(', ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. console.table View */}
      {log.tableData && (
        <div className="console-table-container">
          <table className="console-table">
            <thead>
              <tr>
                {log.tableData.columns.map((col: string) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.tableData.rows.map((row: any, rIdx: number) => (
                <tr key={rIdx}>
                  {log.tableData.columns.map((col: string) => (
                    <td key={col}>{highlightMatch(String(row[col] ?? ''), searchQuery)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Standard payload view for non-query actions */}
      {!isQueryOrAsync && log.payload !== undefined && !log.tableData && (
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
              <JsonTreeView data={log.payload} searchQuery={searchQuery} showControls={true} />
            </div>
          ) : (
            <pre className="action-payload">{highlightMatch(String(log.payload), searchQuery)}</pre>
          )}
        </div>
      )}
    </div>
  );
};

export const ActionPanel: React.FC<ActionPanelProps> = ({ logs, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [viewStoreState, setViewStoreState] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Sub-filters
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sliceFilter, setSliceFilter] = useState<string>('ALL');
  const [consoleLevelFilter, setConsoleLevelFilter] = useState<string>('ALL');

  // Redux Action Dispatcher state
  const [showDispatchBar, setShowDispatchBar] = useState(false);
  const [dispatchType, setDispatchType] = useState('');
  const [dispatchPayload, setDispatchPayload] = useState('{}');
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  // Console REPL state
  const [replInput, setReplInput] = useState('');
  const [replHistory, setReplHistory] = useState<string[]>([]);
  const [replHistoryIdx, setReplHistoryIdx] = useState(-1);

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

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDispatchAction = useCallback(() => {
    if (!dispatchType.trim()) return;
    try {
      let parsedPayload: any = undefined;
      const trimmedPayload = dispatchPayload.trim();
      if (trimmedPayload) {
        parsedPayload = JSON.parse(trimmedPayload);
      }
      dispatchCustomAction({
        type: dispatchType.trim(),
        payload: parsedPayload,
      });
      setDispatchError(null);
      setDispatchSuccess(true);
      setTimeout(() => setDispatchSuccess(false), 1500);
      setDispatchPayload('{}');
    } catch (err: any) {
      setDispatchError(err?.message || 'Invalid JSON payload');
    }
  }, [dispatchType, dispatchPayload]);

  const handleReplSubmit = useCallback(() => {
    if (!replInput.trim()) return;
    const expr = replInput.trim();
    setReplHistory((prev) => [expr, ...prev.slice(0, 49)]);
    setReplHistoryIdx(-1);
    evaluateConsoleExpression(expr);
    setReplInput('');
  }, [replInput]);

  const handleReplKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleReplSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (replHistory.length > 0) {
          const nextIdx = Math.min(replHistoryIdx + 1, replHistory.length - 1);
          setReplHistoryIdx(nextIdx);
          setReplInput(replHistory[nextIdx]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (replHistoryIdx > 0) {
          const nextIdx = replHistoryIdx - 1;
          setReplHistoryIdx(nextIdx);
          setReplInput(replHistory[nextIdx]);
        } else if (replHistoryIdx === 0) {
          setReplHistoryIdx(-1);
          setReplInput('');
        }
      }
    },
    [handleReplSubmit, replHistory, replHistoryIdx]
  );

  // Available slices from logs and store
  const availableSlices = useMemo(() => {
    const set = new Set<string>(getKnownSliceNames());
    logs.forEach((l) => {
      if (l.changedSlices) l.changedSlices.forEach((s) => set.add(s));
    });
    return Array.from(set);
  }, [logs]);

  // Filter logs with primary and secondary sub-filters
  const filteredLogs = useMemo(() => {
    let result = logs;

    // Primary filter
    if (filter === 'errors') {
      result = result.filter((log) => log.source === 'error' || log.level === 'error');
    } else if (filter !== 'all') {
      result = result.filter((log) => log.source === filter);
    }

    // Secondary sub-filters
    if (filter === 'network') {
      if (methodFilter !== 'ALL') {
        result = result.filter((log) => (log.method || 'GET').toUpperCase() === methodFilter);
      }
      if (statusFilter !== 'ALL') {
        result = result.filter((log) => {
          if (!log.status) return false;
          if (statusFilter === '2xx') return log.status >= 200 && log.status < 300;
          if (statusFilter === '4xx') return log.status >= 400 && log.status < 500;
          if (statusFilter === '5xx') return log.status >= 500 && log.status < 600;
          return true;
        });
      }
    } else if (filter === 'redux') {
      if (sliceFilter !== 'ALL') {
        result = result.filter(
          (log) =>
            log.changedSlices?.includes(sliceFilter) ||
            log.name.toLowerCase().startsWith(sliceFilter.toLowerCase() + '/')
        );
      }
    } else if (filter === 'console') {
      if (consoleLevelFilter !== 'ALL') {
        result = result.filter((log) => log.level === consoleLevelFilter);
      }
    }

    // Text search filter (with regex & case-sensitivity support)
    if (searchQuery.trim()) {
      let tester: (text: string) => boolean;
      if (useRegex) {
        try {
          const flags = matchCase ? '' : 'i';
          const re = new RegExp(searchQuery.trim(), flags);
          tester = (str) => re.test(str);
        } catch {
          const q = matchCase ? searchQuery.trim() : searchQuery.trim().toLowerCase();
          tester = (str) => (matchCase ? str : str.toLowerCase()).includes(q);
        }
      } else {
        const q = matchCase ? searchQuery.trim() : searchQuery.trim().toLowerCase();
        tester = (str) => (matchCase ? str : str.toLowerCase()).includes(q);
      }

      result = result.filter((log) => {
        if (tester(log.name)) return true;
        if (log.endpoint && tester(log.endpoint)) return true;
        if (log.asyncStatus && tester(log.asyncStatus)) return true;
        if (log.url && tester(log.url)) return true;
        if (log.method && tester(log.method)) return true;
        if (log.status && tester(String(log.status))) return true;
        if (log.location?.fileName && tester(log.location.fileName)) return true;
        if (log.location?.functionName && tester(log.location.functionName)) return true;
        if (log.queryArgs !== undefined) {
          const argsStr =
            typeof log.queryArgs === 'object' ? JSON.stringify(log.queryArgs) : String(log.queryArgs);
          if (tester(argsStr)) return true;
        }
        if (log.payload !== undefined) {
          const payloadStr =
            typeof log.payload === 'object' ? JSON.stringify(log.payload) : String(log.payload);
          if (tester(payloadStr)) return true;
        }
        if (log.response !== undefined) {
          const respStr =
            typeof log.response === 'object' ? JSON.stringify(log.response) : String(log.response);
          if (tester(respStr)) return true;
        }
        return false;
      });
    }

    return result;
  }, [
    logs,
    filter,
    methodFilter,
    statusFilter,
    sliceFilter,
    consoleLevelFilter,
    searchQuery,
    useRegex,
    matchCase,
  ]);

  // Group similar consecutive logs and float pinned logs to top
  const groupedLogs = useMemo(() => {
    const list = sortOrder === 'oldest' ? [...filteredLogs].reverse() : filteredLogs;
    if (!groupSimilar) {
      const items = list.map((log) => ({
        key: log.id,
        log,
        count: 1,
        firstTimestamp: log.timestamp,
        latestTimestamp: log.timestamp,
      }));
      const pinned = items.filter((i) => pinnedIds.has(i.log.id));
      const unpinned = items.filter((i) => !pinnedIds.has(i.log.id));
      return [...pinned, ...unpinned];
    }

    const groups: GroupedLogItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const log = list[i];
      const sig = getLogSignature(log);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.signature === sig && !pinnedIds.has(log.id)) {
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

    const pinned = groups.filter((g) => pinnedIds.has(g.log.id));
    const unpinned = groups.filter((g) => !pinnedIds.has(g.log.id));
    return [...pinned, ...unpinned];
  }, [filteredLogs, groupSimilar, sortOrder, pinnedIds]);

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
    copyToClipboard(text);
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
    copyToClipboard(JSON.stringify(exportData, null, 2));
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
          {pinnedIds.size > 0 && (
            <span className="action-badge pinned-count" title={`${pinnedIds.size} pinned log(s)`}>
              <Pin size={9} /> {pinnedIds.size}
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
              {/* Search Bar with Regex & Match Case options */}
              <div className="search-input-wrapper">
                <Search size={11} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search logs, URLs, payloads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                <button
                  className={`search-opt-btn ${useRegex ? 'active' : ''}`}
                  onClick={() => setUseRegex(!useRegex)}
                  title="Toggle Regular Expression"
                >
                  .*
                </button>
                <button
                  className={`search-opt-btn ${matchCase ? 'active' : ''}`}
                  onClick={() => setMatchCase(!matchCase)}
                  title="Toggle Match Case"
                >
                  Aa
                </button>
                {searchQuery && (
                  <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
                    ×
                  </button>
                )}
              </div>

              {/* Group Similar Logs Toggle */}
              <button
                className={`toolbar-icon-btn ${groupSimilar ? 'active' : ''}`}
                onClick={() => setGroupSimilar(!groupSimilar)}
                title={groupSimilar ? 'Grouping consecutive identical logs' : 'Click to group consecutive logs'}
              >
                <Layers size={11} />
                <span>Group</span>
              </button>

              {/* Sort Order Toggle */}
              <button
                className={`toolbar-icon-btn ${sortOrder === 'oldest' ? 'active' : ''}`}
                onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                title={sortOrder === 'newest' ? 'Order: Newest first' : 'Order: Oldest first (Stream mode active)'}
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

          {/* Sub-toolbar for HTTP filter */}
          {filter === 'network' && (
            <div className="action-sub-toolbar">
              <div className="sub-filter-chips">
                <span className="sub-filter-label">Method:</span>
                {['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                  <button
                    key={m}
                    className={`sub-chip ${methodFilter === m ? 'active' : ''}`}
                    onClick={() => setMethodFilter(m)}
                  >
                    {m}
                  </button>
                ))}
                <span className="sub-filter-divider" />
                <span className="sub-filter-label">Status:</span>
                {['ALL', '2xx', '4xx', '5xx'].map((s) => (
                  <button
                    key={s}
                    className={`sub-chip ${statusFilter === s ? 'active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sub-toolbar for Redux filter */}
          {filter === 'redux' && !viewStoreState && (
            <div className="action-sub-toolbar">
              <div className="sub-filter-chips">
                <span className="sub-filter-label">Slice:</span>
                <button
                  className={`sub-chip ${sliceFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSliceFilter('ALL')}
                >
                  ALL
                </button>
                {availableSlices.map((s) => (
                  <button
                    key={s}
                    className={`sub-chip ${sliceFilter === s ? 'active' : ''}`}
                    onClick={() => setSliceFilter(s)}
                  >
                    {s}
                  </button>
                ))}
                <span className="sub-filter-divider" />
                <button
                  className={`sub-chip action-dispatch-toggle ${showDispatchBar ? 'active' : ''}`}
                  onClick={() => setShowDispatchBar(!showDispatchBar)}
                  title="Toggle custom action dispatcher"
                >
                  <Send size={10} />
                  <span>Dispatch Action</span>
                </button>
              </div>

              {/* Inline Action Dispatcher */}
              {showDispatchBar && (
                <div className="dispatch-action-bar">
                  <input
                    type="text"
                    placeholder="Action type (e.g. cart/addItem)"
                    list="known-actions-datalist"
                    value={dispatchType}
                    onChange={(e) => setDispatchType(e.target.value)}
                    className="dispatch-type-input"
                  />
                  <datalist id="known-actions-datalist">
                    {getKnownActionTypes().map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                  <input
                    type="text"
                    placeholder='JSON Payload (e.g. {"id": 1})'
                    value={dispatchPayload}
                    onChange={(e) => setDispatchPayload(e.target.value)}
                    className="dispatch-payload-input"
                  />
                  <button
                    className={`dispatch-submit-btn ${dispatchSuccess ? 'success' : ''}`}
                    onClick={handleDispatchAction}
                    disabled={!dispatchType.trim()}
                    title="Dispatch action to store"
                  >
                    {dispatchSuccess ? <Check size={11} /> : <Send size={11} />}
                    <span>{dispatchSuccess ? 'Dispatched!' : 'Dispatch'}</span>
                  </button>
                  {dispatchError && <span className="dispatch-error-text">{dispatchError}</span>}
                </div>
              )}
            </div>
          )}

          {/* Sub-toolbar for Console filter */}
          {filter === 'console' && (
            <div className="action-sub-toolbar">
              <div className="sub-filter-chips">
                <span className="sub-filter-label">Level:</span>
                {['ALL', 'error', 'warn', 'info', 'log'].map((lvl) => (
                  <button
                    key={lvl}
                    className={`sub-chip ${consoleLevelFilter === lvl ? 'active' : ''}`}
                    onClick={() => setConsoleLevelFilter(lvl)}
                  >
                    {lvl.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

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
                      copyToClipboard(JSON.stringify(state, null, 2));
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
                    showControls={true}
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
                  const isPinned = pinnedIds.has(log.id);

                  if (log.source === 'network') {
                    return (
                      <NetworkLogItemRow
                        key={key}
                        log={log}
                        count={count}
                        latestTimestamp={latestTimestamp}
                        searchQuery={searchQuery}
                        copiedId={copiedId}
                        isPinned={isPinned}
                        onTogglePin={handleTogglePin}
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
                      isPinned={isPinned}
                      onTogglePin={handleTogglePin}
                      onCopy={handleCopyLog}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Console REPL input (when in Console tab or All tab) */}
          {(filter === 'console' || filter === 'all') && (
            <div className="console-repl-bar">
              <span className="repl-prompt">&gt;</span>
              <input
                type="text"
                placeholder="Evaluate JS ($store, $props, $state, window)..."
                value={replInput}
                onChange={(e) => setReplInput(e.target.value)}
                onKeyDown={handleReplKeyDown}
                className="repl-input"
              />
              <button className="repl-run-btn" onClick={handleReplSubmit} title="Evaluate (Enter)">
                <Play size={10} />
                <span>Run</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
