import {
  installConsoleInterceptor,
  subscribeToConsoleLogs,
  evaluateConsoleExpression,
  formatTableData,
} from '../preview-app/src/consoleInterceptor';
import { ActionLogItem } from '../preview-app/src/MockReduxProvider';

// Mock window and document
(global as any).window = global;
(global as any).window.parent = {
  postMessage: () => {},
};

async function runConsoleTests() {
  console.log('--- Testing Console Interceptor & Interactive REPL ---');

  const capturedLogs: ActionLogItem[] = [];
  subscribeToConsoleLogs((item) => {
    capturedLogs.push(item);
  });

  installConsoleInterceptor();

  // 1. Test console.table formatting
  console.log('Testing console.table ...');
  const sampleTableData = [
    { id: 1, name: 'Apple', price: 1.5 },
    { id: 2, name: 'Banana', price: 0.8 },
  ];
  console.table(sampleTableData);

  const tableLog = capturedLogs.find((l) => l.name === 'console.table');
  if (!tableLog) throw new Error('Missing console.table log');
  if (!tableLog.tableData || tableLog.tableData.columns.length < 3 || tableLog.tableData.rows.length !== 2) {
    throw new Error(`console.table formatting failed: ${JSON.stringify(tableLog.tableData)}`);
  }
  console.log('✅ console.table verified with columns:', tableLog.tableData.columns);

  // 2. Test console.time & console.timeEnd
  console.log('Testing console.time and console.timeEnd ...');
  console.time('fetchTimer');
  await new Promise((r) => setTimeout(r, 20));
  console.timeEnd('fetchTimer');

  const timerLog = capturedLogs.find((l) => l.name.includes('fetchTimer'));
  if (!timerLog || !timerLog.duration) {
    throw new Error('console.timeEnd failed to measure timer duration');
  }
  console.log('✅ console.timeEnd verified:', timerLog.name, timerLog.duration);

  // 3. Test console.count & console.countReset
  console.log('Testing console.count and console.countReset ...');
  console.count('clickCounter');
  console.count('clickCounter');
  const countLog2 = capturedLogs.filter((l) => l.name.includes('clickCounter: 2'));
  if (countLog2.length === 0) throw new Error('console.count count: 2 not found');

  console.countReset('clickCounter');
  console.count('clickCounter');
  const resetCountLog = capturedLogs.filter((l) => l.name.includes('clickCounter: 1'));
  if (resetCountLog.length < 2) throw new Error('console.countReset failed to reset counter');
  console.log('✅ console.count & countReset verified');

  // 4. Test console.assert
  console.log('Testing console.assert ...');
  console.assert(true, 'This should NOT log');
  const initialLogCount = capturedLogs.length;
  console.assert(false, 'Assertion failed: expected value to be positive');
  if (capturedLogs.length !== initialLogCount + 1) {
    throw new Error('console.assert failed to capture false assertion');
  }
  const assertLog = capturedLogs[capturedLogs.length - 1];
  if (assertLog.level !== 'error' || !assertLog.name.includes('Assertion failed')) {
    throw new Error(`console.assert log mismatch: ${JSON.stringify(assertLog)}`);
  }
  console.log('✅ console.assert verified');

  // 5. Test evaluateConsoleExpression (Interactive REPL)
  console.log('Testing evaluateConsoleExpression (REPL) ...');

  // Basic math
  const mathRes = evaluateConsoleExpression('2 * 21');
  if (mathRes.error || mathRes.result !== 42) {
    throw new Error(`REPL math failed: ${JSON.stringify(mathRes)}`);
  }

  // Object evaluation
  const objRes = evaluateConsoleExpression('({ user: "Alice", active: true })');
  if (objRes.error || objRes.result?.user !== 'Alice') {
    throw new Error(`REPL object failed: ${JSON.stringify(objRes)}`);
  }

  // $props access
  (global as any).window.__preview_current_props__ = { theme: 'dark', size: 'large' };
  const propsRes = evaluateConsoleExpression('$props.theme');
  if (propsRes.error || propsRes.result !== 'dark') {
    throw new Error(`REPL $props access failed: ${JSON.stringify(propsRes)}`);
  }

  // $store access
  (global as any).window.__preview_redux_store__ = {
    getState: () => ({ counter: { count: 99 } }),
  };
  const storeRes = evaluateConsoleExpression('$store.counter.count');
  if (storeRes.error || storeRes.result !== 99) {
    throw new Error(`REPL $store access failed: ${JSON.stringify(storeRes)}`);
  }

  // Error handling
  const syntaxErrRes = evaluateConsoleExpression('foo.bar.baz.qux.invalid()');
  if (!syntaxErrRes.error) {
    throw new Error('REPL should report error on invalid expression');
  }
  console.log('✅ evaluateConsoleExpression verified with math, $props, $store, and error handling');

  console.log('\n🎉 ALL CONSOLE INTERCEPTOR & REPL TESTS PASSED SUCCESSFULLY!');
}

runConsoleTests().catch((err) => {
  console.error('❌ Console tests failed:', err);
  process.exit(1);
});
