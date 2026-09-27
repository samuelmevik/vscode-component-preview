import { ActionLogItem } from './MockReduxProvider';

export type ReduxLogListener = (item: ActionLogItem) => void;

const globalListeners = new Set<ReduxLogListener>();
const seenActions = new WeakSet<object>();
const pendingRequestMap = new Map<string, number>();

let activeStore: any = null;

/**
 * Returns the currently active Redux store instance.
 */
export function getActiveStore(): any {
  return activeStore;
}

/**
 * Returns the live, current Redux store state on-demand.
 * This avoids storing heavy state trees on every logged action in memory.
 */
export function getLiveStoreState(): any {
  if (activeStore && typeof activeStore.getState === 'function') {
    try {
      return activeStore.getState();
    } catch {}
  }
  return undefined;
}

/**
 * Filter out internal Redux Toolkit, Redux core, and router plumbing actions
 * so the Redux drawer remains clean, readable, and focused on business logic.
 */
export function isInternalReduxAction(type?: string): boolean {
  if (!type || typeof type !== 'string') return true;
  if (type.startsWith('@@redux/')) return true;
  if (type.startsWith('@@router/')) return true;
  if (type.includes('/internal_')) return true;
  if (type.endsWith('/middlewareRegistered')) return true;
  return false;
}

/**
 * Identify which top-level slices changed by shallow reference identity.
 * Runs in O(slices) time (typically < 0.01ms) without duplicating memory.
 */
export function getChangedSliceNames(prev: any, next: any): string[] {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return [];
  const changed: string[] = [];
  try {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      if (prev[key] !== next[key]) {
        changed.push(key);
      }
    }
  } catch {}
  return changed;
}

/**
 * Safely sanitizes payloads for logging to prevent freezing or memory bloat
 * on huge objects, massive arrays (e.g. 50,000 items), circular structures, or deep nesting.
 */
export function sanitizePayload(
  val: any,
  depth = 0,
  seen = new WeakSet<object>()
): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.length > 2000 ? val.slice(0, 2000) + '… (truncated)' : val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'function') {
    return `[Function: ${val.name || 'anonymous'}]`;
  }
  if (typeof val === 'object') {
    if (seen.has(val)) return '[Circular]';
    seen.add(val);

    if (depth >= 5) {
      return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
    }

    if (Array.isArray(val)) {
      if (val.length > 50) {
        const sliced = val.slice(0, 50).map((i) => sanitizePayload(i, depth + 1, seen));
        sliced.push(`… (+ ${val.length - 50} more items)`);
        return sliced;
      }
      return val.map((i) => sanitizePayload(i, depth + 1, seen));
    }

    // Plain object
    const res: Record<string, any> = {};
    const keys = Object.keys(val);
    const maxKeys = 80;
    for (let i = 0; i < Math.min(keys.length, maxKeys); i++) {
      const k = keys[i];
      try {
        res[k] = sanitizePayload(val[k], depth + 1, seen);
      } catch {
        res[k] = '[Unreadable]';
      }
    }
    if (keys.length > maxKeys) {
      res['__truncated__'] = `… (+ ${keys.length - maxKeys} more keys)`;
    }
    return res;
  }
  return String(val);
}

/**
 * Format and extract clean, informative ActionLogItem from any Redux action.
 * Handles RTK Query (endpoints, queryArgs, requestId, lifecycle),
 * createAsyncThunk (arg, status, duration), and standard slice actions.
 */
export function extractActionLog(
  action: any,
  changedSlices?: string[]
): ActionLogItem | null {
  if (typeof action !== 'object' || action === null) return null;
  if (seenActions.has(action)) return null;
  seenActions.add(action);

  if (isInternalReduxAction(action.type)) return null;

  const meta = action.meta;
  const asyncStatus: 'pending' | 'fulfilled' | 'rejected' | undefined = meta?.requestStatus;
  const endpoint: string | undefined = meta?.arg?.endpointName;
  const queryArgs: any = meta?.arg?.originalArgs !== undefined ? meta.arg.originalArgs : meta?.arg;

  let duration: string | undefined;
  if (meta?.requestId) {
    if (asyncStatus === 'pending') {
      pendingRequestMap.set(meta.requestId, Date.now());
    } else if (asyncStatus === 'fulfilled' || asyncStatus === 'rejected') {
      const startTime = pendingRequestMap.get(meta.requestId);
      if (startTime) {
        duration = `${Date.now() - startTime}ms`;
        pendingRequestMap.delete(meta.requestId);
      }
    }
  }

  // Determine intelligent payload
  let payload = action.payload;
  if (payload === undefined && queryArgs !== undefined) {
    payload = { args: queryArgs };
  } else if (asyncStatus === 'rejected') {
    payload = {
      error: action.error,
      response: action.payload,
      ...(queryArgs !== undefined ? { args: queryArgs } : {}),
    };
  } else if (payload === undefined && typeof action === 'object') {
    const { type, meta: _meta, error: _err, ...rest } = action;
    if (Object.keys(rest).length > 0) {
      payload = rest;
    }
  }

  const isError = asyncStatus === 'rejected' || Boolean(action.error);

  return {
    id: Math.random().toString(36).substring(2, 9),
    source: 'redux',
    level: isError ? 'error' : undefined,
    name: action.type,
    payload: sanitizePayload(payload),
    duration,
    asyncStatus,
    endpoint,
    queryArgs: sanitizePayload(queryArgs),
    changedSlices: changedSlices && changedSlices.length > 0 ? changedSlices : undefined,
    timestamp: new Date().toLocaleTimeString(),
  };
}

