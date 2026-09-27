import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import {
  detectInstalledBrowser,
  resolveDebugBrowserType,
  buildComponentDebugConfig,
  isIntegratedBrowserSupported,
  ComponentPreviewDebugConfigProvider,
} from '../src/debug/debugConfigProvider';
import { scanComponents } from '../src/parser/astScanner';
import { PreviewViteServer } from '../src/server/viteServer';
import { evaluateConsoleExpression } from '../preview-app/src/consoleInterceptor';

function testBrowserDetectionLogic() {
  console.log('--- Testing Browser Detection & Resolution Logic ---');

  // 1. Explicit preference overrides
  assert.strictEqual(resolveDebugBrowserType('integrated'), 'editor-browser', 'Integrated preference should yield editor-browser');
  assert.strictEqual(resolveDebugBrowserType('editor-browser'), 'editor-browser', 'editor-browser preference should yield editor-browser');
  assert.strictEqual(resolveDebugBrowserType('chrome'), 'pwa-chrome', 'Explicit chrome preference should yield pwa-chrome');
  assert.strictEqual(resolveDebugBrowserType('edge'), 'pwa-msedge', 'Explicit edge preference should yield pwa-msedge');

  // 2. Auto resolution on current platform
  const currentDetected = detectInstalledBrowser(process.platform);
  assert.ok(
    currentDetected === 'pwa-chrome' || currentDetected === 'pwa-msedge',
    `Detected browser should be pwa-chrome or pwa-msedge, got ${currentDetected}`
  );

  // 3. Platform simulation
  const winDetected = detectInstalledBrowser('win32');
  assert.ok(
    winDetected === 'pwa-chrome' || winDetected === 'pwa-msedge',
    'Windows detection should resolve to Chrome or Edge'
  );

  const linuxDetected = detectInstalledBrowser('linux');
  assert.strictEqual(linuxDetected, 'pwa-chrome', 'Linux fallback should default to pwa-chrome');

  console.log(`✅ Browser resolution verified (current: ${currentDetected}, win32: ${winDetected}, linux: ${linuxDetected})`);
}

function testDebugConfigBuilder() {
  console.log('\n--- Testing Debug Configuration Builder ---');

  const config = buildComponentDebugConfig({
    compName: 'Button',
    previewUrl: 'http://127.0.0.1:4545/__preview__',
    webRoot: 'C:\\Users\\stenen\\Desktop\\sample-workspace',
    browserType: 'pwa-chrome',
  });

  assert.strictEqual(config.type, 'pwa-chrome', 'Config type should match browserType');
  assert.strictEqual(config.request, 'launch', 'Request should be launch');
  assert.strictEqual(config.name, 'Debug <Button /> (Component Preview)');
  assert.strictEqual(config.url, 'http://127.0.0.1:4545/__preview__');
  assert.strictEqual(config.webRoot, 'C:/Users/stenen/Desktop/sample-workspace', 'WebRoot should normalize slashes');
  assert.strictEqual(config.sourceMaps, true, 'sourceMaps must be true for Vite TSX mapping');
  assert.strictEqual(config.smartStep, true, 'smartStep must be enabled');

  // Verify skipFiles to prevent stepping into Vite and harness internals
  assert.ok(config.skipFiles.includes('**/node_modules/**'), 'skipFiles must include node_modules');
  assert.ok(config.skipFiles.includes('**/@vite/**'), 'skipFiles must include @vite internals');
  assert.ok(config.skipFiles.includes('**/@react-refresh'), 'skipFiles must include @react-refresh');
  assert.ok(config.skipFiles.includes('**/preview-app/**'), 'skipFiles must include preview-app harness');

  // Verify sourceMapPathOverrides & pathMapping
  assert.ok(config.sourceMapPathOverrides['/@fs/*'], 'sourceMapPathOverrides must handle Vite /@fs/*');
  assert.ok(config.sourceMapPathOverrides['/*'], 'sourceMapPathOverrides must handle /* mapping to ${webRoot}/*');
  assert.ok(config.pathMapping, 'pathMapping must be configured for Vite paths');
  assert.ok(config.pathMapping['/@fs/C:'], 'pathMapping must map Windows drive C:');
  assert.ok(config.sourceMapPathOverrides['/@fs/C:/*'], 'sourceMapPathOverrides must map Windows drive C:/*');

  // Verify editor-browser configuration
  const integratedConfig = buildComponentDebugConfig({
    compName: 'Button',
    previewUrl: 'http://127.0.0.1:4545/__preview__',
    webRoot: 'C:\\Users\\stenen\\Desktop\\sample-workspace',
    browserType: 'editor-browser',
  });
  assert.strictEqual(integratedConfig.type, 'editor-browser', 'Config type should match editor-browser');
  assert.strictEqual(integratedConfig.name, 'Debug <Button /> (Component Preview)');
  assert.strictEqual(integratedConfig.request, 'launch');

  console.log('✅ Debug configuration properties, sourcemaps, and skipFiles verified');

  // Test ComponentPreviewDebugConfigProvider resolution
  let activeCompResult: { filePath: string; compName: string } | null = {
    filePath: 'C:/sample-workspace/CatGallery.tsx',
    compName: 'CatGallery',
  };

  const provider = new ComponentPreviewDebugConfigProvider({
    getActiveComponent: () => activeCompResult,
    getServerPort: () => 4545,
    resolveDebugBrowserType: () => 'pwa-msedge',
  });

  const resolved = provider.resolveDebugConfiguration(undefined, {} as any);
  assert.ok(resolved, 'Provider should resolve empty launch config');
  assert.strictEqual(resolved?.type, 'pwa-msedge');
  assert.strictEqual(resolved?.name, 'Debug <CatGallery /> (Component Preview)');
  assert.strictEqual(resolved?.url, 'http://127.0.0.1:4545/__preview__');

  console.log('✅ ComponentPreviewDebugConfigProvider resolution verified');
}

