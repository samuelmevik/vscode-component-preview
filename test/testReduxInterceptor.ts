import { configureStore, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { createApi } from '@reduxjs/toolkit/query';
import {
  interceptStore,
  isInternalReduxAction,
  getChangedSliceNames,
  sanitizePayload,
  getLiveStoreState,
  computeSliceDiff,
  isRtkQuerySliceState,
  replayAction,
  dispatchCustomAction,
  getKnownActionTypes,
  getKnownSliceNames,
} from '../preview-app/src/reduxInterceptor';
import { ActionLogItem } from '../preview-app/src/MockReduxProvider';

// 1. Test isInternalReduxAction
console.log('--- Testing Redux Action Filtering ---');
if (!isInternalReduxAction('@@redux/INIT123')) throw new Error('Failed to filter @@redux/INIT');
if (!isInternalReduxAction('api/subscriptions/internal_getRTKQSubscriptions'))
  throw new Error('Failed to filter RTKQ internal subscriptions');
if (!isInternalReduxAction('catApi/subscriptions/unsubscribeQueryResult'))
  throw new Error('Failed to filter RTKQ unsubscribeQueryResult action');
if (!isInternalReduxAction('catApi/subscriptions/subscribeQueryResult'))
  throw new Error('Failed to filter RTKQ subscribeQueryResult action');
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

// 6. Test State Diff Computation, Replay, and Custom Dispatch
function testStateDiffAndReplay() {
  console.log('--- Testing State Diff, Action Replay & Manual Dispatch ---');

  // 1. Test computeSliceDiff
  const prevSlice = { count: 5, user: 'Samuel', tags: ['red'] };
  const nextSlice = { count: 10, user: 'Samuel', role: 'admin' };
  const sliceDiff = computeSliceDiff(prevSlice, nextSlice);

  if (!sliceDiff) throw new Error('Expected sliceDiff to be computed');
  if (sliceDiff.updated?.count?.before !== 5 || sliceDiff.updated?.count?.after !== 10) {
    throw new Error(`Updated diff mismatch: ${JSON.stringify(sliceDiff.updated)}`);
  }
  if (sliceDiff.added?.role !== 'admin') {
    throw new Error(`Added diff mismatch: ${JSON.stringify(sliceDiff.added)}`);
  }
  if (!sliceDiff.deleted?.includes('tags')) {
    throw new Error(`Deleted diff mismatch: ${JSON.stringify(sliceDiff.deleted)}`);
  }
  console.log('✅ computeSliceDiff correctly detected added, updated, and deleted keys');

  // Test computeSliceDiff on RTK Query slice state
  const prevRtkSlice = {
    queries: {
      'getCat({"tag":"tabby"})': {
        status: 'fulfilled',
        endpointName: 'getCat',
        data: { id: 'cat-1' },
      },
      'getCat({"tag":"black"})': {
        status: 'pending',
        endpointName: 'getCat',
        originalArgs: { tag: 'black' },
      },
    },
    provided: { tags: { Cat: ['getCat({"tag":"tabby"})'] } },
    subscriptions: { 'getCat({"tag":"tabby"})': 1 },
    config: { online: true },
  };

  const nextRtkSlice = {
    queries: {
      'getCat({"tag":"tabby"})': prevRtkSlice.queries['getCat({"tag":"tabby"})'], // Unchanged cached query!
      'getCat({"tag":"black"})': {
        status: 'fulfilled',
        endpointName: 'getCat',
        originalArgs: { tag: 'black' },
        data: { id: 'cat-2', url: 'https://cataas.com/cat/cat-2' },
      },
    },
    provided: { tags: { Cat: ['getCat({"tag":"tabby"})', 'getCat({"tag":"black"})'] } }, // internal tag update
    subscriptions: { 'getCat({"tag":"tabby"})': 1, 'getCat({"tag":"black"})': 1 },
    config: { online: true },
  };

  if (!isRtkQuerySliceState(prevRtkSlice)) throw new Error('Failed isRtkQuerySliceState check');
  if (isRtkQuerySliceState(prevSlice)) throw new Error('False positive on isRtkQuerySliceState');

  const rtkDiff = computeSliceDiff(prevRtkSlice, nextRtkSlice);
  if (!rtkDiff) throw new Error('Expected rtkDiff to be computed');

  // Verify internal tags/subscriptions/config were omitted
  if ('provided' in rtkDiff.updated || 'subscriptions' in rtkDiff.updated || 'config' in rtkDiff.updated) {
    throw new Error(`Internal plumbing should not be in updated: ${JSON.stringify(rtkDiff.updated)}`);
  }

  // Verify unchanged cached query is NOT in diff
  if (Object.keys(rtkDiff.updated).some((k) => k.includes('tabby'))) {
    throw new Error('Unchanged query "tabby" should not be in diff');
  }

  // Verify updated status and data for the query that completed
  if (rtkDiff.updated['query: getCat · status']?.before !== 'pending' || rtkDiff.updated['query: getCat · status']?.after !== 'fulfilled') {
    throw new Error(`Expected query status transition pending -> fulfilled, got ${JSON.stringify(rtkDiff.updated)}`);
  }
  if (!rtkDiff.updated['query: getCat · data']?.after?.id) {
    throw new Error(`Expected query data in diff, got ${JSON.stringify(rtkDiff.updated)}`);
  }
  console.log('✅ RTK Query specialized slice diff verified (omitted internal tags, diffed only changed query)');

  // 2. Test replayAction
  const sampleLog: ActionLogItem = {
    id: 'test-counter-log',
    name: 'counter/increment',
    source: 'redux',
    rawAction: { type: 'counter/increment', payload: 10 },
    timestamp: '12:00:00',
  };
  const replaySuccess = replayAction(sampleLog);
  if (!replaySuccess) throw new Error('replayAction returned false');
  const storeStateAfterReplay = getLiveStoreState();
  console.log('✅ replayAction executed successfully, state:', storeStateAfterReplay);

  // 3. Test dispatchCustomAction
  const customSuccess = dispatchCustomAction({ type: 'counter/increment', payload: 25 });
  if (!customSuccess) throw new Error('dispatchCustomAction returned false');
  console.log('✅ dispatchCustomAction executed successfully');

  // 4. Test introspection
  const knownTypes = getKnownActionTypes();
  const knownSlices = getKnownSliceNames();
  if (!knownTypes.includes('counter/increment')) {
    throw new Error(`Expected knownTypes to include 'counter/increment', got ${JSON.stringify(knownTypes)}`);
  }
  if (!knownSlices.includes('counter')) {
    throw new Error(`Expected knownSlices to include 'counter', got ${JSON.stringify(knownSlices)}`);
  }
  console.log('✅ getKnownActionTypes and getKnownSliceNames verified:', knownTypes, knownSlices);
}

async function run() {
  await testRtkQueryInterception();
  await testCreateAsyncThunk();
  testStateDiffAndReplay();
  console.log('\n🎉 ALL REDUX INTERCEPTOR TESTS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