/**
 * Wrap a thunk function recursively so that any actions dispatched inside it
 * (including nested thunks, pending/fulfilled/rejected, and custom dispatch calls)
 * are intercepted, tracked, and logged with full arguments and response payloads.
 */
export function wrapThunk(
  fn: Function,
  store: any,
  notify: ReduxLogListener
): Function {
  const wrapped = function (innerDispatch: any, innerGetState: any, extra: any) {
    const trackingDispatch = function (subAction: any, ...args: any[]) {
      if (typeof subAction === 'function') {
        return innerDispatch(wrapThunk(subAction, store, notify), ...args);
      }

      let prevSubState: any;
      try {
        prevSubState = store?.getState?.();
      } catch {}

      // Execute dispatch to update state
      const result = innerDispatch(subAction, ...args);

      let nextSubState: any;
      try {
        nextSubState = store?.getState?.();
      } catch {}

      const changedSlices = getChangedSliceNames(prevSubState, nextSubState);

      // Extract and notify listeners
      const item = extractActionLog(subAction, changedSlices);
      if (item) {
        notify(item);
      }

      return result;
    };

    return fn(trackingDispatch, innerGetState, extra);
  };

  try {
    if (fn.name) {
      Object.defineProperty(wrapped, 'name', { value: fn.name });
    }
  } catch {}

  return wrapped;
}

/**
 * Intercept a Redux store instance by wrapping dispatch with thunk and action tracking.
 */
export function interceptStore(
  realStore: any,
  onActionDispatched: ReduxLogListener
): void {
  if (!realStore || typeof realStore.dispatch !== 'function') return;

  activeStore = realStore;
  realStore.__preview_listener__ = onActionDispatched;
  if (realStore.__preview_intercepted__) return;

  const originalDispatch = realStore.dispatch.bind(realStore);

  realStore.dispatch = function (action: any) {
    const listener = realStore.__preview_listener__;

    if (typeof action === 'function') {
      // Check if it's a named custom thunk
      if (
        action.name &&
        action.name !== 'anonymous' &&
        action.name !== 'action' &&
        !action.name.startsWith('bound ')
      ) {
        listener?.({
          id: Math.random().toString(36).substring(2, 9),
          source: 'redux',
          name: `[Thunk] ${action.name}`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }

      // Wrap thunk to capture all inner dispatched actions (pending, fulfilled, rejected, etc.)
      const wrapped = wrapThunk(action, realStore, (item) => {
        listener?.(item);
      });

      return originalDispatch(wrapped);
    }

    let prevState: any;
    try {
      prevState = realStore.getState();
    } catch {}

    // Standard action object
    const result = originalDispatch(action);

    let nextState: any;
    try {
      nextState = realStore.getState();
    } catch {}

    const changedSlices = getChangedSliceNames(prevState, nextState);
    const item = extractActionLog(action, changedSlices);
    if (item) {
      listener?.(item);
    }
    return result;
  };

  realStore.__preview_intercepted__ = true;
}

function broadcastLog(item: ActionLogItem): void {
  globalListeners.forEach((fn) => {
    try {
      fn(item);
    } catch (e) {
      console.error('[Component Preview] Redux listener error:', e);
    }
  });
}

/**
 * Subscribe to Redux logs emitted by any intercepted store.
 */
export function subscribeToReduxLogs(listener: ReduxLogListener): () => void {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

/**
 * Installs global Redux DevTools extension hooks (window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
 * and window.__REDUX_DEVTOOLS_EXTENSION__) so that any store created by Redux Toolkit
 * or standard Redux is automatically intercepted even before MockReduxProvider mounts.
 */
export function installReduxInterceptor(): void {
  if (typeof window === 'undefined') return;

  const win = window as any;
  if (win.__component_preview_redux_installed__) return;
  win.__component_preview_redux_installed__ = true;

  const existingCompose = win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__;

  win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = function (...args: any[]) {
    const origComposeFunc =
      typeof existingCompose === 'function' ? existingCompose(...args) : undefined;

    return function (...enhancers: any[]) {
      const previewEnhancer = (createStore: any) => (reducer: any, preloadedState: any) => {
        const store = createStore(reducer, preloadedState);
        interceptStore(store, (item) => broadcastLog(item));
        return store;
      };

      if (origComposeFunc) {
        return origComposeFunc(...enhancers, previewEnhancer);
      }

      // Default compose
      return (createStore: any) => (reducer: any, preloadedState: any) => {
        let store = createStore(reducer, preloadedState);
        for (const enhancer of [...enhancers, previewEnhancer]) {
          if (typeof enhancer === 'function') {
            store = enhancer(createStore)(reducer, preloadedState);
          }
        }
        return store;
      };
    };
  };

  const existingExt = win.__REDUX_DEVTOOLS_EXTENSION__;
  win.__REDUX_DEVTOOLS_EXTENSION__ = function (...args: any[]) {
    if (typeof existingExt === 'function') {
      try {
        return existingExt(...args);
      } catch {}
    }
    return (createStore: any) => (reducer: any, preloadedState: any) => {
      const store = createStore(reducer, preloadedState);
      interceptStore(store, (item) => broadcastLog(item));
      return store;
    };
  };
}

// Automatically install global DevTools hooks on import
installReduxInterceptor();
