import * as path from 'path';
import * as http from 'http';
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
  private port: number = 4545;
  private state: PreviewServerState | null = null;
  private extensionPath: string;
  public onLockToggled?: (locked?: boolean) => void;

  constructor(extensionPath: string, port = 4545) {
    this.extensionPath = extensionPath;
    this.port = port;
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

          return `
            import React from 'react';
            import ReactDOM from 'react-dom/client';
            import { Harness } from '${harnessImportUrl}';
            import * as UserModule from '${fileImportUrl}';

            const SelectedComponent = UserModule['${compName}'] || UserModule.default;
            const initialVariants = ${variantsJson};

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
    this.port = await this.findAvailablePort(this.port);

    this.server = await createServer({
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
      await this.server.close();
      this.server = null;
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
