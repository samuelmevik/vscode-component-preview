import * as vscode from 'vscode';
import * as path from 'path';
import { PreviewViteServer } from './server/viteServer';
import { scanComponents, ScannedComponent } from './parser/astScanner';
import { getWebviewContent, getServerStoppedHtml } from './webviewHtml';

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

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
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

    vscode.workspace.onDidSaveTextDocument(
      (document) => this.handleDocumentSave(document),
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Preview Error] Failed to start Vite server: ${msg}`);
      vscode.window.showErrorMessage(`Failed to start preview server: ${msg}`);
      return null;
    }
  }

  public async startServerInteractive(): Promise<void> {
    if (this.isServerRunning()) {
      vscode.window.showInformationMessage(`Component preview server is already running on port ${this.getServerPort()}.`);
      return;
    }
    const port = await this.startServer();
    if (port) {
      vscode.window.showInformationMessage(`Component preview server started on port ${port}.`);
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
        this.panel.webview.html = getServerStoppedHtml();
      }

      vscode.window.showInformationMessage('Component preview server stopped.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Preview Error] Failed to stop Vite server: ${msg}`);
      vscode.window.showErrorMessage(`Failed to stop preview server: ${msg}`);
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
        } else if (message.type === 'SWITCH_COMPONENT') {
          const targetName = message.payload?.componentName;
          const editor = vscode.window.activeTextEditor;
          if (editor && targetName && editor.document.fileName === this.currentFilePath) {
            const scanResult = scanComponents(editor.document.getText(), editor.document.fileName);
            const target = scanResult.components.find((c) => c.name === targetName);
            if (target) {
              const allComponentNames = scanResult.components.map((c) => c.name);
              await this.renderTargetComponent(editor.document, target, false, allComponentNames);
            }
          }
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
      this.outputChannel.appendLine('[Preview] Unlocked. Resuming active editor tracking.');
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
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Renders the given target component in the preview panel and synchronizes Vite server state.
   */
  private async renderTargetComponent(
    document: vscode.TextDocument,
    target: ScannedComponent,
    reloadWebview: boolean,
    allComponents?: string[]
  ): Promise<void> {
    const fileChanged = this.currentFilePath !== document.fileName;
    const compChanged = this.currentComponent?.name !== target.name;

    this.outputChannel.appendLine(`[Preview] Active component: <${target.name} /> (${target.meta.variants.length} variant(s))`);

    this.currentFilePath = document.fileName;
    this.currentComponent = target;

    this.viteServer.updateState({
      currentFile: document.fileName,
      currentComponentName: target.name,
      meta: target.meta,
      allComponents,
      isLocked: this.isLocked,
    });

    if (this.panel) {
      const lockPrefix = this.isLocked ? '🔒 ' : '';
      this.panel.title = `${lockPrefix}Preview: <${target.name} />`;

      if (reloadWebview || fileChanged || compChanged) {
        const rawPreviewUrl = this.viteServer.getPreviewUrl();
        const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(rawPreviewUrl));
        this.panel.webview.html = getWebviewContent(externalUri.toString(), target.name);
      } else {
        this.panel.webview.postMessage({
          type: 'SYNC_PREVIEW',
          payload: {
            componentName: target.name,
            variants: target.meta.variants,
            allComponents,
            isLocked: this.isLocked,
          },
        });
      }
    }
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
        this.panel.webview.html = '<!DOCTYPE html><html><body style="background:#1e1e1e;color:#888;font-family:sans-serif;padding:24px;text-align:center;">No React component detected in this file.</body></html>';
      }
      return;
    }

    const allComponentNames = scanResult.components.map((c) => c.name);
    await this.renderTargetComponent(document, scanResult.targetComponent, reloadWebview, allComponentNames);
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (this.isLocked || !editor || !this.panel) {
      return;
    }
    this.updatePreviewForEditor(editor, true);
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    if (!this.panel || this.isLocked) return;
    const editor = event.textEditor;

    // Check if cursor moved to a different component in the same file
    if (this.currentFilePath === editor.document.fileName) {
      const cursorLine = editor.selection.active.line + 1;
      const scanResult = scanComponents(editor.document.getText(), editor.document.fileName, cursorLine);
      if (scanResult.targetComponent && scanResult.targetComponent.name !== this.currentComponent?.name) {
        const allComponentNames = scanResult.components.map((c) => c.name);
        this.renderTargetComponent(editor.document, scanResult.targetComponent, false, allComponentNames);
      }
    }
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
    if (!this.panel) return;

    if (this.isLocked) {
      if (event.document.fileName === this.lockedFilePath && this.lockedComponentName) {
        const scanResult = scanComponents(event.document.getText(), event.document.fileName);
        const lockedComp = scanResult.components.find((c) => c.name === this.lockedComponentName);
        if (lockedComp) {
          const allComponentNames = scanResult.components.map((c) => c.name);
          this.renderTargetComponent(event.document, lockedComp, false, allComponentNames);
        }
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

  private async handleDocumentSave(document: vscode.TextDocument) {
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      return;
    }

    const config = vscode.workspace.getConfiguration('componentPreview');
    const autoOpen = config.get<boolean>('autoOpenOnSave', false);
    if (!autoOpen) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!this.panel) {
      if (activeEditor && activeEditor.document === document) {
        await this.showPreview(activeEditor);
      }
    } else {
      if (this.currentFilePath === document.fileName || !this.isLocked) {
        if (activeEditor && activeEditor.document === document) {
          await this.updatePreviewForEditor(activeEditor, true);
        }
      }
    }
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
