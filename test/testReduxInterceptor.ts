import { configureStore, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { createApi } from '@reduxjs/toolkit/query';
import {
  interceptStore,
  isInternalReduxAction,
  getChangedSliceNames,
  sanitizePayload,
  getLiveStoreState,
} from '../preview-app/src/reduxInterceptor';
import { ActionLogItem } from '../preview-app/src/MockReduxProvider';

// 1. Test isInternalReduxAction
console.log('--- Testing Redux Action Filtering ---');
if (!isInternalReduxAction('@@redux/INIT123')) throw new Error('Failed to filter @@redux/INIT');
if (!isInternalReduxAction('api/subscriptions/internal_getRTKQSubscriptions'))
  throw new Error('Failed to filter RTKQ internal subscriptions');
if (!isInternalReduxAction('api/config/middlewareRegistered'))
  throw new Error('Failed to filter middlewareRegistered');
if (isInternalReduxAction('catGallery/setSelectedTag'))
  throw new Error('Incorrectly filtered user action catGallery/setSelectedTag');
if (isInternalReduxAction('catApi/executeQuery/pending'))
  throw new Error('Incorrectly filtered catApi/executeQuery/pending');
console.log('✅ Action filtering passed');

// 2. Test getChangedSliceNames and Big Store Sanitization
console.log('--- Testing Slice Diff & Large Store Sanitization ---');
const prev = { auth: { user: 'Alice' }, cart: { items: [] }, settings: { dark: true } };
const next = { auth: prev.auth, cart: { items: [{ id: 1 }] }, settings: prev.settings };
const diff = getChangedSliceNames(prev, next);
if (diff.length !== 1 || diff[0] !== 'cart') {
  throw new Error(`Expected changed slice ['cart'], got ${JSON.stringify(diff)}`);
}
console.log('✅ getChangedSliceNames detected changed slice:', diff);

// Test sanitizePayload on huge array & circular reference
const hugeArray = Array.from({ length: 500 }, (_, i) => ({ id: i }));
const sanitizedArr = sanitizePayload(hugeArray);
if (sanitizedArr.length !== 51 || !String(sanitizedArr[50]).includes('+ 450 more items')) {
  throw new Error(`Array truncation failed: ${JSON.stringify(sanitizedArr[50])}`);
}

const circularObj: any = { name: 'cycle' };
circularObj.self = circularObj;
const sanitizedCirc = sanitizePayload(circularObj);
if (sanitizedCirc.self !== '[Circular]') {
  throw new Error(`Circular reference sanitization failed: ${sanitizedCirc.self}`);
}
console.log('✅ Large array truncation and circular protection verified');

// 3. Test Slice Action Interception and Live Store State
console.log('--- Testing Slice Action Interception & Live State ---');
interface CounterState {
  count: number;
}
const counterSlice = createSlice({
  name: 'counter',
  initialState: { count: 0 } as CounterState,
  reducers: {
    increment: (state, action: PayloadAction<number>) => {
      state.count += action.payload;
    },
  },
});

const counterStore = configureStore({
  reducer: { counter: counterSlice.reducer },
});

const counterLogs: ActionLogItem[] = [];
interceptStore(counterStore, (log) => {
  counterLogs.push(log);
});

counterStore.dispatch(counterSlice.actions.increment(5));

if (counterLogs.length !== 1) {
  throw new Error(`Expected 1 logged action, got ${counterLogs.length}`);
}
if (counterLogs[0].name !== 'counter/increment') {
  throw new Error(`Expected action name "counter/increment", got "${counterLogs[0].name}"`);
}
if (counterLogs[0].payload !== 5) {
  throw new Error(`Expected payload 5, got ${JSON.stringify(counterLogs[0].payload)}`);
}
if (!counterLogs[0].changedSlices?.includes('counter')) {
  throw new Error(`Expected changedSlices to include 'counter', got ${JSON.stringify(counterLogs[0].changedSlices)}`);
}
// Verify live store state on-demand without memory leak
const liveState = getLiveStoreState();
if (liveState?.counter?.count !== 5) {
  throw new Error(`Expected live store count 5, got ${liveState?.counter?.count}`);
}
console.log('✅ Slice action interception with changedSlices and getLiveStoreState passed');

// 4. Test RTK Query Lifecycle Interception (Pending, Fulfilled, Endpoint, QueryArgs)
async function testRtkQueryInterception() {
  console.log('--- Testing RTK Query Lifecycle Interception ---');

  interface CatData {
    id: string;
    url: string;
  }

  const catApi = createApi({
    reducerPath: 'catApi',
    baseQuery: (arg: any) => {
      if (arg === 'error-case') {
        return Promise.resolve({
          error: { status: 500, data: 'Cat not found' },
        });
      }
      return Promise.resolve({
        data: { id: 'cat-42', url: 'https://cataas.com/cat/cat-42' } as CatData,
      });
    },
    endpoints: (builder) => ({
      getCat: builder.query<CatData, { tag: string; says?: string }>({
        query: (args) => args,
      }),
    }),
  });

  const store = configureStore({
    reducer: {
      [catApi.reducerPath]: catApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(catApi.middleware),
  });

  const rtkLogs: ActionLogItem[] = [];
  interceptStore(store, (log) => {
    rtkLogs.push(log);
  });

  // Successful query
  await store.dispatch(
    catApi.endpoints.getCat.initiate({ tag: 'orange', says: 'meow' })
  );

  const pendingLog = rtkLogs.find((l) => l.asyncStatus === 'pending');
  const fulfilledLog = rtkLogs.find((l) => l.asyncStatus === 'fulfilled');

  if (!pendingLog) {
    throw new Error('Failed to intercept catApi/executeQuery/pending!');
  }
  if (pendingLog.endpoint !== 'getCat') {
    throw new Error(`Expected endpoint "getCat", got "${pendingLog.endpoint}"`);
  }
  if (pendingLog.payload?.args?.tag !== 'orange' || pendingLog.payload?.args?.says !== 'meow') {
    throw new Error(`Pending log did not contain queryArgs: ${JSON.stringify(pendingLog.payload)}`);
  }

  if (!fulfilledLog) {
    throw new Error('Failed to intercept catApi/executeQuery/fulfilled!');
  }
  if (fulfilledLog.endpoint !== 'getCat') {
    throw new Error(`Expected endpoint "getCat", got "${fulfilledLog.endpoint}"`);
  }
  if (fulfilledLog.payload?.id !== 'cat-42') {
    throw new Error(`Fulfilled payload missing id: ${JSON.stringify(fulfilledLog.payload)}`);
  }
  if (fulfilledLog.queryArgs?.tag !== 'orange') {
    throw new Error(`Fulfilled queryArgs missing: ${JSON.stringify(fulfilledLog.queryArgs)}`);
  }
  if (!fulfilledLog.duration) {
    throw new Error('Expected duration to be measured for fulfilled action');
  }

  console.log('✅ RTK Query successful lifecycle verified:');
  console.log('   Pending:', pendingLog.name, '| Endpoint:', pendingLog.endpoint, '| Args:', JSON.stringify(pendingLog.payload));
  console.log('   Fulfilled:', fulfilledLog.name, '| Duration:', fulfilledLog.duration, '| Payload:', JSON.stringify(fulfilledLog.payload));

  // Error / Rejected query
  await store.dispatch(catApi.endpoints.getCat.initiate('error-case' as any));

  const rejectedLog = rtkLogs.find((l) => l.asyncStatus === 'rejected');
  if (!rejectedLog) {
    throw new Error('Failed to intercept catApi/executeQuery/rejected!');
  }
  if (rejectedLog.level !== 'error') {
    throw new Error(`Expected level "error" on rejected action, got "${rejectedLog.level}"`);
  }
  if (rejectedLog.payload?.response?.status !== 500) {
    throw new Error(`Expected error response status 500 in payload: ${JSON.stringify(rejectedLog.payload)}`);
  }

  console.log('✅ RTK Query error/rejected lifecycle verified:', rejectedLog.name, '| Payload:', JSON.stringify(rejectedLog.payload));
}

// 5. Test createAsyncThunk Interception
async function testCreateAsyncThunk() {
  console.log('--- Testing createAsyncThunk Interception ---');

  const fetchUsers = createAsyncThunk('users/fetch', async (userId: string) => {
    return { id: userId, name: 'Alice' };
  });

  const store = configureStore({
    reducer: {
      users: (state = {}) => state,
    },
  });

  const thunkLogs: ActionLogItem[] = [];
  interceptStore(store, (item) => thunkLogs.push(item));

  await store.dispatch(fetchUsers('user-101'));

  const pending = thunkLogs.find((l) => l.name === 'users/fetch/pending');
  const fulfilled = thunkLogs.find((l) => l.name === 'users/fetch/fulfilled');

  if (!pending) throw new Error('Missing users/fetch/pending log');
  if (pending.payload?.args !== 'user-101') {
    throw new Error(`Expected pending args "user-101", got ${JSON.stringify(pending.payload)}`);
  }
  if (!fulfilled) throw new Error('Missing users/fetch/fulfilled log');
  if (fulfilled.payload?.id !== 'user-101') {
    throw new Error(`Expected fulfilled payload id "user-101", got ${JSON.stringify(fulfilled.payload)}`);
  }

  console.log('✅ createAsyncThunk lifecycle passed:', pending.name, '->', fulfilled.name);
}

async function run() {
  await testRtkQueryInterception();
  await testCreateAsyncThunk();
  console.log('\n🎉 ALL REDUX INTERCEPTOR TESTS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
