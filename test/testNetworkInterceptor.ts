import { installNetworkInterceptor, subscribeToNetworkLogs } from '../preview-app/src/networkInterceptor';
import { ActionLogItem } from '../preview-app/src/MockReduxProvider';

// Mock browser window and XMLHttpRequest for Node test environment
(global as any).window = global;
(global as any).window.location = { href: 'http://127.0.0.1:4545/__preview__' };

class MockXHR {
  public static listeners: Record<string, Function[]> = {};
  public status: number = 200;
  public statusText: string = 'OK';
  public responseText: string = '{"data":"axios-success"}';
  public responseType: string = '';
  public response: any = null;
  private eventListeners: Record<string, Function[]> = {};

  open(method: string, url: string) {}
  send(body?: any) {
    setTimeout(() => {
      const handlers = this.eventListeners['loadend'] || [];
      handlers.forEach((h) => h());
    }, 10);
  }
  addEventListener(event: string, handler: Function) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
  }
}

(global as any).XMLHttpRequest = MockXHR;

// Mock window.fetch
(global as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/api/error')) {
    return {
      status: 500,
      statusText: 'Internal Server Error',
      ok: false,
      clone: () => ({
        text: async () => JSON.stringify({ message: 'Server crashed' }),
      }),
    };
  }
  return {
    status: 200,
    statusText: 'OK',
    ok: true,
    clone: () => ({
      text: async () => JSON.stringify({ success: true, user: 'Samuel' }),
    }),
  };
};

async function runTests() {
  console.log('--- Testing Network Interceptor (Fetch, Axios, RTK Query) ---');

  installNetworkInterceptor();

  const loggedItems: ActionLogItem[] = [];
  const unsubscribe = subscribeToNetworkLogs((item) => {
    loggedItems.push(item);
  });

  // 1. Test Fetch GET
  console.log('Testing fetch GET /api/users ...');
  await (global as any).fetch('https://api.example.com/api/users', { method: 'GET' });

  // 2. Test Fetch POST with JSON payload (RTK Query / fetch pattern)
  console.log('Testing fetch POST /api/orders with payload ...');
  await (global as any).fetch('https://api.example.com/api/orders', {
    method: 'POST',
    body: JSON.stringify({ item: 'Laptop', price: 999 }),
  });

  // 3. Test Fetch 500 Error
  console.log('Testing fetch error /api/error ...');
  await (global as any).fetch('https://api.example.com/api/error', { method: 'GET' });

  // 4. Test Internal Vite URL filtering (Must be ignored)
  console.log('Testing internal Vite request filtering ...');
  await (global as any).fetch('http://127.0.0.1:4545/@vite/client');
  await (global as any).fetch('http://127.0.0.1:4545/__preview_entry__.tsx');

  // 5. Test XMLHttpRequest (Axios pattern)
  console.log('Testing XMLHttpRequest POST (Axios) ...');
  await new Promise<void>((resolve) => {
    const xhr = new (global as any).XMLHttpRequest();
    xhr.open('POST', 'https://api.example.com/axios/auth');
    xhr.send(JSON.stringify({ username: 'stenen', token: 'xyz123' }));
    setTimeout(resolve, 50);
  });

  unsubscribe();

  console.log(`Total intercepted HTTP requests: ${loggedItems.length}`);

  // Assertions
  if (loggedItems.length !== 4) {
    console.error(`Expected 4 intercepted requests, got ${loggedItems.length}`);
    process.exit(1);
  }

  // Verify Item 1: Fetch GET
  const getReq = loggedItems[0];
  console.log('- [1] Fetch GET verified:', getReq.method, getReq.url, getReq.status, getReq.response);
  if (getReq.method !== 'GET' || getReq.status !== 200 || !getReq.response.success) {
    console.error('Fetch GET assertion failed!');
    process.exit(1);
  }

  // Verify Item 2: Fetch POST with payload
  const postReq = loggedItems[1];
  console.log('- [2] Fetch POST verified:', postReq.method, postReq.payload, postReq.status);
  if (postReq.method !== 'POST' || postReq.payload?.item !== 'Laptop') {
    console.error('Fetch POST payload assertion failed!');
    process.exit(1);
  }

  // Verify Item 3: Fetch 500 error
  const errReq = loggedItems[2];
  console.log('- [3] Fetch Error verified:', errReq.method, errReq.status, errReq.level);
  if (errReq.status !== 500 || errReq.level !== 'error') {
    console.error('Fetch error assertion failed!');
    process.exit(1);
  }

  // Verify Item 4: Axios XHR
  const xhrReq = loggedItems[3];
  console.log('- [4] Axios XHR verified:', xhrReq.method, xhrReq.url, xhrReq.payload, xhrReq.response);
  if (xhrReq.method !== 'POST' || xhrReq.payload?.username !== 'stenen' || xhrReq.response?.data !== 'axios-success') {
    console.error('Axios XHR assertion failed!');
    process.exit(1);
  }

  console.log('\n✅ All Network Interceptor tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Network interceptor test failed:', err);
  process.exit(1);
});
