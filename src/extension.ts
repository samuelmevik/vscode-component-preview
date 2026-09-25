import * as vscode from 'vscode';
import { PreviewManager } from './previewManager';

let previewManager: PreviewManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Component Preview] Extension activated');
  previewManager = new PreviewManager(context);

  const commandHandlers: Array<[string, () => Promise<any> | void]> = [
    ['componentPreview.openPreview', () => previewManager?.showPreview()],
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

  context.subscriptions.push({
    dispose: () => previewManager?.dispose(),
  });
}

export function deactivate() {
  previewManager?.dispose();
  previewManager = null;
}
