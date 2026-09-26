import * as assert from 'assert';
import {
  parseStackLine,
  parseErrorInfo,
  normalizeSourcePath,
  isInternalFrame,
  decodeVLQ,
  findOriginalPosition,
  resolveExactLocation,
  RawSourceMap,
} from '../preview-app/src/errorLocationParser';
import {
  subscribeToRuntimeErrors,
  reportRuntimeError,
  RuntimeErrorItem,
} from '../preview-app/src/errorInterceptor';
import { serializeLogArg } from '../preview-app/src/consoleInterceptor';
import { PreviewViteServer, normalizeDriveLetter } from '../src/server/viteServer';
import * as path from 'path';

console.log('--- Testing Error Location & Stack Parser ---');

// Test 1: Normalize source paths
const winPath = normalizeSourcePath('http://127.0.0.1:4545/@fs/C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx?t=1727384920');
assert.strictEqual(winPath, 'C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx', 'Should normalize Windows @fs URL with query params');
console.log('✅ normalizeSourcePath (Windows Vite @fs URL) passed');

const posixPath = normalizeSourcePath('http://localhost:4545/@fs/home/developer/project/Button.tsx');
assert.strictEqual(posixPath, 'home/developer/project/Button.tsx', 'Should normalize POSIX @fs URL');
console.log('✅ normalizeSourcePath (POSIX Vite @fs URL) passed');

// Test 2: Internal frame detection
assert.strictEqual(isInternalFrame('http://localhost:4545/node_modules/react-dom/client.js:12:3'), true);
assert.strictEqual(isInternalFrame('http://localhost:4545/@vite/client:100:5'), true);
assert.strictEqual(isInternalFrame('http://localhost:4545/preview-app/src/Harness.tsx:200:10'), true);
assert.strictEqual(isInternalFrame('C:/Users/stenen/sample-workspace/CatGallery.tsx:534:41'), false);
console.log('✅ isInternalFrame filter passed');

// Test 3: Parse V8 named stack frame
const v8Line = '    at handleClick (http://127.0.0.1:4545/@fs/C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx?t=12345:534:41)';
const parsedV8 = parseStackLine(v8Line);
assert.ok(parsedV8, 'Frame should be parsed');
assert.strictEqual(parsedV8?.functionName, 'handleClick');
assert.strictEqual(parsedV8?.filePath, 'C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx');
assert.strictEqual(parsedV8?.fileName, 'CatGallery.tsx');
assert.strictEqual(parsedV8?.line, 534);
assert.strictEqual(parsedV8?.column, 41);
assert.strictEqual(parsedV8?.isUserCode, true);
console.log('✅ parseStackLine (V8 named function) passed');

// Test 4: Parse V8 anonymous stack frame
const anonLine = '    at http://127.0.0.1:4545/@fs/C:/Users/stenen/Desktop/sample-workspace/Button.tsx:35:12';
const parsedAnon = parseStackLine(anonLine);
assert.ok(parsedAnon, 'Anonymous frame should be parsed');
assert.strictEqual(parsedAnon?.functionName, undefined);
assert.strictEqual(parsedAnon?.filePath, 'C:/Users/stenen/Desktop/sample-workspace/Button.tsx');
assert.strictEqual(parsedAnon?.line, 35);
assert.strictEqual(parsedAnon?.column, 12);
assert.strictEqual(parsedAnon?.isUserCode, true);
console.log('✅ parseStackLine (V8 anonymous function) passed');

// Test 5: Full Error stack parsing and primary user location extraction
const mockError = new Error('Intentional error for testing');
mockError.stack = `Error: Intentional error for testing
    at onClick (http://127.0.0.1:4545/@fs/C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx?t=17273849:534:41)
    at HTMLButtonElement.dispatch (http://127.0.0.1:4545/node_modules/react-dom/cjs/react-dom.development.js:8920:14)
    at invokeGuardedCallbackDev (http://127.0.0.1:4545/node_modules/react-dom/cjs/react-dom.development.js:237:16)`;

const info = parseErrorInfo(mockError);
assert.strictEqual(info.message, 'Intentional error for testing');
assert.ok(info.primaryLocation, 'Primary location must be extracted');
assert.strictEqual(info.primaryLocation?.functionName, 'onClick');
assert.strictEqual(info.primaryLocation?.filePath, 'C:/Users/stenen/Desktop/sample-workspace/CatGallery.tsx');
assert.strictEqual(info.primaryLocation?.line, 534);
assert.strictEqual(info.primaryLocation?.column, 41);
assert.strictEqual(info.userFrames.length, 1, 'Only user frame should be included');
assert.strictEqual(info.allFrames.length, 3, 'All 3 frames parsed');
console.log('✅ parseErrorInfo (filtering internal frames & resolving primary location) passed');

// Test 6: Fallback file & line resolution when stack is empty
const fallbackInfo = parseErrorInfo('Syntax error in component', 'C:/Users/stenen/sample-workspace/UserProfile.tsx', 25);
assert.strictEqual(fallbackInfo.primaryLocation?.filePath, 'C:/Users/stenen/sample-workspace/UserProfile.tsx');
assert.strictEqual(fallbackInfo.primaryLocation?.line, 25);
console.log('✅ parseErrorInfo fallback resolution passed');

