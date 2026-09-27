import { ActionLogItem } from './MockReduxProvider';

type NetworkSubscriber = (item: ActionLogItem) => void;

declare global {
  interface Window {
    __component_preview_network_installed__?: boolean;
    __component_preview_network_subscribers__?: Set<NetworkSubscriber>;
    __component_preview_native_fetch__?: typeof fetch;
  }
}

const fallbackNetworkSubscribers = new Set<NetworkSubscriber>();

function getNetworkSubscribers(): Set<NetworkSubscriber> {
  if (typeof window === 'undefined') return fallbackNetworkSubscribers;
  if (!window.__component_preview_network_subscribers__) {
    window.__component_preview_network_subscribers__ = new Set();
  }
  return window.__component_preview_network_subscribers__;
}

export function subscribeToNetworkLogs(subscriber: NetworkSubscriber): () => void {
  const subs = getNetworkSubscribers();
  subs.add(subscriber);
  return () => {
    subs.delete(subscriber);
  };
}

export function shouldIgnoreUrl(url: string, init?: RequestInit | any): boolean {
  if (!url) return true;

  // 1. Explicit internal request markers
  if (init?.headers) {
    const h = init.headers;
    if (
      (typeof Headers !== 'undefined' && h instanceof Headers && (h.has('x-component-preview-internal') || h.has('x-preview-internal'))) ||
      (typeof h === 'object' && ('x-component-preview-internal' in h || 'x-preview-internal' in h))
    ) {
      return true;
    }
  }

  // 2. Vite and component preview internal path segments
  if (
    url.includes('/@vite/') ||
    url.includes('/@fs/') ||
    url.includes('/@id/') ||
    url.includes('/@react-refresh') ||
    url.includes('/__preview') ||
    url.includes('/__preview_api') ||
    url.includes('/node_modules/') ||
    url.includes('.vite/') ||
    url.includes('hot-update')
  ) {
    return true;
  }

  try {
    const loc = typeof window !== 'undefined' && window.location ? window.location.href : 'http://127.0.0.1:4545';
    const parsed = new URL(url, loc);
    const locOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : new URL(loc).origin;

    // If the request is to the local Vite preview server origin
    if (parsed.origin === locOrigin) {
      const p = parsed.pathname;

      // Ignore internal prefixes
      if (p.startsWith('/@') || p.startsWith('/__')) {
        return true;
      }

      // Ignore Vite module cache-busting and transform queries (?t=timestamp, ?import, ?direct, etc.)
      if (
        parsed.searchParams.has('t') ||
        parsed.searchParams.has('import') ||
        parsed.searchParams.has('direct') ||
        parsed.searchParams.has('raw') ||
        parsed.searchParams.has('url') ||
        parsed.searchParams.has('worker')
      ) {
        return true;
      }

      // Ignore Vite source file, stylesheet, asset, and sourcemap loads on the preview server
      if (/\.(tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less|vue|svelte|map|json|wasm)$/i.test(p)) {
        return true;
      }
    }
  } catch {}

  return false;
}

function tryParseJson(text: any): any {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  return text;
}

function parsePayload(body: any): any {
  if (!body) return undefined;
  if (typeof body === 'string') return tryParseJson(body);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: Record<string, any> = {};
    body.forEach((value, key) => {
      entries[key] = value instanceof File ? `[File: ${value.name}]` : value;
    });
    return entries;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    const entries: Record<string, any> = {};
    body.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }
  if (typeof body === 'object') return body;
  return String(body);
}

function notifySubscribers(item: ActionLogItem) {
  getNetworkSubscribers().forEach((sub) => {
    try {
      sub(item);
    } catch {}
  });

  // Forward to VS Code output channel
  try {
    const statusText = item.status ? `[${item.status}]` : '[FAILED]';
    const durationText = item.duration ? `(${item.duration})` : '';
    const logLine = `${item.method} ${item.url} ${statusText} ${durationText}`;
    window.parent.postMessage(
      {
        type: 'CONSOLE_LOG',
        payload: {
          level: item.level || 'info',
          text: `[HTTP] ${logLine}`,
          timestamp: item.timestamp,
        },
      },
      '*'
    );
  } catch {}
}

