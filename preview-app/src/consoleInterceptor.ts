import { ActionLogItem } from './MockReduxProvider';

type LogSubscriber = (item: ActionLogItem) => void;
const subscribers = new Set<LogSubscriber>();

export function subscribeToConsoleLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

declare global {
  interface Window {
    __component_preview_console_installed__?: boolean;
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
      const firstArgStr = typeof args[0] === 'string' ? args[0] : '';
      if (
        firstArgStr.startsWith('[vite]') ||
        firstArgStr.startsWith('[react-refresh]') ||
        firstArgStr.startsWith('[HMR]')
      ) {
        return;
      }

      // 3. Format name & payload for visual display
      let name = `console.${level}`;
      let payload: any;

      if (typeof args[0] === 'string') {
        name = args[0];
        payload = args.length === 2 ? args[1] : args.length > 2 ? args.slice(1) : undefined;
      } else {
        payload = args.length === 1 ? args[0] : args.length > 1 ? args : undefined;
      }

      const item: ActionLogItem = {
        id: Math.random().toString(36).substring(2, 9),
        source: 'console',
        level,
        name,
        payload,
        timestamp: new Date().toLocaleTimeString(),
      };

      // 4. Notify React component subscribers
      subscribers.forEach((sub) => {
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
              return JSON.stringify(arg);
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
