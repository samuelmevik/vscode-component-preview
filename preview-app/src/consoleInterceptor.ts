import { ActionLogItem } from './MockReduxProvider';
import { parseErrorInfo, ErrorLocation } from './errorLocationParser';

type LogSubscriber = (item: ActionLogItem) => void;

declare global {
  interface Window {
    __component_preview_console_installed__?: boolean;
    __component_preview_console_subscribers__?: Set<LogSubscriber>;
  }
}

const fallbackConsoleSubscribers = new Set<LogSubscriber>();

function getConsoleSubscribers(): Set<LogSubscriber> {
  if (typeof window === 'undefined') return fallbackConsoleSubscribers;
  if (!window.__component_preview_console_subscribers__) {
    window.__component_preview_console_subscribers__ = new Set();
  }
  return window.__component_preview_console_subscribers__;
}

export function subscribeToConsoleLogs(subscriber: LogSubscriber): () => void {
  const subs = getConsoleSubscribers();
  subs.add(subscriber);
  return () => {
    subs.delete(subscriber);
  };
}

export function serializeLogArg(arg: any, depth = 0): any {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg !== 'object' && typeof arg !== 'function') return arg;
  if (depth > 4) return '[Object]';

  if (arg instanceof Error) {
    return {
      __isError: true,
      name: arg.name || 'Error',
      message: arg.message || String(arg),
      stack: arg.stack,
    };
  }

  if (Array.isArray(arg)) {
    return arg.map((item) => serializeLogArg(item, depth + 1));
  }

  if (typeof (arg as any).nodeType === 'number') {
    return `<${(arg as HTMLElement).tagName?.toLowerCase() || 'element'} />`;
  }

  try {
    const res: Record<string, any> = {};
    for (const key of Object.keys(arg)) {
      res[key] = serializeLogArg(arg[key], depth + 1);
    }
    if (arg.message && !res.message) res.message = arg.message;
    if (arg.stack && !res.stack) res.stack = arg.stack;
    return res;
  } catch {
    return String(arg);
  }
}

