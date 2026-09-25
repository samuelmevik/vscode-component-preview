import React, { useMemo } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

export interface ActionLogItem {
  id: string;
  source: 'redux' | 'callback' | 'console';
  level?: 'log' | 'info' | 'warn' | 'error';
  name: string;
  payload?: any;
  timestamp: string;
}

interface MockReduxProviderProps {
  storeModule?: any;
  exportName?: string;
  initialState: Record<string, any>;
  onActionDispatched: (item: ActionLogItem) => void;
  children: React.ReactNode;
}

export const MockReduxProvider: React.FC<MockReduxProviderProps> = ({
  storeModule,
  exportName,
  initialState,
  onActionDispatched,
  children,
}) => {
  const store = useMemo(() => {
    // 1. If a real store module was supplied via storePath
    if (storeModule) {
      let storeOrFactory = exportName ? storeModule[exportName] : null;

      if (!storeOrFactory) {
        if (typeof storeModule.setupStore === 'function') {
          storeOrFactory = storeModule.setupStore;
        } else if (typeof storeModule.createStore === 'function') {
          storeOrFactory = storeModule.createStore;
        } else if (typeof storeModule.createTestStore === 'function') {
          storeOrFactory = storeModule.createTestStore;
        } else if (storeModule.store && (typeof storeModule.store === 'object' || typeof storeModule.store === 'function')) {
          storeOrFactory = storeModule.store;
        } else if (storeModule.default) {
          storeOrFactory = storeModule.default;
        } else {
          for (const key of Object.keys(storeModule)) {
            const exp = storeModule[key];
            if (exp && typeof exp === 'object' && typeof exp.dispatch === 'function' && typeof exp.getState === 'function') {
              storeOrFactory = exp;
              break;
            }
            if (typeof exp === 'function' && !exp.$$typeof && !/^[A-Z]/.test(key)) {
              storeOrFactory = exp;
              break;
            }
          }
        }
      }

      let realStore: any = null;
      if (typeof storeOrFactory === 'function') {
        try {
          realStore = storeOrFactory(initialState && Object.keys(initialState).length > 0 ? initialState : undefined);
        } catch (err) {
          console.warn('[Component Preview] Calling store factory with initialState failed, retrying without arguments:', err);
          try {
            realStore = storeOrFactory();
          } catch (err2) {
            console.error('[Component Preview] Failed to instantiate store from factory:', err2);
          }
        }
      } else if (storeOrFactory && typeof storeOrFactory === 'object' && typeof storeOrFactory.dispatch === 'function') {
        realStore = storeOrFactory;
      }

      if (realStore && typeof realStore.dispatch === 'function') {
        // Keep the latest action listener reference updated on the store
        realStore.__preview_listener__ = onActionDispatched;

        // Intercept dispatch once to log actions to Action Inspector while executing real dispatch
        if (!realStore.__preview_intercepted__) {
          const originalDispatch = realStore.dispatch.bind(realStore);
          realStore.dispatch = function (action: any) {
            try {
              if (action && typeof action.type === 'string' && !action.type.startsWith('@@redux/')) {
                let payload = action.payload;
                if (payload === undefined && typeof action === 'object' && action !== null) {
                  const { type, ...rest } = action;
                  if (Object.keys(rest).length > 0) {
                    payload = rest;
                  }
                }

                realStore.__preview_listener__?.({
                  id: Math.random().toString(36).substring(2, 9),
                  source: 'redux',
                  name: action.type,
                  payload: payload,
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

        return realStore;
      } else {
        console.warn(
          '[Component Preview] storePath module provided, but no Redux store or factory function (setupStore / createStore / store) was found. Falling back to mock store.'
        );
      }
    }

    // 2. Dynamic mock reducer fallback supporting state lookup & action interception
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
  }, [storeModule, exportName, initialState, onActionDispatched]);

  return <Provider store={store}>{children}</Provider>;
};