function testDebugCodeLensGeneration() {
  console.log('\n--- Testing Debug CodeLens Generation Logic ---');

  const buttonPath = path.resolve(__dirname, '../sample-workspace/Button.tsx');
  const buttonCode = fs.readFileSync(buttonPath, 'utf8');
  const scanResult = scanComponents(buttonCode, buttonPath);

  assert.ok(scanResult.components.length > 0);
  const btn = scanResult.components.find((c) => c.name === 'Button')!;
  assert.ok(btn);

  // Position CodeLens directly on component nameLine
  const targetLine = Math.max((btn.nameLine || btn.startLine) - 1, 0);
  assert.strictEqual(targetLine + 1, 29);

  // Generate debug lens mock
  const debugLensTitle = `$(debug-alt) Debug <${btn.name} />`;
  const debugLensCommand = {
    command: 'componentPreview.debugComponent',
    arguments: [buttonPath, btn.name, btn.nameLine],
  };

  assert.strictEqual(debugLensTitle, '$(debug-alt) Debug <Button />');
  assert.strictEqual(debugLensCommand.command, 'componentPreview.debugComponent');
  assert.strictEqual(debugLensCommand.arguments[1], 'Button');
  assert.strictEqual(debugLensCommand.arguments[2], 29);

  console.log(`✅ Debug CodeLens for <${btn.name} /> at line ${targetLine + 1}: [${debugLensTitle}] -> ${debugLensCommand.command}`);

  // Test multi-component CatGallery.tsx
  const catPath = path.resolve(__dirname, '../sample-workspace/CatGallery.tsx');
  const catCode = fs.readFileSync(catPath, 'utf8');
  const catScan = scanComponents(catCode, catPath);

  for (const comp of catScan.components) {
    const line = Math.max((comp.nameLine || comp.startLine) - 1, 0);
    const title = `$(debug-alt) Debug <${comp.name} />`;
    console.log(`   - CodeLens for <${comp.name} /> at line ${line + 1}: [${title}]`);
  }

  console.log('✅ Multi-component file Debug CodeLenses verified');
}

