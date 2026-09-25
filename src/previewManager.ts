import * as vscode from 'vscode';
import * as path from 'path';
import { PreviewViteServer } from './server/viteServer';
import { scanComponents, ScannedComponent } from './parser/astScanner';

export class PreviewManager {
  private panel: vscode.WebviewPanel | null = null;
  private viteServer: PreviewViteServer;
  private extensionContext: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private currentComponent: ScannedComponent | null = null;
  private currentFilePath: string | null = null;
  private outputChannel: vscode.OutputChannel;
  private isLocked: boolean = false;
  private lockedFilePath: string | null = null;
  private lockedComponentName: string | null = null;

  private statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.outputChannel = vscode.window.createOutputChannel('Component Preview');
    const config = vscode.workspace.getConfiguration('componentPreview');
    const port = config.get<number>('port', 4545);
    this.viteServer = new PreviewViteServer(context.extensionPath, port);

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'componentPreview.stopServer';
    this.disposables.push(this.statusBarItem);
    this.updateServerRunningContext(false);

    this.viteServer.onLockToggled = (locked?: boolean) => {
      this.toggleLock(locked);
    };

    this.viteServer.onStopRequested = () => {
      this.stopServer();
    };

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('componentPreview.port')) {
          const newPort = vscode.workspace.getConfiguration('componentPreview').get<number>('port', 4545);
          this.viteServer.setDefaultPort(newPort);
        }
      },
      null,
      this.disposables
    );

    // Watch for document changes & cursor position changes
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.handleActiveEditorChange(editor),
      null,
      this.disposables
    );

    vscode.window.onDidChangeTextEditorSelection(
      (event) => this.handleSelectionChange(event),
      null,
      this.disposables
    );

    vscode.workspace.onDidChangeTextDocument(
      (event) => this.handleDocumentChange(event),
      null,
      this.disposables
    );
  }

  public isServerRunning(): boolean {
    return this.viteServer.isRunning();
  }

  public getServerPort(): number {
    return this.viteServer.getPort();
  }

  private updateServerRunningContext(running: boolean) {
    vscode.commands.executeCommand('setContext', 'componentPreview.serverRunning', running);
  }

  public async startServer(targetEditor?: vscode.TextEditor): Promise<number | null> {
    const editor = targetEditor || vscode.window.activeTextEditor;
    let workspaceRoot: string;

    if (editor) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(editor.document.fileName);
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
      workspaceRoot = process.cwd();
    }

    try {
      const port = await this.viteServer.start(workspaceRoot);
      this.outputChannel.appendLine(`[Preview] Vite dev server ready on port ${port}`);
      this.statusBarItem.text = `$(server) Preview: ${port}`;
      this.statusBarItem.tooltip = `Component Preview server running on http://127.0.0.1:${port} (Click to stop server)`;
      this.statusBarItem.command = 'componentPreview.stopServer';
      this.statusBarItem.show();
      this.updateServerRunningContext(true);
      return port;
    } catch (err: any) {
      this.outputChannel.appendLine(`[Preview Error] Failed to start Vite server: ${err.message}`);
      vscode.window.showErrorMessage(`Failed to start preview server: ${err.message}`);
      return null;
    }
  }

  public async stopServer(): Promise<void> {
    if (!this.viteServer.isRunning()) {
      vscode.window.showInformationMessage('Component preview server is not currently running.');
      return;
    }

    try {
      await this.viteServer.stop();
      this.outputChannel.appendLine('[Preview] Vite dev server stopped.');
      this.statusBarItem.hide();
      this.updateServerRunningContext(false);

      if (this.panel) {
        this.panel.webview.html = this.getServerStoppedHtml();
      }

      vscode.window.showInformationMessage('Component preview server stopped.');
    } catch (err: any) {
      this.outputChannel.appendLine(`[Preview Error] Failed to stop Vite server: ${err.message}`);
      vscode.window.showErrorMessage(`Failed to stop preview server: ${err.message}`);
    }
  }

  public async restartServer(): Promise<void> {
    this.outputChannel.appendLine('[Preview] Restarting preview server...');
    if (this.viteServer.isRunning()) {
      await this.viteServer.stop();
      this.statusBarItem.hide();
      this.updateServerRunningContext(false);
    }
    const port = await this.startServer();
    if (port) {
      if (this.panel && vscode.window.activeTextEditor) {
        await this.updatePreviewForEditor(vscode.window.activeTextEditor, true);
      }
      vscode.window.showInformationMessage(`Component preview server restarted on port ${port}.`);
    }
  }

  public async showPreview(editor?: vscode.TextEditor): Promise<void> {
    const targetEditor = editor || vscode.window.activeTextEditor;
    if (!targetEditor) {
      vscode.window.showInformationMessage('Open a JSX or TSX file to preview components.');
      return;
    }

    const document = targetEditor.document;
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      vscode.window.showInformationMessage('Component preview only supports .jsx and .tsx files.');
      return;
    }

    this.outputChannel.appendLine(`[Preview] Opening preview for ${document.fileName}`);

    // Ensure server is started
    const port = await this.startServer(targetEditor);
    if (!port) {
      return;
    }

    const isNewPanel = !this.panel;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'reactComponentPreview',
        'Component Preview',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(this.extensionContext.extensionPath)],
        }
      );

      this.panel.onDidDispose(async () => {
        this.panel = null;
        const config = vscode.workspace.getConfiguration('componentPreview');
        const autoStop = config.get<boolean>('stopServerOnClose', false);
        if (autoStop && this.viteServer.isRunning()) {
          await this.stopServer();
        }
      }, null, this.disposables);

      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'TOGGLE_LOCK') {
          this.toggleLock(message.payload?.locked);
        } else if (message.type === 'START_SERVER') {
          await this.showPreview();
        } else if (message.type === 'STOP_SERVER') {
          await this.stopServer();
        } else if (message.type === 'CONSOLE_LOG') {
          const { level, text, timestamp } = message.payload || {};
          const levelTag = level ? `[${level.toUpperCase()}]` : '[LOG]';
          this.outputChannel.appendLine(`[Console ${timestamp || ''}] ${levelTag} ${text}`);
        }
      }, null, this.disposables);
    }

    if (isNewPanel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
      const config = vscode.workspace.getConfiguration('componentPreview');
      const lockGroup = config.get<boolean>('lockEditorGroup', true);
      if (lockGroup) {
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      }
      if (targetEditor) {
        await vscode.window.showTextDocument(targetEditor.document, targetEditor.viewColumn ?? vscode.ViewColumn.One, false);
      }
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    await this.updatePreviewForEditor(targetEditor, true);
  }

  public toggleLock(forceState?: boolean): void {
    const newState = forceState !== undefined ? forceState : !this.isLocked;
    if (this.isLocked === newState && forceState !== undefined) return;

    this.isLocked = newState;

    if (this.isLocked) {
      this.lockedFilePath = this.currentFilePath;
      this.lockedComponentName = this.currentComponent?.name || null;
      this.outputChannel.appendLine(`[Preview] Locked to <${this.lockedComponentName} /> in ${this.lockedFilePath}`);
      vscode.window.showInformationMessage(`Preview locked to <${this.lockedComponentName} />`);
    } else {
      this.outputChannel.appendLine(`[Preview] Unlocked. Resuming active editor tracking.`);
      this.lockedFilePath = null;
      this.lockedComponentName = null;
      vscode.window.showInformationMessage('Preview unlocked');
      if (vscode.window.activeTextEditor) {
        this.updatePreviewForEditor(vscode.window.activeTextEditor, true);
      }
    }

    this.updateLockStateInUI();
  }

  private updateLockStateInUI() {
    vscode.commands.executeCommand('setContext', 'componentPreview.isLocked', this.isLocked);

    if (this.panel && this.currentComponent) {
      const lockPrefix = this.isLocked ? '🔒 ' : '';
      this.panel.title = `${lockPrefix}Preview: <${this.currentComponent.name} />`;

      this.panel.webview.postMessage({
        type: 'SYNC_LOCK',
        payload: {
          locked: this.isLocked,
        },
      });
    }

    const state = this.viteServer.getState();
    if (state) {
      this.viteServer.updateState({
        ...state,
        isLocked: this.isLocked,
      });
    }
  }

  public async refreshPreview(): Promise<void> {
    if (vscode.window.activeTextEditor) {
      await this.updatePreviewForEditor(vscode.window.activeTextEditor, true);
    }
  }

  public async openInExternalBrowser(): Promise<void> {
    if (!this.viteServer.isRunning()) {
      const port = await this.startServer();
      if (!port) {
        return;
      }
    }
    const url = this.viteServer.getPreviewUrl();
    const uri = vscode.Uri.parse(url);
    await vscode.env.openExternal(uri);
  }

  private async updatePreviewForEditor(editor: vscode.TextEditor, reloadWebview = false): Promise<void> {
    const document = editor.document;
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      return;
    }

    const cursorLine = editor.selection.active.line + 1;
    const scanResult = scanComponents(document.getText(), document.fileName, cursorLine);

    if (!scanResult.targetComponent) {
      this.outputChannel.appendLine(`[Preview] No React component found in ${document.fileName}`);
      if (this.panel) {
        this.panel.webview.html = `<!DOCTYPE html><html><body style="background:#1e1e1e;color:#888;font-family:sans-serif;padding:24px;text-align:center;">No React component detected in this file.</body></html>`;
      }
      return;
    }

    const target = scanResult.targetComponent;
    const fileChanged = this.currentFilePath !== document.fileName;
    const compChanged = this.currentComponent?.name !== target.name;

    this.outputChannel.appendLine(`[Preview] Active component: <${target.name} /> (${target.meta.variants.length} variant(s))`);

    this.currentFilePath = document.fileName;
    this.currentComponent = target;

    this.viteServer.updateState({
      currentFile: document.fileName,
      currentComponentName: target.name,
      meta: target.meta,
      isLocked: this.isLocked,
    });

    if (this.panel) {
      const lockPrefix = this.isLocked ? '🔒 ' : '';
      this.panel.title = `${lockPrefix}Preview: <${target.name} />`;

      const rawPreviewUrl = this.viteServer.getPreviewUrl();
      const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(rawPreviewUrl));
      const previewUrl = externalUri.toString();

      if (reloadWebview || fileChanged || compChanged) {
        this.panel.webview.html = this.getWebviewContent(previewUrl, target.name);
      } else {
        // Send state sync to webview harness
        this.panel.webview.postMessage({
          type: 'SYNC_PREVIEW',
          payload: {
            componentName: target.name,
            variants: target.meta.variants,
            isLocked: this.isLocked,
          },
        });
      }
    }
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (this.isLocked) {
      return;
    }
    if (editor && this.panel) {
      this.updatePreviewForEditor(editor, true);
    }
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    if (!this.panel || this.isLocked) return;
    const editor = event.textEditor;
    const cursorLine = editor.selection.active.line + 1;

    // Check if cursor moved to a different component in the same file
    if (this.currentFilePath === editor.document.fileName) {
      const scanResult = scanComponents(editor.document.getText(), editor.document.fileName, cursorLine);
      if (scanResult.targetComponent && scanResult.targetComponent.name !== this.currentComponent?.name) {
        this.updatePreviewForEditor(editor, false);
      }
    }
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
    if (!this.panel) return;
    if (this.isLocked) {
      if (event.document.fileName === this.lockedFilePath && this.lockedComponentName) {
        this.updatePreviewForLockedDocument(event.document);
      }
      return;
    }

    if (event.document.fileName === this.currentFilePath) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === event.document) {
        this.updatePreviewForEditor(editor, false);
      }
    }
  }

  private updatePreviewForLockedDocument(document: vscode.TextDocument) {
    const scanResult = scanComponents(document.getText(), document.fileName);
    const lockedComp = scanResult.components.find((c) => c.name === this.lockedComponentName);
    if (lockedComp) {
      this.currentComponent = lockedComp;
      this.viteServer.updateState({
        currentFile: document.fileName,
        currentComponentName: lockedComp.name,
        meta: lockedComp.meta,
        isLocked: true,
      });

      this.panel?.webview.postMessage({
        type: 'SYNC_PREVIEW',
        payload: {
          componentName: lockedComp.name,
          variants: lockedComp.meta.variants,
          isLocked: true,
        },
      });
    }
  }

  private getWebviewContent(previewUrl: string, componentName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; frame-src * blob: data: http: https:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #1e1e1e;
      position: relative;
    }
    #loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      background: #1e1e1e;
      z-index: 10;
      gap: 8px;
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-top-color: #007acc;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .ext-link {
      margin-top: 10px;
      font-size: 12px;
      color: #007acc;
      text-decoration: none;
    }
    .ext-link:hover {
      text-decoration: underline;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      position: absolute;
      top: 0;
      left: 0;
    }
  </style>
