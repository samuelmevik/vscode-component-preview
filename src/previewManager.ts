import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
  private isNavigatingToSource: boolean = false;
  private lastNavigateTime: number = 0;
  private lastNavigateTarget: string = '';

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

    this.viteServer.onNavigateRequested = (filePath, line, column) => {
      this.navigateToSource(filePath, line, column);
    };

    this.viteServer.onRuntimeError = (err) => {
      const locStr = err.location ? ` at ${err.location.fileName}:${err.location.line}:${err.location.column}` : '';
      this.outputChannel.appendLine(`[Runtime Error ${err.timestamp || ''}] [${(err.source || 'error').toUpperCase()}] ${err.message}${locStr}`);
      if (err.stack) {
        this.outputChannel.appendLine(err.stack);
      }
    };

    this.viteServer.onConsoleLog = (log) => {
      const levelTag = log.level ? `[${log.level.toUpperCase()}]` : '[LOG]';
      this.outputChannel.appendLine(`[Console ${log.timestamp || ''}] ${levelTag} ${log.text}`);
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
        } else if (message.type === 'RUNTIME_ERROR') {
          const { message: errMsg, source, location, stack, timestamp } = message.payload || {};
          const locStr = location ? ` at ${location.fileName}:${location.line}:${location.column}` : '';
          this.outputChannel.appendLine(`[Runtime Error ${timestamp || ''}] [${(source || 'error').toUpperCase()}] ${errMsg}${locStr}`);
          if (stack) {
            this.outputChannel.appendLine(stack);
          }
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
        } else if (message.type === 'NAVIGATE_TO_SOURCE') {
          const { filePath, line, column } = message.payload || {};
          if (filePath) {
            await this.navigateToSource(filePath, line, column);
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
      this.panel.reveal(this.panel.viewColumn || vscode.ViewColumn.Beside, true);
      if (this.isLocked && this.lockedFilePath && this.lockedFilePath !== document.fileName) {
        this.toggleLock(false);
      }
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
      componentStartLine: target.startLine,
      commentStartLine: target.commentStartLine,
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
        const cacheBustedUrl = `${externalUri.toString()}?t=${Date.now()}`;
        this.panel.webview.html = getWebviewContent(cacheBustedUrl, target.name);
      } else {
        this.panel.webview.postMessage({
          type: 'SYNC_PREVIEW',
          payload: {
            currentFilePath: document.fileName,
            componentName: target.name,
            componentStartLine: target.startLine,
            commentStartLine: target.commentStartLine,
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
        const fileName = path.basename(document.fileName);
        const escapedPath = JSON.stringify(document.fileName.replace(/\\/g, '/'));
        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #1e1e1e; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; box-sizing: border-box; padding: 24px; text-align: center; }
    .card { background: #252526; border: 1px solid #3c3c3c; border-radius: 8px; padding: 28px 32px; max-width: 440px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
    h3 { margin: 0 0 10px 0; color: #f14c4c; font-size: 15px; }
    p { margin: 0 0 20px 0; font-size: 13px; color: #999; line-height: 1.5; }
    button { background: #0e639c; color: white; border: none; padding: 8px 18px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; transition: background 0.15s ease; }
    button:hover { background: #1177bb; }
  </style>
</head>
<body>
  <div class="card">
    <h3>No React Component Detected</h3>
    <p>Could not detect an exported React component in <strong>${fileName}</strong>. Check for syntax errors or export statements.</p>
    <button onclick="vscode.postMessage({ type: 'NAVIGATE_TO_SOURCE', payload: { filePath: ${escapedPath}, line: 1 } })">
      Open ${fileName} in Editor
    </button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
  </script>
</body>
</html>`;
      }
      return;
    }

    const allComponentNames = scanResult.components.map((c) => c.name);
    await this.renderTargetComponent(document, scanResult.targetComponent, reloadWebview, allComponentNames);
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (this.isLocked || this.isNavigatingToSource || !editor || !this.panel) {
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

  private handleDocumentChange(_event: vscode.TextDocumentChangeEvent) {
    // Live updates occur strictly on save (onSave) via Vite Hot Code Replacement
  }

  private async handleDocumentSave(document: vscode.TextDocument) {
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;

    if (!this.panel) {
      const config = vscode.workspace.getConfiguration('componentPreview');
      const autoOpen = config.get<boolean>('autoOpenOnSave', false);
      if (autoOpen && activeEditor && activeEditor.document === document) {
        await this.showPreview(activeEditor);
      }
      return;
    }

    // When preview panel is open, trigger hot code replacement on save without full webview reload
    if (this.isLocked) {
      if (document.fileName === this.lockedFilePath && this.lockedComponentName) {
        const scanResult = scanComponents(document.getText(), document.fileName);
        const lockedComp = scanResult.components.find((c) => c.name === this.lockedComponentName);
        if (lockedComp) {
          const allComponentNames = scanResult.components.map((c) => c.name);
          await this.renderTargetComponent(document, lockedComp, false, allComponentNames);
        }
      }
      return;
    }

    if (this.currentFilePath === document.fileName || (activeEditor && activeEditor.document === document)) {
      if (activeEditor && activeEditor.document === document) {
        await this.updatePreviewForEditor(activeEditor, false);
      } else {
        const scanResult = scanComponents(document.getText(), document.fileName);
        if (scanResult.targetComponent) {
          const allComponentNames = scanResult.components.map((c) => c.name);
          await this.renderTargetComponent(document, scanResult.targetComponent, false, allComponentNames);
        }
      }
    }
  }

  /**
   * Resolves a source file path from various formats (Vite /@fs/, URL encodings, Windows drive
   * prefixes, workspace-relative or current-file-relative paths) to an absolute path on disk.
   */
  public resolveSourcePath(rawFilePath: string): string | null {
    if (!rawFilePath) return this.currentFilePath;

    let p = rawFilePath.trim();
    // Strip query string (?t=...) and hash (#...)
    p = p.split('?')[0].split('#')[0];
    try {
      p = decodeURIComponent(p);
    } catch {}

    // Strip Vite prefixes: /@fs/, http://..., https://..., vscode-webview://...
    p = p.replace(/^https?:\/\/[^/]+\/@fs\//i, '');
    p = p.replace(/^\/@fs\//i, '');
    p = p.replace(/^https?:\/\/[^/]+\//i, '');
    p = p.replace(/^[a-z\-]+:\/\/[^/]+\//i, '');

    // Normalize slashes before Windows drive letter: /C:/ -> C:/ or ///C:/ -> C:/
    p = p.replace(/^[/\\]+([a-zA-Z]:[/\\])/, '$1');
    p = p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toUpperCase()}:`);

    // If it's a direct absolute or existing file that exists on disk
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return path.resolve(p);
    }

    // Try stripping leading slashes for relative resolution
    const cleanRel = p.replace(/^[/\\]+/, '');

    // Check relative to currentFilePath directory if available
    if (this.currentFilePath) {
      const currentDir = path.dirname(this.currentFilePath);
      const relToCurrent = path.resolve(currentDir, cleanRel);
      if (fs.existsSync(relToCurrent) && fs.statSync(relToCurrent).isFile()) {
        return relToCurrent;
      }
    }

    // Check relative to all workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    for (const folder of workspaceFolders) {
      const folderPath = folder.uri.fsPath;
      const candidate1 = path.resolve(folderPath, cleanRel);
      if (fs.existsSync(candidate1) && fs.statSync(candidate1).isFile()) {
        return candidate1;
      }
      const candidate2 = path.resolve(folderPath, p);
      if (fs.existsSync(candidate2) && fs.statSync(candidate2).isFile()) {
        return candidate2;
      }
    }

    // Check if filename matches currentFilePath basename
    if (this.currentFilePath && path.basename(this.currentFilePath) === path.basename(p)) {
      return this.currentFilePath;
    }

    return null;
  }

  /**
   * Navigates to a specific file, line, and column in the active VS Code window,
   * placing the cursor directly on the throwing function or component.
   */
  public async navigateToSource(filePath: string, line: number = 1, column: number = 1): Promise<void> {
    const now = Date.now();
    const navKey = `${filePath}:${line}:${column}`;
    if (navKey === this.lastNavigateTarget && now - this.lastNavigateTime < 300) {
      return; // Deduplicate rapid simultaneous calls from postMessage + fetch
    }
    this.lastNavigateTime = now;
    this.lastNavigateTarget = navKey;

    try {
      let targetPath = this.resolveSourcePath(filePath);

      if (!targetPath) {
        // Fallback: search workspace for matching filename
        const cleanName = path.basename(filePath.replace(/^[/\\]+/, '').split('?')[0].split('#')[0]);
        if (cleanName) {
          const found = await vscode.workspace.findFiles(`**/${cleanName}`, '**/node_modules/**', 1);
          if (found.length > 0) {
            targetPath = found[0].fsPath;
          }
        }
      }

      // Ultimate fallback: open current component file
      if (!targetPath && this.currentFilePath && fs.existsSync(this.currentFilePath)) {
        targetPath = this.currentFilePath;
      }

      if (!targetPath) {
        throw new Error(`File not found: ${filePath}`);
      }

      this.isNavigatingToSource = true;

      const uri = vscode.Uri.file(targetPath);
      const doc = await vscode.workspace.openTextDocument(uri);

      const targetLine = Math.max((line || this.currentComponent?.startLine || 1) - 1, 0);
      const targetCol = Math.max((column || 1) - 1, 0);
      const pos = new vscode.Position(targetLine, targetCol);
      const selection = new vscode.Range(pos, pos);

      // Determine the best view column:
      // 1. If this document is already open in any visible text editor, reuse its column
      let targetColumn: vscode.ViewColumn = vscode.ViewColumn.One;
      const existingEditor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === doc.uri.fsPath
      );

      if (existingEditor && existingEditor.viewColumn) {
        targetColumn = existingEditor.viewColumn;
      } else if (this.panel && this.panel.viewColumn === vscode.ViewColumn.One) {
        targetColumn = vscode.ViewColumn.Beside;
      } else {
        const activeCol = vscode.window.activeTextEditor?.viewColumn;
        if (activeCol && activeCol !== this.panel?.viewColumn) {
          targetColumn = activeCol;
        } else {
          targetColumn = vscode.ViewColumn.One;
        }
      }

      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: targetColumn,
        selection,
        preserveFocus: false,
      });

      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      this.outputChannel.appendLine(`[Preview] Navigated to source at ${targetPath}:${targetLine + 1}:${targetCol + 1}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Preview Error] Failed to navigate to source ${filePath}:${line} - ${msg}`);
      vscode.window.showWarningMessage(`Could not open source file: ${filePath}`);
    } finally {
      setTimeout(() => {
        this.isNavigatingToSource = false;
      }, 500);
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
