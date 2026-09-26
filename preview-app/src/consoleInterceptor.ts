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

  const levels = ['log', 'info', 'warn', 'error'] as const;

  for (const level of levels) {
    console[level] = (...args: any[]) => {
      // 1. Call native console method so browser devtools still show output
      originalConsole[level](...args);

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
      if (level === 'error') {
        const errorArg = args.find((a) => a instanceof Error || (a && typeof a === 'object' && a.stack));
        if (errorArg) {
          const parsed = parseErrorInfo(errorArg);
          location = parsed.primaryLocation;
        }
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

      // 4. Notify React component subscribers
      const subs = getConsoleSubscribers();
      subs.forEach((sub) => {
        try {
          sub(item);
        } catch {}
      });

      // 5. Forward serialized log to parent webview host for VS Code Output panel
      try {
        const serialized = args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return arg.stack || arg.message;
            try {
              return JSON.stringify(serializeLogArg(arg));
            } catch {
              return String(arg);
            }
          })
          .join(' ');

        window.parent.postMessage(
          {
            type: 'CONSOLE_LOG',
            payload: {
              level,
              text: serialized,
              timestamp: item.timestamp,
            },
          },
          '*'
        );
      } catch {}
    };
  }
}

// Auto-install on module import
installConsoleInterceptor();
