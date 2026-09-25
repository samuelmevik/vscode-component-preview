import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { createServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { ComponentPreviewMeta } from '../parser/commentParser';
import { getWorkspaceAliases } from './workspaceAliases';

export interface PreviewServerState {
  currentFile: string;
  currentComponentName: string;
  meta: ComponentPreviewMeta;
  isLocked?: boolean;
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
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(
        React.createElement('div', {
          style: { color: '#888', padding: '24px', fontFamily: 'sans-serif', textAlign: 'center' }
        }, 'No active component selected for preview.')
      );
    `;
  }

  const normalizedFilePath = state.currentFile.replace(/\\/g, '/');
  const fileImportUrl = `/@fs/${normalizedFilePath}`;
  const harnessImportUrl = `/@fs/${harnessEntryPath}`;
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

  return `
    import React from 'react';
    import ReactDOM from 'react-dom/client';
    import { Harness } from '${harnessImportUrl}';
    import * as UserModule from '${fileImportUrl}';
    ${storeImports}

    const SelectedComponent = UserModule['${compName}'] || UserModule.default;
    const initialVariants = ${variantsJson};
    const storeModules = {
      ${storeModulesMap}
    };

    const rootElement = document.getElementById('root');
    if (rootElement) {
      const root = ReactDOM.createRoot(rootElement);
      if (!SelectedComponent) {
        root.render(
          React.createElement('div', {
            style: { color: '#f14c4c', padding: '24px', fontFamily: 'sans-serif' }
          }, 'Component "${compName}" not found in export of ${normalizedFilePath}')
        );
      } else {
        root.render(
          React.createElement(Harness, {
            ComponentToRender: SelectedComponent,
            userModule: UserModule,
            storeModules: storeModules,
            initialComponentName: '${compName}',
            initialVariants: initialVariants,
            initialIsLocked: ${isLocked}
          })
        );
      }
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
    this.state = newState;
    if (this.server) {
      // Invalidate preview entry in Vite's module graph to ensure fresh renders
      const mods = Array.from(this.server.moduleGraph.idToModuleMap.values()).filter(
        (m) => m.id && m.id.includes('preview_entry.tsx')
      );
      for (const mod of mods) {
        this.server.moduleGraph.invalidateModule(mod);
      }
    }
  }

  public async start(workspaceRoot: string): Promise<number> {
    if (this.server) {
      return this.port;
    }

    const harnessEntryPath = path
      .resolve(this.extensionPath, 'preview-app/src/Harness.tsx')
      .replace(/\\/g, '/');

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
    <script type="module" src="/__preview_entry__.tsx?t=${timestamp}"></script>
  </body>
</html>`);
            return;
          }

          next();
        });
      },
      resolveId(id: string) {
        if (id.startsWith('/__preview_entry__.tsx')) {
          return '\0preview_entry.tsx?' + Date.now();
        }
        return null;
      },
      load: (id: string) => {
        if (id.startsWith('\0preview_entry.tsx')) {
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

  public async stop(): Promise<void> {
    if (this.server) {
      const s = this.server;
      this.server = null;
      await s.close();
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