// Test 6b: Pure-JS VLQ Segment Decoder
const decodedVLQ = decodeVLQ('AA8CY');
assert.deepStrictEqual(decodedVLQ, [0, 0, 46, 12], 'VLQ decode segment must match spec');
console.log('✅ decodeVLQ unit test passed');

// Test 6c: findOriginalPosition on synthetic SourceMap
const syntheticMap: RawSourceMap = {
  version: 3,
  sources: ['TestComponent.tsx'],
  mappings: 'AAAA,aAAa;AAEb',
};
const syntheticPos = findOriginalPosition(syntheticMap, 1, 1);
assert.ok(syntheticPos, 'Must find synthetic mapping');
assert.strictEqual(syntheticPos?.source, 'TestComponent.tsx');
assert.strictEqual(syntheticPos?.line, 1);
console.log('✅ findOriginalPosition unit test passed');

// Test 7: Runtime error subscription & deduplication
console.log('\n--- Testing Runtime Error Interceptor & Deduplication ---');
const receivedErrors: RuntimeErrorItem[] = [];
const unsub = subscribeToRuntimeErrors((item) => {
  receivedErrors.push(item);
});

const err1 = reportRuntimeError(mockError, 'event');
assert.ok(err1, 'First error should report');
assert.strictEqual(err1?.location?.line, 534);

// Immediate duplicate should be suppressed by deduplication
const errDup = reportRuntimeError(mockError, 'event');
assert.strictEqual(errDup, null, 'Duplicate within debounce threshold should be suppressed');

// Distinct error should be reported
const mockError2 = new Error('Second distinct error');
mockError2.stack = `Error: Second distinct error
    at BadComponent (http://127.0.0.1:4545/@fs/C:/Users/stenen/Desktop/sample-workspace/UserProfile.tsx:10:5)`;
const err2 = reportRuntimeError(mockError2, 'event');
assert.ok(err2, 'Second distinct error should report');
assert.strictEqual(receivedErrors.length, 2, 'Subscriber received both distinct errors');
unsub();
console.log('✅ Runtime error subscription & deduplication passed');

