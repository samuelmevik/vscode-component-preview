import * as vscode from 'vscode';
import { PreviewManager } from './previewManager';

let previewManager: PreviewManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Component Preview] Extension activated');
  previewManager = new PreviewManager(context);

  const commandHandlers: Array<[string, (...args: any[]) => Promise<any> | void]> = [
    ['componentPreview.openPreview', () => previewManager?.showPreview()],
    ['componentPreview.openComponent', (uri?: vscode.Uri, compName?: string, line?: number) => previewManager?.showComponent(uri, compName, line)],
    ['componentPreview.stopServer', () => previewManager?.stopServer()],
    ['componentPreview.startServer', () => previewManager?.startServerInteractive()],
    ['componentPreview.restartServer', () => previewManager?.restartServer()],
    ['componentPreview.refreshPreview', () => previewManager?.refreshPreview()],
    ['componentPreview.openInBrowser', () => previewManager?.openInExternalBrowser()],
    ['componentPreview.toggleLock', () => previewManager?.toggleLock()],
  ];

  for (const [cmd, handler] of commandHandlers) {
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
  }

  const selector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascriptreact' },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, previewManager.codeLensProvider)
  );

  context.subscriptions.push({
    dispose: () => previewManager?.dispose(),
  });
}

export function deactivate() {
  previewManager?.dispose();
  previewManager = null;
}
