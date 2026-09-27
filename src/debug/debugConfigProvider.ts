import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function detectInstalledBrowser(platform = process.platform): 'pwa-chrome' | 'pwa-msedge' {
  if (platform === 'win32') {
    const chromePaths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const cp of chromePaths) {
      try {
        if (fs.existsSync(cp)) return 'pwa-chrome';
      } catch {}
    }
    // On Windows 10/11, Edge is guaranteed to be present
    return 'pwa-msedge';
  } else if (platform === 'darwin') {
    if (fs.existsSync('/Applications/Google Chrome.app')) return 'pwa-chrome';
    if (fs.existsSync('/Applications/Microsoft Edge.app')) return 'pwa-msedge';
    return 'pwa-chrome';
  }
  return 'pwa-chrome';
}

export type DebugBrowserType = 'editor-browser' | 'pwa-chrome' | 'pwa-msedge';

export function resolveDebugBrowserType(
  configuredPref: string = 'auto',
  platform = process.platform
): DebugBrowserType {
  if (configuredPref === 'integrated' || configuredPref === 'editor-browser') return 'editor-browser';
  if (configuredPref === 'chrome') return 'pwa-chrome';
  if (configuredPref === 'edge') return 'pwa-msedge';
  return detectInstalledBrowser(platform);
}

export interface ComponentDebugConfigOptions {
  compName: string;
  previewUrl: string;
  webRoot: string;
  browserType?: DebugBrowserType;
  port?: number;
}

export function buildComponentDebugConfig(
  options: ComponentDebugConfigOptions
): vscode.DebugConfiguration {
  const browserType = options.browserType || 'pwa-chrome';
  const cleanWebRoot = options.webRoot.replace(/\\/g, '/');

  return {
    type: browserType,
    name: `Debug <${options.compName} /> (Component Preview)`,
    request: 'launch',
    url: options.previewUrl,
    webRoot: cleanWebRoot,
    sourceMaps: true,
    smartStep: true,
    skipFiles: [
      '<node_internals>/**',
      '**/node_modules/**',
      '**/@vite/**',
      '**/@react-refresh',
      '**/preview-app/**',
    ],
    sourceMapPathOverrides: {
      '/@fs/*': '/*',
      'file:///*': '/*',
      '/*': '${webRoot}/*',
    },
  };
}

export interface DebugStateProvider {
  getActiveComponent: () => { filePath: string; compName: string } | null;
  getServerPort: () => number;
  resolveDebugBrowserType: () => DebugBrowserType;
}

export class ComponentPreviewDebugConfigProvider implements vscode.DebugConfigurationProvider {
  private stateProvider: DebugStateProvider;

  constructor(stateProvider: DebugStateProvider) {
    this.stateProvider = stateProvider;
  }

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // If launch.json is empty or user initiated debugging through "Component Preview: Debug Component"
    if (!config.type && !config.request && !config.name) {
      const active = this.stateProvider.getActiveComponent();
      const compName = active?.compName || 'Component';
      const browser = this.stateProvider.resolveDebugBrowserType();
      const port = this.stateProvider.getServerPort() || 4545;
      const previewUrl = `http://127.0.0.1:${port}/__preview__`;
      const webRoot = folder ? folder.uri.fsPath : active?.filePath ? path.dirname(active.filePath) : process.cwd();

      return buildComponentDebugConfig({
        compName,
        previewUrl,
        webRoot,
        browserType: browser,
      });
    }

    if (!config.url && this.stateProvider.getServerPort()) {
      config.url = `http://127.0.0.1:${this.stateProvider.getServerPort()}/__preview__`;
    }

    return config;
  }
}
