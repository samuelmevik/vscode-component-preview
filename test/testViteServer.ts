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
    console.log('✅ /__preview_entry__.tsx virtual entrypoint check passed');

    console.log('\n🎉 Vite dev server, SCSS pipeline, and virtual entrypoint all verified successfully!');
  } finally {
    await server.stop();
    console.log('Vite server stopped.');
    process.exit(0);
  }
}

testServer().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