export function installConsoleInterceptor(): void {
  if (typeof window === 'undefined' || window.__component_preview_console_installed__) {
    return;
  }
  window.__component_preview_console_installed__ = true;

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  let isAssertRunning = false;
  const levels = ['log', 'info', 'warn', 'error'] as const;

  for (const level of levels) {
    console[level] = (...args: any[]) => {
      // 1. Call native console method so browser devtools still show output
      originalConsole[level](...args);

      if (isAssertRunning) return;

      // 2. Filter out internal Vite and React Refresh messages to keep preview clean
      // (Only filter non-error logs so build/server errors still show up)
      const firstArgStr = typeof args[0] === 'string' ? args[0] : '';
      if (
        level !== 'error' &&
        (firstArgStr.startsWith('[vite]') ||
          firstArgStr.startsWith('[react-refresh]') ||
          firstArgStr.startsWith('[HMR]'))
      ) {
        return;
      }

      // 3. Format name & payload for visual display
      let name = `console.${level}`;
      let rawPayload: any;

      if (typeof args[0] === 'string') {
        name = args[0];
        rawPayload = args.length === 2 ? args[1] : args.length > 2 ? args.slice(1) : undefined;
      } else {
        rawPayload = args.length === 1 ? args[0] : args.length > 1 ? args : undefined;
      }

      let location: ErrorLocation | undefined;
      const errorArg = args.find((a) => a instanceof Error || (a && typeof a === 'object' && a.stack));
      if (errorArg) {
        const parsed = parseErrorInfo(errorArg);
        location = parsed.primaryLocation;
      } else {
        try {
          const traceErr = new Error();
          const parsed = parseErrorInfo(traceErr);
          location = parsed.primaryLocation;
        } catch {}
      }

      const payload = serializeLogArg(rawPayload);

      const item: ActionLogItem = {
        id: Math.random().toString(36).substring(2, 9),
        source: 'console',
        level,
        name,
        payload,
        timestamp: new Date().toLocaleTimeString(),
        location,
      };

      broadcastConsoleItem(item, args);
    };
  }

  // 6. Intercept console.table
  const originalTable = typeof console.table === 'function' ? console.table.bind(console) : undefined;
  console.table = (data: any, columns?: string[]) => {
    if (originalTable) originalTable(data, columns);
    const tableData = formatTableData(data, columns);
    const item: ActionLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      source: 'console',
      level: 'info',
      name: 'console.table',
      payload: serializeLogArg(data),
      tableData,
      timestamp: new Date().toLocaleTimeString(),
    };
    broadcastConsoleItem(item, [data]);
  };

  // 7. Intercept console.time & console.timeEnd
  const activeTimers = new Map<string, number>();
  const originalTime = typeof console.time === 'function' ? console.time.bind(console) : undefined;
  const originalTimeEnd = typeof console.timeEnd === 'function' ? console.timeEnd.bind(console) : undefined;

  console.time = (label: string = 'default') => {
    if (originalTime) originalTime(label);
    activeTimers.set(label, performance.now());
  };

  console.timeEnd = (label: string = 'default') => {
    if (originalTimeEnd) originalTimeEnd(label);
    const startTime = activeTimers.get(label);
    if (startTime !== undefined) {
      const elapsed = (performance.now() - startTime).toFixed(1);
      activeTimers.delete(label);
      const item: ActionLogItem = {
        id: Math.random().toString(36).substring(2, 9),
        source: 'console',
        level: 'info',
        name: `timer: ${label}`,
        duration: `${elapsed}ms`,
        payload: `${label}: ${elapsed}ms`,
        timestamp: new Date().toLocaleTimeString(),
      };
      broadcastConsoleItem(item, [`${label}: ${elapsed}ms`]);
    }
  };

  // 8. Intercept console.count & console.countReset
  const activeCounts = new Map<string, number>();
  const originalCount = typeof console.count === 'function' ? console.count.bind(console) : undefined;
  const originalCountReset = typeof console.countReset === 'function' ? console.countReset.bind(console) : undefined;

  console.count = (label: string = 'default') => {
    if (originalCount) originalCount(label);
    const count = (activeCounts.get(label) || 0) + 1;
    activeCounts.set(label, count);
    const item: ActionLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      source: 'console',
      level: 'info',
      name: `count: ${label}`,
      payload: `${label}: ${count}`,
      timestamp: new Date().toLocaleTimeString(),
    };
    broadcastConsoleItem(item, [`${label}: ${count}`]);
  };

  console.countReset = (label: string = 'default') => {
    if (originalCountReset) originalCountReset(label);
    activeCounts.delete(label);
  };

  // 9. Intercept console.assert
  const originalAssert = typeof console.assert === 'function' ? console.assert.bind(console) : undefined;
  console.assert = (condition: boolean, ...args: any[]) => {
    isAssertRunning = true;
    try {
      if (originalAssert) (originalAssert as any)(condition, ...args);
    } finally {
      isAssertRunning = false;
    }
    if (!condition) {
      const message = args.length > 0 ? args.map((a) => (typeof a === 'string' ? a : serializeLogArg(a))).join(' ') : 'Assertion failed';
      const item: ActionLogItem = {
        id: Math.random().toString(36).substring(2, 9),
        source: 'console',
        level: 'error',
        name: 'Assertion failed',
        payload: message,
        timestamp: new Date().toLocaleTimeString(),
      };
      broadcastConsoleItem(item, ['Assertion failed:', ...args]);
    }
  };

  // 10. Intercept console.dir
  const originalDir = typeof console.dir === 'function' ? console.dir.bind(console) : undefined;
  console.dir = (item: any, options?: any) => {
    if (originalDir) originalDir(item, options);
    const logItem: ActionLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      source: 'console',
      level: 'info',
      name: 'console.dir',
      payload: serializeLogArg(item),
      timestamp: new Date().toLocaleTimeString(),
    };
    broadcastConsoleItem(logItem, [item]);
  };
}

function broadcastConsoleItem(item: ActionLogItem, rawArgs?: any[]) {
  const subs = getConsoleSubscribers();
  subs.forEach((sub) => {
    try {
      sub(item);
    } catch {}
  });

  try {
    const text = rawArgs
      ? rawArgs
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return arg.stack || arg.message;
            try {
              return JSON.stringify(serializeLogArg(arg));
            } catch {
              return String(arg);
            }
          })
          .join(' ')
      : typeof item.payload === 'object'
      ? JSON.stringify(item.payload)
      : String(item.payload ?? item.name);

    window.parent.postMessage(
      {
        type: 'CONSOLE_LOG',
        payload: {
          level: item.level || 'info',
          text,
          timestamp: item.timestamp,
        },
      },
      '*'
    );
    try {
      fetch('/__preview_api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: item.level || 'info',
          text,
          timestamp: item.timestamp,
        }),
      }).catch(() => {});
    } catch {}
  } catch {}
}

