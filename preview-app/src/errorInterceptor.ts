import { ErrorLocation, parseErrorInfo } from './errorLocationParser';

export interface RuntimeErrorItem {
  id: string;
  message: string;
  source: 'event' | 'promise' | 'callback' | 'render';
  location?: ErrorLocation;
  timestamp: string;
  error?: Error;
  stack?: string;
}

type ErrorSubscriber = (item: RuntimeErrorItem) => void;

declare global {
  interface Window {
    __component_preview_error_installed__?: boolean;
    __component_preview_error_subscribers__?: Set<ErrorSubscriber>;
    __component_preview_report_error__?: typeof reportRuntimeError;
    __component_preview_active_source_file__?: string;
  }
}

const fallbackSubscribers = new Set<ErrorSubscriber>();

function getSubscribers(): Set<ErrorSubscriber> {
  if (typeof window === 'undefined') return fallbackSubscribers;
  if (!window.__component_preview_error_subscribers__) {
    window.__component_preview_error_subscribers__ = new Set();
  }
  return window.__component_preview_error_subscribers__;
}

// Prevent error loops from flooding the UI
const recentErrors = new Map<string, number>();

export function subscribeToRuntimeErrors(subscriber: ErrorSubscriber): () => void {
  const subs = getSubscribers();
  subs.add(subscriber);
  return () => {
    subs.delete(subscriber);
  };
}

export function setActiveSourceFile(filePath?: string) {
  if (typeof window !== 'undefined') {
    window.__component_preview_active_source_file__ = filePath;
  }
}

export function getActiveSourceFile(): string | undefined {
  if (typeof window !== 'undefined') {
    return window.__component_preview_active_source_file__;
  }
  return undefined;
}

export function reportRuntimeError(
  err: any,
  source: 'event' | 'promise' | 'callback' | 'render' = 'event',
  fallbackFile?: string
): RuntimeErrorItem | null {
  const parsed = parseErrorInfo(err, fallbackFile || getActiveSourceFile());
  const message = parsed.message || 'An unhandled runtime error occurred.';
  const dedupKey = `${message}-${parsed.primaryLocation?.filePath}:${parsed.primaryLocation?.line}`;

  const now = Date.now();
  const lastSeen = recentErrors.get(dedupKey) || 0;
  if (now - lastSeen < 1000) {
    // Suppress rapid duplicates within 1 second
    return null;
  }
  recentErrors.set(dedupKey, now);

  // Clean old entries from recentErrors
  if (recentErrors.size > 50) {
    for (const [k, time] of recentErrors.entries()) {
      if (now - time > 10000) recentErrors.delete(k);
    }
  }

  const stack = err instanceof Error ? err.stack : typeof err === 'string' ? err : err?.stack;

  const item: RuntimeErrorItem = {
    id: Math.random().toString(36).substring(2, 9),
    message,
    source,
    location: parsed.primaryLocation,
    timestamp: new Date().toLocaleTimeString(),
    error: err instanceof Error ? err : undefined,
    stack: typeof stack === 'string' ? stack : undefined,
  };

  // 1. Notify all active React UI subscribers
  const subs = getSubscribers();
  subs.forEach((sub) => {
    try {
      sub(item);
    } catch {}
  });

  // 2. Forward to VS Code Webview parent host and dev server API
  if (typeof window !== 'undefined') {
    const payload = {
      message: item.message,
      source: item.source,
      location: item.location,
      stack: item.stack,
      timestamp: item.timestamp,
    };

    try {
      window.parent.postMessage(
        {
          type: 'RUNTIME_ERROR',
          payload,
        },
        '*'
      );
    } catch {}

    try {
      fetch('/__preview_api/report_error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }

  return item;
}

export function installErrorInterceptor(): void {
  if (typeof window === 'undefined' || window.__component_preview_error_installed__) {
    return;
  }
  window.__component_preview_error_installed__ = true;
  window.__component_preview_report_error__ = reportRuntimeError;

  // 1. Intercept uncaught exceptions in capture phase (e.g. onClick or synchronous function throws)
  window.addEventListener(
    'error',
    (event: ErrorEvent) => {
      // Ignore harmless browser noise
      if (
        event.message?.includes('ResizeObserver loop') ||
        event.message?.includes('Script error.')
      ) {
        return;
      }

      const err = event.error || new Error(event.message);
      reportRuntimeError(err, 'event', event.filename);
    },
    true
  );

  // 2. Intercept unhandled Promise rejections (e.g. async/await or RTK Query errors)
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const err =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));

    reportRuntimeError(err, 'promise');
  });

  // 3. Global onerror fallback
  const existingOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    if (error) {
      reportRuntimeError(error, 'event', typeof source === 'string' ? source : undefined);
    }
    if (typeof existingOnError === 'function') {
      return existingOnError.apply(this, [message, source, lineno, colno, error]);
    }
    return false;
  };
}

// Auto-install upon module import
installErrorInterceptor();