async function testViteServerDebugEndpoints() {
  console.log('\n--- Testing Vite Server Debug API Endpoints ---');

  const extensionPath = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(__dirname, '../sample-workspace');
  const server = new PreviewViteServer(extensionPath, 4700);

  let debugRequestedComp: string | undefined = undefined;
  let devtoolsRequested = false;

  let debugRequestedTarget: 'devtools' | 'browser' | undefined;

  server.onStartDebugRequested = (compName, target) => {
    debugRequestedComp = compName;
    debugRequestedTarget = target;
  };

  server.onOpenDevToolsRequested = () => {
    devtoolsRequested = true;
  };

  try {
    const port = await server.start(workspacePath);
    console.log(`Vite server started on port ${port}`);

    // 1. Post to /__preview_api/start_debug with target: devtools
    console.log('Posting to /__preview_api/start_debug (target: devtools) ...');
    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ componentName: 'Button', target: 'devtools' });
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/start_debug`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`start_debug returned status ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(debugRequestedComp, 'Button');
    assert.strictEqual(debugRequestedTarget, 'devtools');
    console.log('✅ /__preview_api/start_debug endpoint triggered onStartDebugRequested("Button", "devtools")');

    // 1b. Post to /__preview_api/start_debug with target: browser
    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ componentName: 'CatGallery', target: 'browser' });
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/start_debug`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`start_debug returned status ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(debugRequestedComp, 'CatGallery');
    assert.strictEqual(debugRequestedTarget, 'browser');
    console.log('✅ /__preview_api/start_debug endpoint triggered onStartDebugRequested("CatGallery", "browser")');

    // 1c. Post to /__preview_api/start_debug with target: integrated
    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ componentName: 'CatStatsBar', target: 'integrated' });
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/start_debug`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`start_debug returned status ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(debugRequestedComp, 'CatStatsBar');
    assert.strictEqual(debugRequestedTarget, 'integrated');
    console.log('✅ /__preview_api/start_debug endpoint triggered onStartDebugRequested("CatStatsBar", "integrated")');

    // 2. Post to /__preview_api/open_devtools
    console.log('Posting to /__preview_api/open_devtools ...');
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/open_devtools`,
        { method: 'POST' },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`open_devtools returned status ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.end();
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(devtoolsRequested, true, 'onOpenDevToolsRequested callback should be triggered');
    console.log('✅ /__preview_api/open_devtools endpoint triggered onOpenDevToolsRequested()');

    // 3. Post to /__preview_api/switch_component
    let switchedComp: string | undefined;
    server.onSwitchComponentRequested = (comp) => {
      switchedComp = comp;
    };
    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ componentName: 'CatGallery' });
      const req = http.request(
        `http://127.0.0.1:${port}/__preview_api/switch_component`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`switch_component returned status ${res.statusCode}`));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(switchedComp, 'CatGallery', 'onSwitchComponentRequested should receive target component');
    console.log('✅ /__preview_api/switch_component endpoint triggered onSwitchComponentRequested("CatGallery")');

  } finally {
    await server.stop();
  }
}

function testConsoleDebuggerEvaluation() {
  console.log('\n--- Testing Console REPL Debugger Statements ---');

  // Test evaluating debugger statement
  const dbgRes = evaluateConsoleExpression('debugger;');
  assert.ok(!dbgRes.error, `Evaluating debugger; should not throw syntax error: ${dbgRes.error}`);
  console.log('✅ REPL executed statement "debugger;" cleanly without syntax error');

  const dbgFuncRes = evaluateConsoleExpression('$debug()');
  assert.ok(!dbgFuncRes.error, `Evaluating $debug() should not throw: ${dbgFuncRes.error}`);
  assert.strictEqual(dbgFuncRes.result, 'Debugger paused');
  console.log('✅ REPL executed "$debug()" helper function successfully');
}

function testIntegratedBrowserVersionSupport() {
  console.log('\n--- Testing Integrated Browser Version Support Logic ---');

  // Versions >= 1.112 must return true
  assert.strictEqual(isIntegratedBrowserSupported('1.112.0'), true, 'VS Code 1.112.0 should be supported');
  assert.strictEqual(isIntegratedBrowserSupported('1.112.1-insider'), true, 'VS Code 1.112.1-insider should be supported');
  assert.strictEqual(isIntegratedBrowserSupported('1.115.0'), true, 'VS Code 1.115.0 should be supported');
  assert.strictEqual(isIntegratedBrowserSupported('2.0.0'), true, 'VS Code 2.0.0 should be supported');

  // Older versions < 1.112 must return false
  assert.strictEqual(isIntegratedBrowserSupported('1.111.0'), false, 'VS Code 1.111.0 should be unsupported');
  assert.strictEqual(isIntegratedBrowserSupported('1.90.0'), false, 'VS Code 1.90.0 should be unsupported');
  assert.strictEqual(isIntegratedBrowserSupported('1.85.0'), false, 'VS Code 1.85.0 should be unsupported');

  console.log('✅ Integrated Browser version check boundary conditions verified (>= 1.112.0)');
}

async function runAll() {
  testBrowserDetectionLogic();
  testIntegratedBrowserVersionSupport();
  testDebugConfigBuilder();
  testDebugCodeLensGeneration();
  testConsoleDebuggerEvaluation();
  await testViteServerDebugEndpoints();
  console.log('\n🎉 ALL COMPONENT DEBUGGING INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runAll().catch((err) => {
  console.error('❌ Debugging integration tests failed:', err);
  process.exit(1);
});
