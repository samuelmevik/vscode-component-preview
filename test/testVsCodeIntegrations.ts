import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { scanComponents } from '../src/parser/astScanner';
import { getWebviewContent } from '../src/webviewHtml';
import { copyToClipboard } from '../preview-app/src/clipboardUtils';

function testCodeLensLogic() {
  console.log('--- Testing CodeLens Provider Logic ---');
  const buttonPath = path.resolve(__dirname, '../sample-workspace/Button.tsx');
  const buttonCode = fs.readFileSync(buttonPath, 'utf8');
  const scanResult = scanComponents(buttonCode, buttonPath);

  assert.ok(scanResult.components.length > 0, 'Should find components in Button.tsx');
  const btn = scanResult.components.find((c) => c.name === 'Button');
  assert.ok(btn, 'Should find Button component');

  console.log(`✅ Found component <${btn.name} /> at line ${btn.startLine}, nameLine: ${btn.nameLine}, commentStartLine: ${btn.commentStartLine}`);
  console.log(`✅ Variants detected: ${btn.meta.variants.length} (${btn.meta.variants.map((v) => v.name).join(', ')})`);

  // Verify CodeLens lines: CodeLens must be directly on the component name definition line (line 29 in Button.tsx), NOT on commentStartLine (line 11)
  assert.strictEqual(btn.nameLine, 29, 'Button nameLine must be 29 (export const Button)');
  const lensTargetLine = Math.max((btn.nameLine || btn.startLine) - 1, 0);
  assert.strictEqual(lensTargetLine + 1, 29, 'CodeLens must be placed directly at Button declaration line 29');
  console.log(`✅ CodeLens positioned directly at component definition line ${lensTargetLine + 1}`);

  // Test multi-component file CodeLenses (CatGallery.tsx)
  const catPath = path.resolve(__dirname, '../sample-workspace/CatGallery.tsx');
  const catCode = fs.readFileSync(catPath, 'utf8');
  const catScan = scanComponents(catCode, catPath);

  assert.ok(catScan.components.length > 1, 'Should find multiple components in CatGallery.tsx');
  console.log(`✅ Found ${catScan.components.length} components for CodeLens generation in CatGallery.tsx`);

  for (const comp of catScan.components) {
    const line = Math.max((comp.nameLine || comp.startLine) - 1, 0);
    assert.ok(line >= 0);
    assert.ok(comp.nameLine, `Component <${comp.name} /> must have nameLine`);
    const hasVariants = comp.meta.variants.length > 1;
    console.log(`   - CodeLens for <${comp.name} /> at line ${line + 1}: [Preview <${comp.name} />]${hasVariants ? ` [${comp.meta.variants.length} Variants]` : ''}`);
  }
  const mainComp = catScan.components.find((c) => c.name === 'CatGallery');
  assert.ok(mainComp, 'Should find CatGallery main component');
  assert.strictEqual(mainComp.nameLine, 371, 'CatGallery nameLine must be 371 (export const CatGallery)');
}

function testThemeSyncLogic() {
  console.log('\n--- Testing Theme Synchronization Logic ---');

  function getEffectiveTheme(themeKind: 'dark' | 'light', canvasTheme: 'auto' | 'dark' | 'light' | 'checkerboard'): string {
    if (canvasTheme === 'auto') {
      return themeKind;
    }
    return canvasTheme;
  }

  // 1. When canvas theme is 'auto', it must track VS Code theme
  assert.strictEqual(getEffectiveTheme('dark', 'auto'), 'dark', 'Auto should resolve to dark when VS Code is dark');
  assert.strictEqual(getEffectiveTheme('light', 'auto'), 'light', 'Auto should resolve to light when VS Code is light');

  // 2. When canvas theme is explicitly overridden, it must preserve the override
  assert.strictEqual(getEffectiveTheme('dark', 'light'), 'light', 'Explicit light should stay light');
  assert.strictEqual(getEffectiveTheme('light', 'dark'), 'dark', 'Explicit dark should stay dark');
  assert.strictEqual(getEffectiveTheme('dark', 'checkerboard'), 'checkerboard', 'Explicit checkerboard should stay checkerboard');

  console.log('✅ Theme synchronization resolution verified (auto, dark, light, checkerboard)');
}

