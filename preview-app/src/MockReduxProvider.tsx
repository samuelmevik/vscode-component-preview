import React, { useMemo } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

export interface ActionLogItem {
  id: string;
  source: 'redux' | 'callback';
  source: 'redux' | 'callback' | 'console';
  level?: 'log' | 'info' | 'warn' | 'error';
  name: string;
  payload?: any;
  timestamp: string;
}

interface MockReduxProviderProps {
  initialState: Record<string, any>;
  onActionDispatched: (item: ActionLogItem) => void;
  children: React.ReactNode;
}

export const MockReduxProvider: React.FC<MockReduxProviderProps> = ({
  initialState,
  onActionDispatched,
  children,
}) => {
  const store = useMemo(() => {
    // Dynamic reducer supporting state lookup & action interception
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
  }, [initialState, onActionDispatched]);

  return <Provider store={store}>{children}</Provider>;
};