export function installNetworkInterceptor(): void {
  if (typeof window === 'undefined' || window.__component_preview_network_installed__) {
    return;
  }
  window.__component_preview_network_installed__ = true;

  // 1. Intercept window.fetch (Used by fetch, RTK Query createApi fetchBaseQuery, modern axios adapters)
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.__component_preview_native_fetch__ = originalFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let rawUrl = '';
      if (typeof input === 'string') {
        rawUrl = input;
      } else if (input instanceof URL) {
        rawUrl = input.toString();
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        rawUrl = input.url;
      }

      if (shouldIgnoreUrl(rawUrl, init)) {
        return originalFetch(input, init);
      }

      const method = (init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
      const payload = parsePayload(init?.body);
      const startTime = performance.now();
      const timestamp = new Date().toLocaleTimeString();
      const id = Math.random().toString(36).substring(2, 9);

      try {
        const response = await originalFetch(input, init);
        const duration = `${Math.round(performance.now() - startTime)}ms`;

        // Clone response to inspect body without consuming the original stream
        let responseBody: any;
        try {
          const clone = response.clone();
          const text = await clone.text();
          responseBody = tryParseJson(text);
        } catch {
          responseBody = '[Unreadable Response Stream]';
        }

        const isSuccess = response.status >= 200 && response.status < 400;
        const logItem: ActionLogItem = {
          id,
          source: 'network',
          level: isSuccess ? 'info' : 'error',
          name: `${method} ${rawUrl}`,
          method,
          url: rawUrl,
          payload,
          response: responseBody,
          status: response.status,
          statusText: response.statusText,
          duration,
          timestamp,
        };

        notifySubscribers(logItem);
        return response;
      } catch (err: any) {
        const duration = `${Math.round(performance.now() - startTime)}ms`;
        const logItem: ActionLogItem = {
          id,
          source: 'network',
          level: 'error',
          name: `${method} ${rawUrl}`,
          method,
          url: rawUrl,
          payload,
          response: { error: err?.message || 'Network Request Failed' },
          status: 0,
          statusText: 'Failed',
          duration,
          timestamp,
        };

        notifySubscribers(logItem);
        throw err;
      }
    };
  }

  // 2. Intercept XMLHttpRequest (Used by default Axios browser adapter)
  if (typeof window.XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ): void {
      (this as any).__preview_method = (method || 'GET').toUpperCase();
      (this as any).__preview_url = String(url);
      return (originalOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
      const url = (this as any).__preview_url || '';
      const method = (this as any).__preview_method || 'GET';

      if (shouldIgnoreUrl(url)) {
        return originalSend.apply(this, arguments as any);
      }

      const startTime = performance.now();
      const timestamp = new Date().toLocaleTimeString();
      const id = Math.random().toString(36).substring(2, 9);
      const payload = parsePayload(body);

      const onComplete = () => {
        const duration = `${Math.round(performance.now() - startTime)}ms`;
        let responseBody: any;

        try {
          if (this.responseType === '' || this.responseType === 'text') {
            responseBody = tryParseJson(this.responseText);
          } else if (this.responseType === 'json') {
            responseBody = this.response;
          } else {
            responseBody = `[Response ${this.responseType}]`;
          }
        } catch {
          responseBody = this.response || '[Error reading response]';
        }

        const status = this.status;
        const isSuccess = status >= 200 && status < 400;

        const logItem: ActionLogItem = {
          id,
          source: 'network',
          level: isSuccess ? 'info' : 'error',
          name: `${method} ${url}`,
          method,
          url,
          payload,
          response: responseBody,
          status,
          statusText: this.statusText || (status === 200 ? 'OK' : ''),
          duration,
          timestamp,
        };

        notifySubscribers(logItem);
      };

      this.addEventListener('loadend', onComplete, { once: true });
      return originalSend.apply(this, arguments as any);
    };
  }
}

// Auto-install on module load
installNetworkInterceptor();
