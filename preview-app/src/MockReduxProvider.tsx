import React, { useMemo, useEffect } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

import { ErrorLocation } from './errorLocationParser';
import { interceptStore, subscribeToReduxLogs } from './reduxInterceptor';

export interface ActionLogItem {
  id: string;
  source: 'redux' | 'callback' | 'console' | 'network' | 'error';
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
  location?: ErrorLocation;
  // Network metadata
  isPending?: boolean;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  // Redux metadata
  asyncStatus?: 'pending' | 'fulfilled' | 'rejected';
  endpoint?: string;
  queryArgs?: any;
  queryType?: 'query' | 'mutation';
  queryError?: any;
  changedSlices?: string[];
  stateDiff?: Record<string, any>;
  rawAction?: any;
  // Console metadata
  tableData?: any;
  // UI metadata
  pinned?: boolean;
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

function createFallbackStore(initialState: Record<string, any>, onActionDispatched: (item: ActionLogItem) => void) {
  const handler: ProxyHandler<Record<string, any>> = {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && prop !== 'then' && prop !== 'toJSON' && prop !== 'constructor' && prop !== '$$typeof') {
        return new Proxy({ queries: {}, mutations: {}, provided: {}, subscriptions: {}, config: {} }, handler);
      }
      return Reflect.get(target, prop, receiver);
    },
  };
  const safeInitialState = new Proxy({ ...initialState }, handler);

  const reducer = (state = safeInitialState, _action: any) => {
    return state || safeInitialState;
  };

  const store = configureStore({
    reducer,
    preloadedState: safeInitialState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });

  interceptStore(store, onActionDispatched);
  return store;
}

export const MockReduxProvider: React.FC<MockReduxProviderProps> = ({
  storeModule,
  exportName,
  slice,
  initialState,
  onActionDispatched,
  children,
}) => {
  const stateKey = useMemo(() => {
    try {
      return JSON.stringify(initialState || {});
    } catch {
      return '';
    }
  }, [initialState]);

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
          interceptStore(created, onActionDispatched);
          return created;
        }
      }

      const realStore = instantiateStore(storeOrFactory, effectiveState);

      if (realStore && typeof realStore.dispatch === 'function') {
        interceptStore(realStore, onActionDispatched);
        return realStore;
      }

      console.warn(
        '[Component Preview] storePath module provided, but no Redux store or factory was found. Falling back to mock store.'
      );
    }

    return createFallbackStore(effectiveState, onActionDispatched);
  }, [storeModule, exportName, slice, stateKey, onActionDispatched]);

  useEffect(() => {
    return subscribeToReduxLogs(onActionDispatched);
  }, [onActionDispatched]);

  return <Provider store={store}>{children}</Provider>;
};