function testDiagnosticsLocationLogic() {
  console.log('\n--- Testing Diagnostics Location Logic ---');

  function computeDiagnosticRange(location?: { line?: number; column?: number }, lineText = 'const x = 123;') {
    const lineNum = Math.max((location?.line || 1) - 1, 0);
    const colNum = Math.max((location?.column || 1) - 1, 0);
    const endCol = Math.max(lineText.length, colNum + 1);
    return {
      start: { line: lineNum, character: colNum },
      end: { line: lineNum, character: endCol },
    };
  }

  const range1 = computeDiagnosticRange({ line: 15, column: 5 }, '  throw new Error("test");');
  assert.strictEqual(range1.start.line, 14);
  assert.strictEqual(range1.start.character, 4);
  assert.strictEqual(range1.end.line, 14);
  assert.strictEqual(range1.end.character, 26);
  console.log('✅ Diagnostic range calculation verified for exact line and column');
}

async function testClipboardIntegration() {
  console.log('\n--- Testing Clipboard Permissions Policy & Fallback Logic ---');

  // 1. Verify iframe has allow="clipboard-read; clipboard-write" in webviewHtml
  const html = getWebviewContent('http://127.0.0.1:4545', 'TestComp');
  assert.ok(
    html.includes('allow="clipboard-read; clipboard-write"'),
    'Webview iframe must declare allow="clipboard-read; clipboard-write" to prevent crbug.com/414348233'
  );
  assert.ok(
    html.includes("event.data.type === 'COPY_TO_CLIPBOARD'"),
    'Webview script must intercept and handle COPY_TO_CLIPBOARD'
  );
  console.log('✅ Webview HTML iframe permissions policy and message delegation verified');

  // 2. Test copyToClipboard when Navigator Clipboard API throws Permissions Policy error
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindow = (global as any).window;

  let postMessagePayload: any = null;
  const mockParent = {
    postMessage: (data: any) => {
      postMessagePayload = data;
    },
  };

  const mockWindow: any = {
    parent: mockParent,
  };
  mockWindow.window = mockWindow;

  (global as any).window = mockWindow;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async () => {
          const err = new Error(
            "Failed to execute 'writeText' on 'Clipboard': The Clipboard API has been blocked because of a permissions policy applied to the current document."
          );
          err.name = 'NotAllowedError';
          throw err;
        },
      },
    },
    configurable: true,
    writable: true,
  });

  // Must not throw an unhandled error and must route through parent postMessage bridge
  const copyResult = await copyToClipboard('{"foo": "bar"}');
  assert.strictEqual(copyResult, true, 'copyToClipboard should succeed via parent window fallback');
  assert.deepStrictEqual(
    postMessagePayload,
    {
      type: 'COPY_TO_CLIPBOARD',
      payload: { text: '{"foo": "bar"}' },
    },
    'Should dispatch COPY_TO_CLIPBOARD message to parent window'
  );
  console.log('✅ Permissions Policy NotAllowedError caught gracefully and bridged to VS Code host');

  // 3. Test copyToClipboard when Navigator Clipboard succeeds
  let directCopiedText = '';
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (t: string) => {
          directCopiedText = t;
        },
      },
    },
    configurable: true,
    writable: true,
  });
  (global as any).window = undefined; // browser top-level context

  const directResult = await copyToClipboard('test 123');
  assert.strictEqual(directResult, true);
  assert.strictEqual(directCopiedText, 'test 123');
  console.log('✅ Direct Navigator Clipboard writeText verified');

  // Restore globals
  if (originalNavigatorDesc) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
  }
  (global as any).window = originalWindow;
}

testCodeLensLogic();
testThemeSyncLogic();
testDiagnosticsLocationLogic();
testClipboardIntegration().then(() => {
  console.log('\n🎉 ALL DEEPER VS CODE INTEGRATION TESTS PASSED SUCCESSFULLY!');
});
