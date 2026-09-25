import * as vscode from 'vscode';
import { PreviewManager } from './previewManager';

let previewManager: PreviewManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Component Preview] Extension activated');

  previewManager = new PreviewManager(context);

  const openPreviewCmd = vscode.commands.registerCommand(
    'componentPreview.openPreview',
    async () => {
      if (previewManager) {
        await previewManager.showPreview();
      }
    }
  );

  const stopServerCmd = vscode.commands.registerCommand(
    'componentPreview.stopServer',
    async () => {
      if (previewManager) {
        await previewManager.stopServer();
      }
    }
  );

  const startServerCmd = vscode.commands.registerCommand(
    'componentPreview.startServer',
    async () => {
      if (previewManager) {
        if (previewManager.isServerRunning()) {
          vscode.window.showInformationMessage(`Component preview server is already running on port ${previewManager.getServerPort()}.`);
          return;
        }
        const port = await previewManager.startServer();
        if (port) {
          vscode.window.showInformationMessage(`Component preview server started on port ${port}.`);
        }
      }
    }
  );

  const restartServerCmd = vscode.commands.registerCommand(
    'componentPreview.restartServer',
    async () => {
      if (previewManager) {
        await previewManager.restartServer();
      }
    }
  );

  const refreshPreviewCmd = vscode.commands.registerCommand(
    'componentPreview.refreshPreview',
    async () => {
      if (previewManager) {
        await previewManager.refreshPreview();
      }
    }
  );

  const openInBrowserCmd = vscode.commands.registerCommand(
    'componentPreview.openInBrowser',
    async () => {
      if (previewManager) {
        await previewManager.openInExternalBrowser();
      }
    }
  );

  const toggleLockCmd = vscode.commands.registerCommand(
    'componentPreview.toggleLock',
    () => {
      if (previewManager) {
        previewManager.toggleLock();
      }
    }
  );

  context.subscriptions.push(
    openPreviewCmd,
    stopServerCmd,
    startServerCmd,
    restartServerCmd,
    refreshPreviewCmd,
    openInBrowserCmd,
    toggleLockCmd,
    {
      dispose: () => {
        previewManager?.dispose();
      },
    }
  );
}

export function deactivate() {
  if (previewManager) {
    previewManager.dispose();
    previewManager = null;
  }
}
