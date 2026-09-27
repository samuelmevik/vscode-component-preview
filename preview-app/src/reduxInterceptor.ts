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
  if (type.includes('/subscriptions/')) return true;
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
 * Detects whether a state object is an RTK Query API slice reducer state.
 */
export function isRtkQuerySliceState(slice: any): boolean {
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return false;
  return (
    'queries' in slice &&
    ('provided' in slice || 'subscriptions' in slice || 'mutations' in slice || 'config' in slice)
  );
}

/**
 * Extract a human-friendly query or mutation display name from RTK Query entry.
 */
function getRtkQueryEntryLabel(type: 'query' | 'mutation', entry: any, rawKey: string): string {
  const ep = entry?.endpointName;
  if (ep) return `${type}: ${ep}`;
  const match = rawKey.match(/^([a-zA-Z0-9_$]+)\(/);
  if (match) return `${type}: ${match[1]}`;
  return `${type}: ${rawKey.slice(0, 30)}`;
}

/**
 * Computes a specialized diff between two RTK Query API slice states.
 * Filters out internal plumbing (provided tags, subscriptions, config)
 * and diffs individual queries and mutations at the entry level.
 */
export function computeRtkQueryDiff(
  prevSlice: any,
  nextSlice: any
): { added: any; updated: any; deleted: string[] } | null {
  const added: Record<string, any> = {};
  const updated: Record<string, any> = {};
  const deleted: string[] = [];

  const prevQueries = prevSlice?.queries || {};
  const nextQueries = nextSlice?.queries || {};
  const allQueryKeys = new Set([...Object.keys(prevQueries), ...Object.keys(nextQueries)]);

  for (const qKey of allQueryKeys) {
    const prevQ = prevQueries[qKey];
    const nextQ = nextQueries[qKey];

    if (!prevQ && nextQ) {
      const label = getRtkQueryEntryLabel('query', nextQ, qKey);
      added[label] = {
        status: nextQ.status,
        ...(nextQ.originalArgs !== undefined ? { args: sanitizePayload(nextQ.originalArgs) } : {}),
        ...(nextQ.data !== undefined ? { data: sanitizePayload(nextQ.data) } : {}),
        ...(nextQ.error !== undefined ? { error: sanitizePayload(nextQ.error) } : {}),
      };
    } else if (prevQ && !nextQ) {
      const label = getRtkQueryEntryLabel('query', prevQ, qKey);
      deleted.push(label);
    } else if (prevQ !== nextQ) {
      const label = getRtkQueryEntryLabel('query', nextQ, qKey);

      if (prevQ.status !== nextQ.status) {
        updated[`${label} · status`] = {
          before: prevQ.status,
          after: nextQ.status,
        };
      }
      if (prevQ.data !== nextQ.data && nextQ.data !== undefined) {
        updated[`${label} · data`] = {
          before: prevQ.data !== undefined ? sanitizePayload(prevQ.data) : undefined,
          after: sanitizePayload(nextQ.data),
        };
      }
      if (prevQ.error !== nextQ.error && nextQ.error !== undefined) {
        updated[`${label} · error`] = {
          before: prevQ.error !== undefined ? sanitizePayload(prevQ.error) : undefined,
          after: sanitizePayload(nextQ.error),
        };
      }
    }
  }

  // Handle mutations
  const prevMutations = prevSlice?.mutations || {};
  const nextMutations = nextSlice?.mutations || {};
  const allMutationKeys = new Set([...Object.keys(prevMutations), ...Object.keys(nextMutations)]);

  for (const mKey of allMutationKeys) {
    const prevM = prevMutations[mKey];
    const nextM = nextMutations[mKey];

    if (!prevM && nextM) {
      const label = getRtkQueryEntryLabel('mutation', nextM, mKey);
      added[label] = {
        status: nextM.status,
        ...(nextM.originalArgs !== undefined ? { args: sanitizePayload(nextM.originalArgs) } : {}),
        ...(nextM.data !== undefined ? { data: sanitizePayload(nextM.data) } : {}),
        ...(nextM.error !== undefined ? { error: sanitizePayload(nextM.error) } : {}),
      };
    } else if (prevM && !nextM) {
      const label = getRtkQueryEntryLabel('mutation', prevM, mKey);
      deleted.push(label);
    } else if (prevM !== nextM) {
      const label = getRtkQueryEntryLabel('mutation', nextM, mKey);

      if (prevM.status !== nextM.status) {
        updated[`${label} · status`] = {
          before: prevM.status,
          after: nextM.status,
        };
      }
      if (prevM.data !== nextM.data && nextM.data !== undefined) {
        updated[`${label} · data`] = {
          before: prevM.data !== undefined ? sanitizePayload(prevM.data) : undefined,
          after: sanitizePayload(nextM.data),
        };
      }
      if (prevM.error !== nextM.error && nextM.error !== undefined) {
        updated[`${label} · error`] = {
          before: prevM.error !== undefined ? sanitizePayload(prevM.error) : undefined,
          after: sanitizePayload(nextM.error),
        };
      }
    }
  }

  // Handle any custom non-plumbing keys if present
  const ignoredKeys = new Set(['queries', 'mutations', 'provided', 'subscriptions', 'config']);
  const prevKeys = Object.keys(prevSlice || {});
  const nextKeys = Object.keys(nextSlice || {});

  for (const k of nextKeys) {
    if (ignoredKeys.has(k)) continue;
    if (!prevSlice || !(k in prevSlice)) {
      added[k] = sanitizePayload(nextSlice[k]);
    } else if (prevSlice[k] !== nextSlice[k]) {
      updated[k] = {
        before: sanitizePayload(prevSlice[k]),
        after: sanitizePayload(nextSlice[k]),
      };
    }
  }
  for (const k of prevKeys) {
    if (ignoredKeys.has(k)) continue;
    if (!nextSlice || !(k in nextSlice)) {
      deleted.push(k);
    }
  }

  if (Object.keys(added).length === 0 && Object.keys(updated).length === 0 && deleted.length === 0) {
    return null;
  }

  return { added, updated, deleted };
}

/**
 * Computes a detailed diff (added, updated, deleted keys) between two slice states.
 */
export function computeSliceDiff(prevSlice: any, nextSlice: any): { added: any; updated: any; deleted: string[] } | null {
  if (prevSlice === nextSlice) return null;
  if (!prevSlice || !nextSlice || typeof prevSlice !== 'object' || typeof nextSlice !== 'object') {
    return { added: sanitizePayload(nextSlice), updated: {}, deleted: [] };
  }

  if (isRtkQuerySliceState(prevSlice) || isRtkQuerySliceState(nextSlice)) {
    return computeRtkQueryDiff(prevSlice, nextSlice);
  }

  const added: Record<string, any> = {};
  const updated: Record<string, any> = {};
  const deleted: string[] = [];

  const prevKeys = new Set(Object.keys(prevSlice));
  const nextKeys = new Set(Object.keys(nextSlice));

  for (const k of nextKeys) {
    if (!prevKeys.has(k)) {
      added[k] = sanitizePayload(nextSlice[k]);
    } else if (prevSlice[k] !== nextSlice[k]) {
      updated[k] = {
        before: sanitizePayload(prevSlice[k]),
        after: sanitizePayload(nextSlice[k]),
      };
    }
  }
  for (const k of prevKeys) {
    if (!nextKeys.has(k)) {
      deleted.push(k);
    }
  }

  if (Object.keys(added).length === 0 && Object.keys(updated).length === 0 && deleted.length === 0) {
    return null;
  }

  return { added, updated, deleted };
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

const knownActionTypes = new Set<string>();
const knownSliceNames = new Set<string>();

export function getKnownActionTypes(): string[] {
  return Array.from(knownActionTypes);
}

export function getKnownSliceNames(): string[] {
  if (activeStore && typeof activeStore.getState === 'function') {
    try {
      const state = activeStore.getState();
      if (state && typeof state === 'object') {
        Object.keys(state).forEach((k) => knownSliceNames.add(k));
      }
    } catch {}
  }
  return Array.from(knownSliceNames);
}

export function replayAction(log: ActionLogItem): boolean {
  if (!activeStore || typeof activeStore.dispatch !== 'function') return false;
  try {
    if (log.rawAction) {
      activeStore.dispatch(log.rawAction);
      return true;
    }
    if (log.name) {
      activeStore.dispatch({ type: log.name, payload: log.payload });
      return true;
    }
  } catch (err) {
    console.error('[Component Preview] Failed to replay Redux action:', err);
  }
  return false;
}

export function dispatchCustomAction(action: any): any {
  if (!activeStore || typeof activeStore.dispatch !== 'function') {
    throw new Error('No active Redux store found');
  }
  return activeStore.dispatch(action);
}

/**
 * Format and extract clean, informative ActionLogItem from any Redux action.
 * Handles RTK Query (endpoints, queryArgs, requestId, lifecycle),
 * createAsyncThunk (arg, status, duration), and standard slice actions.
 */
export function extractActionLog(
  action: any,
  changedSlices?: string[],
  prevState?: any,
  nextState?: any
): ActionLogItem | null {
  if (typeof action !== 'object' || action === null) return null;
  if (seenActions.has(action)) return null;
  seenActions.add(action);

  if (isInternalReduxAction(action.type)) return null;

  if (action.type) {
    knownActionTypes.add(action.type);
  }
  if (changedSlices) {
    changedSlices.forEach((s) => knownSliceNames.add(s));
  }

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

  let stateDiff: Record<string, any> | undefined;
  if (changedSlices && changedSlices.length > 0 && prevState && nextState) {
    const diffMap: Record<string, any> = {};
    // Prioritize domain / application state slices before RTK Query API cache slices
    const sortedSlices = [...changedSlices].sort((a, b) => {
      const isA_Api = isRtkQuerySliceState(nextState?.[a] ?? prevState?.[a]) || a.toLowerCase().endsWith('api');
      const isB_Api = isRtkQuerySliceState(nextState?.[b] ?? prevState?.[b]) || b.toLowerCase().endsWith('api');
      if (isA_Api && !isB_Api) return 1;
      if (!isA_Api && isB_Api) return -1;
      return 0;
    });

    for (const slice of sortedSlices) {
      const diff = computeSliceDiff(prevState[slice], nextState[slice]);
      if (diff) {
        diffMap[slice] = diff;
      }
    }
    if (Object.keys(diffMap).length > 0) {
      stateDiff = diffMap;
    }
  }

  const isError = asyncStatus === 'rejected' || Boolean(action.error);
  const isMutation = typeof action.type === 'string' && action.type.includes('executeMutation');
  const isQuery = typeof action.type === 'string' && action.type.includes('executeQuery');
  const queryType: 'query' | 'mutation' | undefined = isMutation ? 'mutation' : isQuery ? 'query' : undefined;
  const queryError = asyncStatus === 'rejected' ? (action.error || action.payload) : undefined;

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
    queryType,
    queryError: queryError ? sanitizePayload(queryError) : undefined,
    changedSlices: changedSlices && changedSlices.length > 0 ? changedSlices : undefined,
    stateDiff,
    rawAction: action,
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
      const item = extractActionLog(subAction, changedSlices, prevSubState, nextSubState);
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
  if (typeof window !== 'undefined') {
    (window as any).__preview_store__ = realStore;
  }
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
    const item = extractActionLog(action, changedSlices, prevState, nextState);
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