export function formatTableData(
  data: any,
  columns?: string[]
): { columns: string[]; rows: Array<Record<string, any>> } | null {
  if (!data || typeof data !== 'object') return null;

  try {
    const rows: Array<Record<string, any>> = [];
    const colSet = new Set<string>();

    if (Array.isArray(data)) {
      data.forEach((entry, idx) => {
        const row: Record<string, any> = { '(index)': idx };
        if (entry && typeof entry === 'object') {
          Object.keys(entry).forEach((k) => {
            if (!columns || columns.includes(k)) {
              colSet.add(k);
              row[k] = entry[k];
            }
          });
        } else {
          colSet.add('Value');
          row['Value'] = entry;
        }
        rows.push(row);
      });
    } else {
      Object.keys(data).forEach((key) => {
        const val = data[key];
        const row: Record<string, any> = { '(index)': key };
        if (val && typeof val === 'object') {
          Object.keys(val).forEach((k) => {
            if (!columns || columns.includes(k)) {
              colSet.add(k);
              row[k] = val[k];
            }
          });
        } else {
          colSet.add('Value');
          row['Value'] = val;
        }
        rows.push(row);
      });
    }

    const finalCols = ['(index)', ...(columns || Array.from(colSet))];
    return { columns: finalCols, rows };
  } catch {
    return null;
  }
}

/**
 * Interactive REPL evaluation in the preview environment.
 * Evaluates JavaScript code with access to $store, $state, $props, and window.
 */
export function evaluateConsoleExpression(
  expression: string
): { result?: any; error?: string } {
  const trimmed = expression.trim();
  if (!trimmed) return {};

  const inputItem: ActionLogItem = {
    id: Math.random().toString(36).substring(2, 9),
    source: 'console',
    level: 'info',
    name: `> ${trimmed}`,
    timestamp: new Date().toLocaleTimeString(),
  };
  broadcastConsoleItem(inputItem);

  try {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    const store = win.__preview_store__ || win.__preview_redux_store__ || (win.store ?? undefined);
    const props = win.__preview_current_props__;
    const state = store && typeof store.getState === 'function' ? store.getState() : undefined;

    let storeProxy: any = store;
    if (store && typeof store.getState === 'function') {
      storeProxy = new Proxy(store, {
        get(target, prop, receiver) {
          if (prop in target) {
            const val = Reflect.get(target, prop, receiver);
            return typeof val === 'function' ? val.bind(target) : val;
          }
          const currentState = target.getState();
          if (currentState && typeof currentState === 'object' && prop in currentState) {
            return currentState[prop];
          }
          return undefined;
        },
      });
    }

    // Evaluate expression or statement (supports debugger;, declarations, etc.)
    let fn: Function;
    try {
      fn = new Function(
        '$store',
        '$state',
        '$props',
        'dispatch',
        '$debug',
        `return (${trimmed});`
      );
    } catch {
      fn = new Function(
        '$store',
        '$state',
        '$props',
        'dispatch',
        '$debug',
        trimmed
      );
    }

    const debugHelper = () => {
      // eslint-disable-next-line no-debugger
      debugger;
      return 'Debugger paused';
    };

    const rawResult = fn(storeProxy, state, props, store?.dispatch?.bind(store), debugHelper);
    const sanitized = serializeLogArg(rawResult);

    let resultPreview = String(rawResult);
    if (typeof rawResult === 'object' && rawResult !== null) {
      resultPreview = Array.isArray(rawResult)
        ? `Array(${rawResult.length})`
        : rawResult.constructor?.name || 'Object';
    }

    const outputItem: ActionLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      source: 'console',
      level: 'info',
      name: `< ${resultPreview}`,
      payload: sanitized,
      timestamp: new Date().toLocaleTimeString(),
    };
    broadcastConsoleItem(outputItem);

    return { result: rawResult };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const errorItem: ActionLogItem = {
      id: Math.random().toString(36).substring(2, 9),
      source: 'console',
      level: 'error',
      name: `< Uncaught ${err?.name || 'Error'}: ${errorMsg}`,
      payload: { message: errorMsg, stack: err?.stack },
      timestamp: new Date().toLocaleTimeString(),
    };
    broadcastConsoleItem(errorItem);

    return { error: errorMsg };
  }
}

// Auto-install on module import
installConsoleInterceptor();
