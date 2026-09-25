import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { createServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { ComponentPreviewMeta } from '../parser/commentParser';

export interface PreviewServerState {
  currentFile: string;
  currentComponentName: string;
  meta: ComponentPreviewMeta;
  isLocked?: boolean;
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

    const self = this;
    const harnessEntryPath = path.resolve(this.extensionPath, 'preview-app/src/Harness.tsx').replace(/\\/g, '/');

    const previewPlugin = {
      name: 'vscode-component-preview-plugin',
      configureServer(devServer: ViteDevServer) {
        devServer.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (url.startsWith('/__preview_api/toggle_lock') && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = body ? JSON.parse(body) : {};
                if (self.onLockToggled) {
                  self.onLockToggled(data.locked);
                }
              } catch (e) {}
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }

          if (url.startsWith('/__preview_api/stop_server') && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            if (self.onStopRequested) {
              setTimeout(() => {
                self.onStopRequested?.();
              }, 50);
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
      load(id: string) {
        if (id.startsWith('\0preview_entry.tsx')) {
          if (!self.state) {
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

          const normalizedFilePath = self.state.currentFile.replace(/\\/g, '/');
          const fileImportUrl = `/@fs/${normalizedFilePath}`;
          const harnessImportUrl = `/@fs/${harnessEntryPath}`;
          const compName = self.state.currentComponentName;
          const variantsJson = JSON.stringify(self.state.meta.variants);
          const isLocked = self.state.isLocked ? 'true' : 'false';

          const compDir = path.dirname(self.state.currentFile);
          const cleanStorePaths = Array.from(
            new Set(
              self.state.meta.variants
                .map((v) => (v.storePath ? v.storePath.split('#')[0].trim() : undefined))
                .filter((sp): sp is string => Boolean(sp))
            )
          );

          const storeEntries: Array<{
            cleanPath: string;
            importVar: string;
            importStatement?: string;
            error?: string;
          }> = [];

          cleanStorePaths.forEach((cleanPath, index) => {
            const importVar = `StoreModule_${index}`;

            if (cleanPath.startsWith('.')) {
              const candidates = [
                cleanPath,
                `${cleanPath}.ts`,
                `${cleanPath}.tsx`,
                `${cleanPath}.js`,
                `${cleanPath}.jsx`,
                path.join(cleanPath, 'index.ts'),
                path.join(cleanPath, 'index.tsx'),
                path.join(cleanPath, 'index.js'),
                path.join(cleanPath, 'index.jsx'),
              ];
              let resolvedFile: string | null = null;
              for (const cand of candidates) {
                const full = path.resolve(compDir, cand);
                if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                  resolvedFile = full;
                  break;
                }
              }

              if (resolvedFile) {
                const normalizedStoreFile = resolvedFile.replace(/\\/g, '/');
                storeEntries.push({
                  cleanPath,
                  importVar,
                  importStatement: `import * as ${importVar} from '/@fs/${normalizedStoreFile}';`,
                });
              } else {
                storeEntries.push({
                  cleanPath,
                  importVar,
                  error: `Could not find store file "${cleanPath}" relative to ${normalizedFilePath}`,
                });
              }
            } else {
              // Alias or node module path
              storeEntries.push({
                cleanPath,
                importVar,
                importStatement: `import * as ${importVar} from '${cleanPath}';`,
              });
            }
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
        return null;
      },
    };

    // Find an open port
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
        alias: this.getWorkspaceAliases(workspaceRoot),
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
    const actualPort = this.server.config.server.port || this.port;
    this.port = actualPort;
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

  private getWorkspaceAliases(workspaceRoot: string): Array<{ find: RegExp | string; replacement: string }> {
    const aliases: Array<{ find: RegExp | string; replacement: string }> = [];

    // Fallback for React/ReactDOM if workspace does not have them in its node_modules
    const workspaceHasReact = fs.existsSync(path.join(workspaceRoot, 'node_modules', 'react'));
    if (!workspaceHasReact) {
      const extReact = path.join(this.extensionPath, 'node_modules', 'react');
      const extReactDom = path.join(this.extensionPath, 'node_modules', 'react-dom');
      if (fs.existsSync(extReact)) {
        aliases.push({ find: 'react', replacement: extReact });
      }
      if (fs.existsSync(extReactDom)) {
        aliases.push({ find: 'react-dom', replacement: extReactDom });
      }
    }

    // Read tsconfig.json or jsconfig.json path mappings from workspace
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = path.join(workspaceRoot, configName);
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          // Strip single-line and multi-line comments & trailing commas
          const cleaned = content
            .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
            .replace(/,\s*([}\]])/g, '$1');
          const parsed = JSON.parse(cleaned);
          const compilerOptions = parsed?.compilerOptions;
          if (compilerOptions) {
            const baseUrl = compilerOptions.baseUrl ? path.resolve(workspaceRoot, compilerOptions.baseUrl) : workspaceRoot;
            if (compilerOptions.paths) {
              for (const [key, targets] of Object.entries<string[]>(compilerOptions.paths)) {
                if (Array.isArray(targets) && targets.length > 0) {
                  const target = targets[0];
                  if (key.endsWith('/*')) {
                    const prefix = key.slice(0, -2);
                    const targetPrefix = target.endsWith('/*') ? target.slice(0, -2) : target;
                    const replacementDir = path.resolve(baseUrl, targetPrefix);
                    aliases.push({
                      find: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.*)$`),
                      replacement: `${replacementDir.replace(/\\/g, '/')}/$1`,
                    });
                  } else {
                    aliases.push({
                      find: key,
                      replacement: path.resolve(baseUrl, target).replace(/\\/g, '/'),
                    });
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore invalid tsconfig parse errors
        }
        break;
      }
    }

    return aliases;
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
