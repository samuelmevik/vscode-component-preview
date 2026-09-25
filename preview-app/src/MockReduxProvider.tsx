import React, { useMemo } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

export interface ActionLogItem {
  id: string;
  source: 'redux' | 'callback' | 'console' | 'network';
  level?: 'log' | 'info' | 'warn' | 'error';
  name: string;
  payload?: any;
  response?: any;
  status?: number;
  statusText?: string;
  duration?: string;
  method?: string;
  url?: string;
  timestamp: string;
}

interface MockReduxProviderProps {
  storeModule?: any;
  exportName?: string;
  slice?: string;
  initialState: Record<string, any>;
  onActionDispatched: (item: ActionLogItem) => void;
  children: React.ReactNode;
}

const COMMON_STORE_EXPORTS = ['setupStore', 'createStore', 'createTestStore', 'store', 'default'];

function findStoreOrFactory(storeModule: any, exportName?: string): any {
  if (exportName && storeModule[exportName]) {
    return storeModule[exportName];
  }
  for (const name of COMMON_STORE_EXPORTS) {
    if (storeModule[name]) return storeModule[name];
  }
  for (const key of Object.keys(storeModule)) {
    const exp = storeModule[key];
    if (exp && typeof exp === 'object' && typeof exp.dispatch === 'function' && typeof exp.getState === 'function') {
      return exp;
    }
    if (typeof exp === 'function' && !exp.$$typeof && !/^[A-Z]/.test(key)) {
      return exp;
    }
  }
  return null;
}

function instantiateStore(storeOrFactory: any, initialState: Record<string, any>): any {
  if (typeof storeOrFactory === 'function') {
    try {
      return storeOrFactory(Object.keys(initialState).length > 0 ? initialState : undefined);
    } catch {
      try {
        return storeOrFactory();
      } catch (err) {
        console.error('[Component Preview] Failed to instantiate store from factory:', err);
      }
    }
  } else if (storeOrFactory && typeof storeOrFactory === 'object' && typeof storeOrFactory.dispatch === 'function') {
    return storeOrFactory;
  }
  return null;
}

function interceptDispatch(realStore: any, onActionDispatched: (item: ActionLogItem) => void) {
  realStore.__preview_listener__ = onActionDispatched;
  if (realStore.__preview_intercepted__) return;

  const originalDispatch = realStore.dispatch.bind(realStore);
  realStore.dispatch = function (action: any) {
    try {
      if (action && typeof action.type === 'string' && !action.type.startsWith('@@redux/')) {
        let payload = action.payload;
        if (payload === undefined && typeof action === 'object' && action !== null) {
          const { type, ...rest } = action;
          if (Object.keys(rest).length > 0) payload = rest;
        }

        realStore.__preview_listener__?.({
          id: Math.random().toString(36).substring(2, 9),
          source: 'redux',
          name: action.type,
          payload,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else if (typeof action === 'function') {
        realStore.__preview_listener__?.({
          id: Math.random().toString(36).substring(2, 9),
          source: 'redux',
          name: action.name ? `[Thunk] ${action.name}` : '[Thunk]',
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    } catch (e) {
      console.error('[Component Preview] Action logging error:', e);
    }
    return originalDispatch(action);
  };
  realStore.__preview_intercepted__ = true;
}

function createFallbackStore(initialState: Record<string, any>, onActionDispatched: (item: ActionLogItem) => void) {
  const reducer = (state = initialState, action: any) => {
    if (action && typeof action.type === 'string' && !action.type.startsWith('@@redux/')) {
      onActionDispatched({
        id: Math.random().toString(36).substring(2, 9),
        source: 'redux',
        name: action.type,
        payload: action.payload,
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    return state;
  };

  return configureStore({
    reducer,
    preloadedState: initialState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });
}

export const MockReduxProvider: React.FC<MockReduxProviderProps> = ({
  storeModule,
  exportName,
  slice,
  initialState,
  onActionDispatched,
  children,
}) => {
  const store = useMemo(() => {
    const effectiveState =
      slice && !(slice in initialState)
        ? { [slice]: initialState }
        : initialState;

    if (storeModule) {
      const storeOrFactory = findStoreOrFactory(storeModule, exportName);

      // Handle slice reducer directly exported from module
      if (
        slice &&
        (!storeOrFactory || typeof storeOrFactory !== 'function' || !storeOrFactory.dispatch)
      ) {
        const sliceReducer =
          storeModule[slice]?.reducer ||
          storeModule[`${slice}Slice`]?.reducer ||
          storeModule.reducer ||
          (typeof storeOrFactory === 'function' && storeOrFactory.length === 2
            ? storeOrFactory
            : undefined);

        if (sliceReducer) {
          const created = configureStore({
            reducer: { [slice]: sliceReducer },
            preloadedState: effectiveState,
          });
          interceptDispatch(created, onActionDispatched);
          return created;
        }
      }

      const realStore = instantiateStore(storeOrFactory, effectiveState);

      if (realStore && typeof realStore.dispatch === 'function') {
        interceptDispatch(realStore, onActionDispatched);
        return realStore;
      }

      console.warn(
        '[Component Preview] storePath module provided, but no Redux store or factory was found. Falling back to mock store.'
      );
    }

    return createFallbackStore(effectiveState, onActionDispatched);
  }, [storeModule, exportName, slice, initialState, onActionDispatched]);

  return <Provider store={store}>{children}</Provider>;
};