</head>
<body>
  <div id="loading-overlay">
    <div class="spinner"></div>
    <div>Loading preview for &lt;${componentName} /&gt;...</div>
    <a class="ext-link" href="${previewUrl}" target="_blank">Open in External Browser ↗</a>
  </div>
  <iframe 
    id="preview-iframe"
    src="${previewUrl}" 
    onload="document.getElementById('loading-overlay').style.display='none'"
  ></iframe>
  <script>
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('preview-iframe');

    // Forward messages from iframe (Harness) to VS Code extension host
    window.addEventListener('message', (event) => {
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'TOGGLE_LOCK' || event.data.type === 'STOP_SERVER' || event.data.type === 'CONSOLE_LOG') {
          vscode.postMessage(event.data);
        }
      }
    });

    // Forward messages from VS Code extension host to iframe (Harness)
    window.addEventListener('message', (event) => {
      if (iframe && iframe.contentWindow && event.source !== iframe.contentWindow) {
        iframe.contentWindow.postMessage(event.data, '*');
      }
    });
  </script>
</body>
</html>`;
  }

  private getServerStoppedHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #1e1e1e;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-sizing: border-box;
      padding: 24px;
    }
    .card {
      background: #252526;
      border: 1px solid #3c3c3c;
      border-radius: 8px;
      padding: 32px 36px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 360px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    .icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
    }
    p {
      margin: 0 0 20px 0;
      font-size: 13px;
      color: #999999;
      line-height: 1.5;
    }
    .btn-start {
      background-color: #0e639c;
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background-color 0.15s ease;
    }
    .btn-start:hover {
      background-color: #1177bb;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛑</div>
    <h2>Preview Server Stopped</h2>
    <p>The background Vite preview server is currently turned off.</p>
    <button class="btn-start" id="start-btn">▶ Start Preview Server</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('start-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'START_SERVER' });
    });
  </script>
</body>
</html>`;
  }

  public dispose() {
    this.viteServer.stop();
    this.panel?.dispose();
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
