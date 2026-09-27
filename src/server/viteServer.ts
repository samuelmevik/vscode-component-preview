import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { createServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SourceMapConsumer } from 'source-map-js';
import { ComponentPreviewMeta } from '../parser/commentParser';
import { getWorkspaceAliases } from './workspaceAliases';

export interface RuntimeErrorPayload {
  id?: string;
  message: string;
  source?: string;
  location?: {
    filePath: string;
    fileName: string;
    functionName?: string;
    line: number;
    column: number;
    originalResolved?: boolean;
  };
  stack?: string;
  timestamp?: string;
}

export interface PreviewServerState {
  currentFile: string;
  currentComponentName: string;
  componentStartLine?: number;
  commentStartLine?: number;
  meta: ComponentPreviewMeta;
  allComponents?: string[];
  isLocked?: boolean;
}

export function normalizeDriveLetter(p: string): string {
  return p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toUpperCase()}:`);
}

const STORE_CANDIDATE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

function resolveStoreFile(baseDir: string, relativePath: string): string | null {
  for (const ext of STORE_CANDIDATE_EXTENSIONS) {
    const full = path.resolve(baseDir, relativePath + ext);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full;
    }
  }
  return null;
}

function generateVirtualEntry(
  state: PreviewServerState | null,
  harnessEntryPath: string
): string {
  if (!state) {
    return `
      import React from 'react';
      import ReactDOM from 'react-dom/client';
      const rootElement = document.getElementById('root');
      if (rootElement) {
        if (!window.__preview_root__) {
          window.__preview_root__ = ReactDOM.createRoot(rootElement);
        }
        window.__preview_root__.render(
          React.createElement('div', {
            style: { color: '#888', padding: '24px', fontFamily: 'sans-serif', textAlign: 'center' }
          }, 'No active component selected for preview.')
        );
      }
      if (import.meta.hot) {
        import.meta.hot.accept();
      }
    `;
  }

  const normalizedFilePath = normalizeDriveLetter(state.currentFile.replace(/\\/g, '/'));
  const fileImportUrl = `/@fs/${normalizedFilePath}`;
  const harnessImportUrl = `/@fs/${normalizeDriveLetter(harnessEntryPath)}`;
  const compName = state.currentComponentName;
  const variantsJson = JSON.stringify(state.meta.variants);
  const isLocked = state.isLocked ? 'true' : 'false';
  const compDir = path.dirname(state.currentFile);

  const cleanStorePaths = Array.from(
    new Set(
      state.meta.variants
        .map((v) => (v.storePath ? v.storePath.split('#')[0].trim() : undefined))
        .filter((sp): sp is string => Boolean(sp))
    )
  );

  const storeEntries = cleanStorePaths.map((cleanPath, index) => {
    const importVar = `StoreModule_${index}`;
    if (cleanPath.startsWith('.')) {
      const resolved = resolveStoreFile(compDir, cleanPath);
      if (resolved) {
        return {
          cleanPath,
          importVar,
          importStatement: `import * as ${importVar} from '/@fs/${resolved.replace(/\\/g, '/')}';`,
        };
      }
      return {
        cleanPath,
        importVar,
        error: `Could not find store file "${cleanPath}" relative to ${normalizedFilePath}`,
      };
    }
    return {
      cleanPath,
      importVar,
      importStatement: `import * as ${importVar} from '${cleanPath}';`,
    };
  });

  const storeImports = storeEntries
    .filter((e) => e.importStatement)
    .map((e) => e.importStatement)
    .join('\n');

  const storeModulesMap = storeEntries
    .map((e) => {
      if (e.error) {
        return `${JSON.stringify(e.cleanPath)}: { __error__: ${JSON.stringify(e.error)} }`;
      }
      return `${JSON.stringify(e.cleanPath)}: ${e.importVar}`;
    })
    .join(',\n              ');

  const cleanWrapperPaths = Array.from(
    new Set(
      state.meta.variants
        .map((v) => (v.wrapperPath ? v.wrapperPath.split('#')[0].trim() : undefined))
        .filter((wp): wp is string => Boolean(wp))
    )
  );

  const wrapperEntries = cleanWrapperPaths.map((cleanPath, index) => {
    const importVar = `WrapperModule_${index}`;
    if (cleanPath.startsWith('.')) {
      const resolved = resolveStoreFile(compDir, cleanPath);
      if (resolved) {
        return {
          cleanPath,
          importVar,
          importStatement: `import * as ${importVar} from '/@fs/${resolved.replace(/\\/g, '/')}';`,
        };
      }
      return {
        cleanPath,
        importVar,
        error: `Could not find wrapper file "${cleanPath}" relative to ${normalizedFilePath}`,
      };
    }
    return {
      cleanPath,
      importVar,
      importStatement: `import * as ${importVar} from '${cleanPath}';`,
    };
  });

  const wrapperImports = wrapperEntries
    .filter((e) => e.importStatement)
    .map((e) => e.importStatement)
    .join('\n');

  const wrapperModulesMap = wrapperEntries
    .map((e) => {
      if (e.error) {
        return `${JSON.stringify(e.cleanPath)}: { __error__: ${JSON.stringify(e.error)} }`;
      }
      return `${JSON.stringify(e.cleanPath)}: ${e.importVar}`;
    })
    .join(',\n              ');

  const allComponentsJson = JSON.stringify(state.allComponents || []);

  return `
    import React from 'react';
    import ReactDOM from 'react-dom/client';
    import { Harness } from '${harnessImportUrl}';
    import * as UserModule from '${fileImportUrl}';
    ${storeImports}
    ${wrapperImports}

    const SelectedComponent = UserModule['${compName}'] || UserModule.default;
    const initialVariants = ${variantsJson};
    const storeModules = {
      ${storeModulesMap}
    };
    const wrapperModules = {
      ${wrapperModulesMap}
    };
    const initialAllComponents = ${allComponentsJson};

    const rootElement = document.getElementById('root');
    if (rootElement) {
      if (!window.__preview_root__) {
        window.__preview_root__ = ReactDOM.createRoot(rootElement);
      }
      const previewRoot = window.__preview_root__;
      if (!SelectedComponent) {
        previewRoot.render(
          React.createElement('div', {
            style: {
              background: '#221518',
              border: '1px solid rgba(241, 76, 76, 0.4)',
              borderRadius: '8px',
              padding: '24px 28px',
              maxWidth: '480px',
              margin: '32px auto',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              color: '#ffffff'
            }
          }, [
            React.createElement('h3', {
              key: 'h',
              style: { margin: '0 0 10px 0', color: '#ff8888', fontSize: '15px' }
            }, 'Component Not Found in Export'),
            React.createElement('p', {
              key: 'p',
              style: { margin: '0 0 16px 0', fontSize: '13px', color: '#cccccc', lineHeight: '1.5' }
            }, 'Component "${compName}" was not found in exports of ${normalizedFilePath}. Check the component name or export syntax.'),
            React.createElement('button', {
              key: 'b',
              style: {
                background: '#0e639c',
                color: '#ffffff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              },
              onClick: () => {
                const payload = { filePath: '${normalizedFilePath}', line: ${state.componentStartLine || 1}, column: 1 };
                window.parent.postMessage({ type: 'NAVIGATE_TO_SOURCE', payload }, '*');
                fetch('/__preview_api/navigate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                }).catch(() => {});
              }
            }, 'Open Component in Editor')
          ])
        );
      } else {
        previewRoot.render(
          React.createElement(Harness, {
            ComponentToRender: SelectedComponent,
            userModule: UserModule,
            storeModules: storeModules,
            wrapperModules: wrapperModules,
            initialComponentName: '${compName}',
            initialVariants: initialVariants,
            initialAllComponents: initialAllComponents,
            initialIsLocked: ${isLocked},
            currentFilePath: '${normalizedFilePath}',
            componentStartLine: ${state.componentStartLine || 1},
            commentStartLine: ${state.commentStartLine || 1}
          })
        );
      }
    }

    if (import.meta.hot) {
      import.meta.hot.accept();
    }
  `;
}

export class PreviewViteServer {
  private server: ViteDevServer | null = null;
  private defaultPort: number = 4545;
  private port: number = 4545;
  private state: PreviewServerState | null = null;
  private extensionPath: string;
  public onLockToggled?: (locked?: boolean) => void;
  public onStopRequested?: () => void;
  public onNavigateRequested?: (filePath: string, line?: number, column?: number) => void;
  public onRuntimeError?: (error: RuntimeErrorPayload) => void;
  public onRuntimeErrorUpdate?: (data: { id?: string; location: any }) => void;
  public onConsoleLog?: (log: { level: string; text: string; timestamp?: string }) => void;
  public onCopyToClipboard?: (text: string) => Promise<void> | void;

  constructor(extensionPath: string, port = 4545) {
    this.extensionPath = extensionPath;
    this.defaultPort = port;
    this.port = port;
  }

  public setDefaultPort(port: number) {
    this.defaultPort = port;
  }

  public isRunning(): boolean {
    return this.server !== null;
  }

  public getPort(): number {
    return this.port;
  }

  public getState(): PreviewServerState | null {
    return this.state;
  }

  public updateState(newState: PreviewServerState) {
    const fileChanged = this.state?.currentFile !== newState.currentFile;
    const compChanged = this.state?.currentComponentName !== newState.currentComponentName;
    this.state = newState;

    // Only invalidate preview entry if the preview target changed (different file or component).
    // For edits within the same component, Vite's React Fast Refresh automatically hot-swaps
    // the component in-place, preserving React state (inputs, useState, etc.).
    if (this.server && (fileChanged || compChanged)) {
      const mods = Array.from(this.server.moduleGraph.idToModuleMap.values()).filter(
        (m) => m.id && m.id.includes('preview_entry.tsx')
      );
      for (const mod of mods) {
        this.server.moduleGraph.invalidateModule(mod);
      }
      const hot = (this.server as any).hot || (this.server as any).ws;
      if (hot && typeof hot.send === 'function') {
        hot.send({
          type: 'update',
          updates: [
            {
              type: 'js-update',
              path: '/__preview_entry__.tsx',
              acceptedPath: '/__preview_entry__.tsx',
              timestamp: Date.now(),
            },
          ],
        });
      }
    }
  }

  public async start(workspaceRoot: string): Promise<number> {
    if (this.server) {
      return this.port;
    }

    const harnessEntryPath = normalizeDriveLetter(
      path
        .resolve(this.extensionPath, 'preview-app/src/Harness.tsx')
        .replace(/\\/g, '/')
    );

    const previewPlugin = {
      name: 'vscode-component-preview-plugin',
      configureServer: (devServer: ViteDevServer) => {
        devServer.middlewares.use((req, res, next) => {
          const url = req.url || '';

          if (url.startsWith('/__preview_api/toggle_lock') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = body ? JSON.parse(body) : {};
                this.onLockToggled?.(data.locked);
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/stop_server') && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            if (this.onStopRequested) {
              setTimeout(() => this.onStopRequested?.(), 50);
            }
            return;
          }

          if (url.startsWith('/__preview_api/copy') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (typeof data.text === 'string' && this.onCopyToClipboard) {
                  await this.onCopyToClipboard(data.text);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/navigate') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (data.filePath && this.onNavigateRequested) {
                  let targetFile = data.filePath;
                  let targetLine = data.line || 1;
                  let targetCol = data.column || 1;
                  if (!data.originalResolved) {
                    const resolved = await this.resolveOriginalPosition(targetFile, targetLine, targetCol);
                    targetFile = resolved.filePath;
                    targetLine = resolved.line;
                    targetCol = resolved.column;
                  }
                  this.onNavigateRequested(targetFile, targetLine, targetCol);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/report_error_update') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (this.onRuntimeErrorUpdate) {
                  this.onRuntimeErrorUpdate(data);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/report_error') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (this.onRuntimeError) {
                  if (data.location?.filePath && data.location?.line && !data.location.originalResolved) {
                    const resolved = await this.resolveOriginalPosition(
                      data.location.filePath,
                      data.location.line,
                      data.location.column || 1
                    );
                    data.location.filePath = resolved.filePath;
                    data.location.line = resolved.line;
                    data.location.column = resolved.column;
                    data.location.fileName = path.basename(resolved.filePath);
                    data.location.originalResolved = true;
                  }
                  this.onRuntimeError(data);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/log') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (this.onConsoleLog) {
                  this.onConsoleLog(data);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__open-in-editor')) {
            (async () => {
              try {
                const parsedUrl = new URL(req.url || '', 'http://127.0.0.1');
                const fileParam = parsedUrl.searchParams.get('file');
                if (fileParam && this.onNavigateRequested) {
                  const parts = fileParam.split(':');
                  let filePath = parts[0];
                  let line = 1;
                  let col = 1;
                  if (parts.length > 2 && /^[a-zA-Z]$/.test(parts[0]) && parts[1].startsWith('/')) {
                    filePath = `${parts[0]}:${parts[1]}`;
                    line = parseInt(parts[2], 10) || 1;
                    col = parseInt(parts[3], 10) || 1;
                  } else if (parts.length >= 2) {
                    line = parseInt(parts[1], 10) || 1;
                    col = parseInt(parts[2], 10) || 1;
                  }
                  const resolved = await this.resolveOriginalPosition(filePath, line, col);
                  this.onNavigateRequested(resolved.filePath, resolved.line, resolved.column);
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            })();
            return;
          }

          if (url.startsWith('/__preview__')) {
            const timestamp = Date.now();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React Component Preview</title>
    <!-- React Refresh Preamble required by @vitejs/plugin-react -->
    <script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module" src="/@vite/client"></script>
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/__preview_entry__.tsx"></script>
  </body>
</html>`);
            return;
          }

          next();
        });
      },
      resolveId(id: string) {
        if (id === '/__preview_entry__.tsx' || id.startsWith('/__preview_entry__.tsx')) {
          return '\0preview_entry.tsx';
        }
        return null;
      },
      load: (id: string) => {
        if (id === '\0preview_entry.tsx' || id.startsWith('\0preview_entry.tsx')) {
          return generateVirtualEntry(this.state, harnessEntryPath);
        }
        return null;
      },
    };

    this.port = await this.findAvailablePort(this.defaultPort);

    this.server = await createServer({
      configFile: false,
      root: workspaceRoot,
      server: {
        port: this.port,
        strictPort: false,
        host: '127.0.0.1',
        cors: true,
        fs: {
          strict: false,
          allow: [workspaceRoot, this.extensionPath],
        },
      },
      resolve: {
        dedupe: ['react', 'react-dom'],
        alias: getWorkspaceAliases(workspaceRoot, this.extensionPath),
      },
      plugins: [
        react(),
        previewPlugin,
      ],
      css: {
        preprocessorOptions: {
          scss: {
            api: 'modern-compiler',
          },
        },
      },
      logLevel: 'info',
    });

    await this.server.listen();
    this.port = this.server.config.server.port || this.port;
    console.log(`[Component Preview] Vite dev server running at http://127.0.0.1:${this.port}`);
    return this.port;
  }

  public getPreviewUrl(): string {
    return `http://127.0.0.1:${this.port}/__preview__`;
  }

  /**
   * Resolves a transpiled generated (line, col) to the exact original TSX/JSX authoring line and column
   * using Vite dev server sourcemaps.
   */
  public async resolveOriginalPosition(
    filePath: string,
    line: number = 1,
    column: number = 1
  ): Promise<{ filePath: string; line: number; column: number }> {
    if (!this.server || !filePath) {
      return { filePath, line, column };
    }

    try {
      const normalized = filePath.replace(/\\/g, '/');
      const candidates: string[] = [];

      // 1. Vite /@fs/ absolute path
      if (path.isAbsolute(filePath) || /^[a-zA-Z]:/.test(filePath)) {
        candidates.push(`/@fs/${normalized.replace(/^\/+/, '')}`);
      }

      // 2. Relative to workspace root if inside root
      if (this.server.config.root) {
        const rootNorm = this.server.config.root.replace(/\\/g, '/');
        if (normalized.startsWith(rootNorm)) {
          candidates.push(normalized.substring(rootNorm.length));
        }
      }

      // 3. Clean relative path candidates
      const cleanRel = normalized
        .replace(/^https?:\/\/[^/]+\//, '')
        .replace(/^\/@fs\//, '')
        .replace(/^\/+/, '');
      candidates.push(`/${cleanRel}`);
      candidates.push(`/${path.basename(cleanRel)}`);

      for (const reqUrl of candidates) {
        try {
          const transformed = await this.server.transformRequest(reqUrl);
          let rawMap = transformed?.map;

          if (!rawMap && transformed?.code) {
            const smMatch = transformed.code.match(
              /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,(.+)$/m
            );
            if (smMatch) {
              const jsonStr = Buffer.from(smMatch[1], 'base64').toString('utf8');
              rawMap = JSON.parse(jsonStr);
            }
          }

          if (rawMap) {
            const smc = new SourceMapConsumer(rawMap as any);
            const orig = smc.originalPositionFor({
              line,
              column: Math.max(0, column - 1),
            });

            if (orig && typeof orig.line === 'number') {
              let origPath = filePath;
              if (orig.source) {
                const origSource = orig.source.replace(/\\/g, '/');
                if (path.isAbsolute(origSource)) {
                  origPath = origSource;
                } else if (path.isAbsolute(filePath)) {
                  origPath = path.resolve(path.dirname(filePath), origSource).replace(/\\/g, '/');
                } else if (this.server.config.root) {
                  origPath = path.resolve(this.server.config.root, origSource).replace(/\\/g, '/');
                } else {
                  origPath = origSource;
                }
              }
              return {
                filePath: origPath,
                line: orig.line,
                column: orig.column !== null ? orig.column + 1 : column,
              };
            }
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[Component Preview] Notice during sourcemap resolution:', err);
    }

    return { filePath, line, column };
  }

  public async stop(): Promise<void> {
    if (this.server) {
      const s = this.server;
      this.server = null;
      try {
        const httpServer = s.httpServer;
        if (httpServer && typeof (httpServer as any).closeAllConnections === 'function') {
          (httpServer as any).closeAllConnections();
        }
        await Promise.race([
          s.close(),
          new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
      } catch (err) {
        console.warn('[Component Preview] Notice during Vite server close:', err);
      }
      console.log('[Component Preview] Vite dev server stopped.');
    }
  }

  private findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(startPort, '127.0.0.1', () => {
        server.close(() => resolve(startPort));
      });
      server.on('error', () => {
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }
}
