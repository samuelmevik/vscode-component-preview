import { ActionLogItem } from './MockReduxProvider';

type LogSubscriber = (item: ActionLogItem) => void;
const subscribers = new Set<LogSubscriber>();

export function subscribeToConsoleLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

// Global declaration for window tracking
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

  const levels: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error'];

  levels.forEach((level) => {
    console[level] = (...args: any[]) => {
      // 1. Call native console method so devtools still show output
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
      let payload: any = undefined;

      if (args.length === 1) {
        if (typeof args[0] === 'string') {
          name = args[0];
        } else {
          name = `console.${level}`;
          payload = args[0];
        }
      } else if (args.length > 1) {
        if (typeof args[0] === 'string') {
          name = args[0];
          payload = args.length === 2 ? args[1] : args.slice(1);
        } else {
          name = `console.${level}`;
          payload = args;
        }
      }

      const item: ActionLogItem = {
        id: Math.random().toString(36).substring(2, 9),
        source: 'console',
        level,
        name,
        payload,
        timestamp: new Date().toLocaleTimeString(),
      };

      // 4. Notify all React component subscribers (Harness instances)
      subscribers.forEach((sub) => {
        try {
          sub(item);
        } catch (e) { }
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
      } catch (e) { }
    };
  });
}

// Auto-install on module import
installConsoleInterceptor();
