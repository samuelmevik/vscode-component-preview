import { configureStore, createSlice, PayloadAction, Middleware } from '@reduxjs/toolkit';
import { RootState, AuthState } from './UserProfile';

const initialAuthState: AuthState = {
  isLoggedIn: false,
  user: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    loginRequest: (state, action: PayloadAction<{ provider?: string }>) => {
      console.log('[Auth Reducer] Processing login request via', action.payload?.provider || 'default');
      state.isLoggedIn = true;
      state.user = {
        name: 'Alex Turner',
        email: 'alex.turner@arctic.com',
        role: 'member',
      };
    },
    switchRole: (state, action: PayloadAction<{ newRole: 'admin' | 'member' }>) => {
      if (state.user) {
        console.log('[Auth Reducer] Switching role to', action.payload.newRole);
        state.user.role = action.payload.newRole;
      }
    },
    logout: (state) => {
      console.log('[Auth Reducer] User logged out');
      state.isLoggedIn = false;
      state.user = null;
    },
  },
});

export const { loginRequest, switchRole, logout } = authSlice.actions;

// Sample custom middleware demonstration
export const actionAuditMiddleware: Middleware = () => (next) => (action: any) => {
  console.log(`%c[Custom Middleware] Action dispatched: ${action.type}`, 'color: #38bdf8; font-weight: bold;', action);
  return next(action);
};

// Recommended Store Factory (creates isolated store with real reducers & middlewares)
export const setupStore = (preloadedState?: Partial<RootState>) => {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
    },
    preloadedState: preloadedState as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(actionAuditMiddleware),
  });
};

// Singleton store instance export
export const store = setupStore();
export default store;
