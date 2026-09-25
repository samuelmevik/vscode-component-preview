import * as path from 'path';
import * as http from 'http';
import { PreviewViteServer } from '../src/server/viteServer';
import { scanComponents } from '../src/parser/astScanner';
import * as fs from 'fs';

function fetchUrl(url: string): Promise<{ statusCode?: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    });
  });
}

async function diagnose() {
  const extensionPath = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(__dirname, '../sample-workspace');
  const sampleFile = path.resolve(workspacePath, 'Button.tsx');
  const fileContent = fs.readFileSync(sampleFile, 'utf8');

  const scanResult = scanComponents(fileContent, sampleFile);
  const targetComp = scanResult.targetComponent!;

  const server = new PreviewViteServer(extensionPath, 4700);
  try {
    const port = await server.start(workspacePath);
    server.updateState({
      currentFile: sampleFile,
      currentComponentName: targetComp.name,
      meta: targetComp.meta,
    });

    console.log('1. Fetching /__preview__ ...');
    const htmlRes = await fetchUrl(`http://127.0.0.1:${port}/__preview__`);
    console.log('HTML status:', htmlRes.statusCode);

    console.log('2. Fetching /__preview_entry__.tsx ...');
    const entryRes = await fetchUrl(`http://127.0.0.1:${port}/__preview_entry__.tsx`);
    console.log('Entry status:', entryRes.statusCode);
    console.log('Entry body snippet:\n', entryRes.body.slice(0, 500));

    // Extract import URLs from entryRes.body
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let match;
    const imports: string[] = [];
    while ((match = importRegex.exec(entryRes.body)) !== null) {
      imports.push(match[1]);
    }
    console.log('\nFound imports in entry:', imports);

    for (const imp of imports) {
      const url = imp.startsWith('http') ? imp : `http://127.0.0.1:${port}${imp.startsWith('/') ? '' : '/'}${imp}`;
      console.log(`Fetching import: ${url} ...`);
      const impRes = await fetchUrl(url);
      console.log(` -> status: ${impRes.statusCode}, type: ${impRes.headers['content-type']}`);
      if (impRes.statusCode !== 200) {
        console.error(` -> FAILED! Body:`, impRes.body);
      }
    }
  } catch (e) {
    console.error('Diagnosis error:', e);
  } finally {
    await server.stop();
    process.exit(0);
  }
}

diagnose();
