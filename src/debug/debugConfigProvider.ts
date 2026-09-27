import type * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

function getVsCode(): typeof vscode | null {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

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

export function isIntegratedBrowserSupported(version?: string): boolean {
  try {
    const v = version ?? getVsCode()?.version ?? '1.112.0';
    const clean = String(v).replace(/^[^\d]*/, '');
    const parts = clean.split('.').map((p) => parseInt(p, 10));
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    // Integrated browser was added in VS Code 1.112
    if (major > 1) return true;
    return major === 1 && minor >= 112;
  } catch {
    return false;
  }
}

export function showUnsupportedVersionToast(version?: string): void {
  const vsc = getVsCode();
  if (!vsc) return;
  const currentVersion = version ?? vsc.version ?? 'unknown';
  vsc.window
    ?.showErrorMessage(
      `Component Preview requires VS Code 1.112 or newer for the Integrated Browser. Your current version is ${currentVersion}. Please update VS Code.`,
      'Update VS Code',
      'Learn More'
    )
    ?.then((choice) => {
      if (choice === 'Update VS Code') {
        vsc.env.openExternal(vsc.Uri.parse('https://code.visualstudio.com/updates'));
      } else if (choice === 'Learn More') {
        vsc.env.openExternal(vsc.Uri.parse('https://code.visualstudio.com/docs/debugtest/integrated-browser'));
      }
    });
}

export type DebugBrowserType = 'editor-browser' | 'pwa-chrome' | 'pwa-msedge';

export function resolveDebugBrowserType(
  configuredPref: string = 'integrated',
  platform = process.platform
): DebugBrowserType {
  if (configuredPref === 'chrome') return 'pwa-chrome';
  if (configuredPref === 'edge') return 'pwa-msedge';
  return 'editor-browser';
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
  const browserType = options.browserType || 'editor-browser';
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