// Test 8: Vite Server /__preview_api/navigate endpoint
async function testViteNavigateEndpoint() {
  console.log('\n--- Testing Vite Server /__preview_api/navigate Endpoint ---');
  const extPath = path.resolve(__dirname, '..');
  const server = new PreviewViteServer(extPath, 4610);
  const sampleWorkspace = path.resolve(extPath, 'sample-workspace');

  let navigatedFile: string | null = null;
  let navigatedLine: number | null = null;
  let navigatedCol: number | null = null;

  server.onNavigateRequested = (f, l, c) => {
    navigatedFile = f;
    navigatedLine = l ?? null;
    navigatedCol = c ?? null;
  };

  const port = await server.start(sampleWorkspace);
  assert.ok(server.isRunning(), 'Server must be running');

  // Test 8a: resolveOriginalPosition resolves transpiled line 662 to TSX authoring line 534
  console.log('\n--- Testing PreviewViteServer.resolveOriginalPosition ---');
  const resolvedDirect = await server.resolveOriginalPosition('CatGallery.tsx', 662, 11);
  assert.strictEqual(resolvedDirect.line, 534, 'Must resolve generated line 662 to TSX line 534');
  assert.ok(resolvedDirect.column >= 40, 'Must resolve column near 40/41');
  console.log(`✅ resolveOriginalPosition: 662:11 -> ${resolvedDirect.filePath}:${resolvedDirect.line}:${resolvedDirect.column}`);

  // Test 8b: Client-side resolveExactLocation fetches Vite inline sourcemap and decodes
  const clientResolved = await resolveExactLocation({
    filePath: 'CatGallery.tsx',
    fileName: 'CatGallery.tsx',
    line: 662,
    column: 11,
    rawUrl: `http://127.0.0.1:${port}/CatGallery.tsx`,
  });
  assert.strictEqual(clientResolved?.line, 534, 'Client resolveExactLocation must resolve to line 534');
  assert.strictEqual(clientResolved?.originalResolved, true);
  console.log(`✅ resolveExactLocation: 662:11 -> ${clientResolved?.fileName}:${clientResolved?.line}:${clientResolved?.column}`);

  // Test 8c: /__preview_api/navigate automatically remaps transpiled line 662 to 534
  const navPayload = {
    filePath: 'CatGallery.tsx',
    line: 662,
    column: 11,
  };

  const res = await fetch(`http://127.0.0.1:${port}/__preview_api/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(navPayload),
  });

  const resJson = await res.json() as any;
  assert.strictEqual(res.status, 200);
  assert.strictEqual(resJson.ok, true);

  assert.ok(navigatedFile?.endsWith('CatGallery.tsx'));
  assert.strictEqual(navigatedLine, 534, 'Navigated line must be remapped to original line 534');
  console.log(`✅ /__preview_api/navigate remapped 662 -> ${navigatedLine}:${navigatedCol}`);

  await server.stop();

  // Test 9: Vite Server /__open-in-editor endpoint remaps transpiled 662 to original 534
  console.log('\n--- Testing Vite Server /__open-in-editor Endpoint with Transpiled Lines ---');
  const server2 = new PreviewViteServer(extPath, 4620);
  let openInEditorFile: string | null = null;
  let openInEditorLine: number | null = null;
  let openInEditorCol: number | null = null;

  server2.onNavigateRequested = (f, l, c) => {
    openInEditorFile = f;
    openInEditorLine = l ?? null;
    openInEditorCol = c ?? null;
  };

  const port2 = await server2.start(sampleWorkspace);
  const openRes = await fetch(`http://127.0.0.1:${port2}/__open-in-editor?file=CatGallery.tsx:662:11`);
  const openJson = await openRes.json() as any;
  assert.strictEqual(openRes.status, 200);
  assert.strictEqual(openJson.ok, true);
  assert.ok(openInEditorFile?.endsWith('CatGallery.tsx'));
  assert.strictEqual(openInEditorLine, 534, 'open-in-editor must remap generated 662 to source 534');
  console.log(`✅ /__open-in-editor remapped 662 -> ${openInEditorLine}:${openInEditorCol}`);

  await server2.stop();

  // Test 10: serializeLogArg preserving Error properties
  console.log('\n--- Testing serializeLogArg for Error Preservation ---');
  const testErr = new Error('Test Serialization');
  const serialized = serializeLogArg(testErr);
  assert.strictEqual(serialized.__isError, true);
  assert.strictEqual(serialized.message, 'Test Serialization');
  assert.ok(serialized.stack, 'Stack must be preserved in serialized Error');

  const arrayWithErr = serializeLogArg(['prefix', testErr]);
  assert.strictEqual(arrayWithErr[0], 'prefix');
  assert.strictEqual(arrayWithErr[1].__isError, true);
  assert.strictEqual(arrayWithErr[1].message, 'Test Serialization');
  console.log('✅ serializeLogArg preserves Error object messages and stacks');

  // Test 11: Vite Server /__preview_api/report_error Endpoint with automatic sourcemap remapping
  console.log('\n--- Testing Vite Server /__preview_api/report_error Endpoint ---');
  const server3 = new PreviewViteServer(extPath, 4630);
  let reportedError: any = null;
  server3.onRuntimeError = (err) => {
    reportedError = err;
  };
  let errorUpdatedData: any = null;
  server3.onRuntimeErrorUpdate = (data) => {
    errorUpdatedData = data;
  };

  const port3 = await server3.start(sampleWorkspace);
  const errPayload = {
    message: 'Unhandled Exception',
    source: 'event',
    location: {
      filePath: 'CatGallery.tsx',
      fileName: 'CatGallery.tsx',
      functionName: 'onClick',
      line: 662,
      column: 11,
    },
    stack: 'Error: Unhandled Exception\n    at onClick (CatGallery.tsx:662:11)',
    timestamp: '23:00:00',
  };

  const reportRes = await fetch(`http://127.0.0.1:${port3}/__preview_api/report_error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(errPayload),
  });
  const reportJson = await reportRes.json() as any;
  assert.strictEqual(reportRes.status, 200);
  assert.strictEqual(reportJson.ok, true);
  assert.strictEqual(reportedError?.message, 'Unhandled Exception');
  assert.strictEqual(reportedError?.location?.line, 534, 'Reported error location line must be remapped to 534');
  console.log(`✅ /__preview_api/report_error remapped 662 -> ${reportedError?.location?.line}:${reportedError?.location?.column}`);

  // Test 12: Vite Server /__preview_api/report_error_update Endpoint
  const updateRes = await fetch(`http://127.0.0.1:${port3}/__preview_api/report_error_update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'abc-123', location: { fileName: 'CatGallery.tsx', line: 534, column: 41 } }),
  });
  const updateJson = await updateRes.json() as any;
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateJson.ok, true);
  assert.strictEqual(errorUpdatedData?.id, 'abc-123');
  assert.strictEqual(errorUpdatedData?.location?.line, 534);
  console.log('✅ /__preview_api/report_error_update verified');

  // Test 13: Vite Server /__preview_api/log Endpoint
  let loggedConsole: any = null;
  server3.onConsoleLog = (log) => {
    loggedConsole = log;
  };

  const logRes = await fetch(`http://127.0.0.1:${port3}/__preview_api/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'error', text: 'Console test error' }),
  });
  const logJson = await logRes.json() as any;
  assert.strictEqual(logRes.status, 200);
  assert.strictEqual(logJson.ok, true);
  assert.strictEqual(loggedConsole?.level, 'error');
  assert.strictEqual(loggedConsole?.text, 'Console test error');

  await server3.stop();
  console.log('✅ /__preview_api/report_error and /__preview_api/log endpoints verified');
}

testViteNavigateEndpoint().then(() => {
  console.log('\n🎉 ALL ERROR HANDLING & NAVIGATION TESTS PASSED SUCCESSFULLY!\n');
}).catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
