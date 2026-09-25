import * as path from 'path';
import * as http from 'http';
import { PreviewViteServer } from '../src/server/viteServer';
import { scanComponents } from '../src/parser/astScanner';
import * as fs from 'fs';

function fetchUrl(url: string): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      res.on('error', reject);
    });
  });
}

async function testServer() {
  console.log('--- Testing Vite Server with SCSS and Redux ---');
  const extensionPath = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(__dirname, '../sample-workspace');
  const sampleFile = path.resolve(workspacePath, 'UserProfile.tsx');
  const fileContent = fs.readFileSync(sampleFile, 'utf8');

  const scanResult = scanComponents(fileContent, sampleFile);
  const targetComp = scanResult.targetComponent!;

  const server = new PreviewViteServer(extensionPath, 4600);

  try {
    const port = await server.start(workspacePath);
    console.log(`Vite server started on port ${port}`);

    server.updateState({
      currentFile: sampleFile,
      currentComponentName: targetComp.name,
      meta: targetComp.meta,
    });

    // 1. Fetch __preview__ HTML
    console.log('Fetching /__preview__ ...');
    const htmlRes = await fetchUrl(`http://127.0.0.1:${port}/__preview__`);
    console.log(`HTML Status: ${htmlRes.statusCode}`);
    if (!htmlRes.body.includes('/__preview_entry__.tsx')) {
      throw new Error('Preview HTML does not reference /__preview_entry__.tsx');
    }
    console.log('✅ /__preview__ HTML check passed');

    // 2. Fetch virtual entry module /__preview_entry__.tsx
    console.log('Fetching /__preview_entry__.tsx through Vite pipeline...');
    const entryRes = await fetchUrl(`http://127.0.0.1:${port}/__preview_entry__.tsx`);
    console.log(`Entry Status: ${entryRes.statusCode}`);
    if (entryRes.statusCode !== 200) {
      console.error('Entry body:\n', entryRes.body);
      throw new Error(`Failed to load virtual entry module: status ${entryRes.statusCode}`);
    }
    if (!entryRes.body.includes('StoreModule_0') || !entryRes.body.includes('storeModules')) {
      console.error('Entry body:\n', entryRes.body);
      throw new Error('Virtual entry module did not include StoreModule_0 or storeModules map!');
    }
    console.log('✅ /__preview_entry__.tsx virtual entrypoint and storeModules check passed');

    console.log('\n🎉 Vite dev server, SCSS pipeline, and virtual entrypoint all verified successfully!');

    // 3. Verify server.isRunning()
    if (!server.isRunning()) {
      throw new Error('server.isRunning() returned false when running');
    }
    console.log('✅ server.isRunning() verified');

    // 4. Test stop_server API endpoint
    let stopRequested = false;
    server.onStopRequested = () => {
      stopRequested = true;
    };

    console.log('Posting to /__preview_api/stop_server ...');
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/stop_server`,
        { method: 'POST' },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`stop_server returned status ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!stopRequested) {
      throw new Error('onStopRequested callback was not triggered');
    }
    console.log('✅ /__preview_api/stop_server endpoint verified');

  } finally {
    await server.stop();
    if (server.isRunning()) {
      throw new Error('server.isRunning() returned true after stop()');
    }
    console.log('✅ Vite server stopped and isRunning() is false.');
    process.exit(0);
  }
}

testServer().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
