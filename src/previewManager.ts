import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PreviewViteServer } from './server/viteServer';
import { scanComponents, ScannedComponent } from './parser/astScanner';
import { PreviewCodeLensProvider } from './codelens/previewCodeLensProvider';
import {
  resolveDebugBrowserType,
  detectInstalledBrowser,
  buildComponentDebugConfig,
  isIntegratedBrowserSupported,
  showUnsupportedVersionToast,
  DebugBrowserType,
} from './debug/debugConfigProvider';

export class PreviewManager {
  private isPreviewActive: boolean = false;
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
  public codeLensProvider: PreviewCodeLensProvider;
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.outputChannel = vscode.window.createOutputChannel('Component Preview');
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('componentPreview');
    this.disposables.push(this.diagnosticCollection);

    this.codeLensProvider = new PreviewCodeLensProvider({
      isComponentLocked: (filePath, compName) => this.isComponentLocked(filePath, compName),
      getActiveComponent: () => this.getActiveComponent(),
    });

    const config = vscode.workspace.getConfiguration('componentPreview');
    const port = config.get<number>('port', 4545);
    this.viteServer = new PreviewViteServer(context.extensionPath, port);

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'componentPreview.stopServer';
    this.disposables.push(this.statusBarItem);
    this.updateServerRunningContext(false);

    vscode.window.onDidChangeActiveColorTheme(
      (theme) => this.handleColorThemeChange(theme),
      null,
      this.disposables
    );

    this.viteServer.onLockToggled = (locked?: boolean) => {
      this.toggleLock(locked);
    };

    this.viteServer.onStopRequested = () => {
      this.stopServer();
    };

    this.viteServer.onStartDebugRequested = async (compName) => {
      await this.startDebugSession(undefined, compName);
    };

    this.viteServer.onOpenDevToolsRequested = async () => {
      await this.openWebviewDeveloperTools();
    };

    this.viteServer.onSwitchComponentRequested = (compName) => {
      this.switchComponent(compName);
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
      this.reportRuntimeDiagnostic(err.message, err.source, err.location);
    };

    this.viteServer.onRuntimeErrorUpdate = (data) => {
      if (data.location) {
        this.outputChannel.appendLine(
          `[Runtime Error Exact Location] ${data.location.fileName}:${data.location.line}:${data.location.column}`
        );
        this.reportRuntimeDiagnostic(undefined, undefined, data.location);
      }
    };

    this.viteServer.onConsoleLog = (log) => {
      const levelTag = log.level ? `[${log.level.toUpperCase()}]` : '[LOG]';
      this.outputChannel.appendLine(`[Console ${log.timestamp || ''}] ${levelTag} ${log.text}`);
    };

    this.viteServer.onCopyToClipboard = async (text: string) => {
      try {
        await vscode.env.clipboard.writeText(text);
      } catch (err) {
        this.outputChannel.appendLine(`[Preview] Failed to copy to clipboard: ${err}`);
      }
    };

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

    if (editor && editor.document.uri.scheme === 'file') {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      workspaceRoot = folder ? folder.uri.fsPath : path.dirname(editor.document.fileName);
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
      vscode.window.showErrorMessage('No workspace folder open. Open a project folder to preview components.');
      return null;
    }

    try {
      this.outputChannel.appendLine(`[Preview] Starting background Vite server in ${workspaceRoot}...`);
      const port = await this.viteServer.start(workspaceRoot);
      this.outputChannel.appendLine(`[Preview] Vite dev server running at ${this.viteServer.getPreviewUrl()}`);

      this.statusBarItem.text = `$(play) Preview :${port}`;
      this.statusBarItem.tooltip = `React Component Preview server running on port ${port}. Click to stop.`;
      this.statusBarItem.show();
      this.updateServerRunningContext(true);

      return port;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Preview Error] Failed to start Vite dev server: ${msg}`);
      vscode.window.showErrorMessage(`Failed to start component preview server: ${msg}`);
      this.statusBarItem.hide();
      this.updateServerRunningContext(false);
      return null;
    }
  }

  public async stopServer(): Promise<void> {
    if (!this.viteServer.isRunning()) {
      this.outputChannel.appendLine('[Preview] Server is not running.');
      return;
    }

    try {
      await this.viteServer.stop();
      this.isPreviewActive = false;
      this.diagnosticCollection.clear();
      this.codeLensProvider.refresh();
      this.outputChannel.appendLine('[Preview] Vite dev server stopped.');
      this.statusBarItem.hide();
      this.updateServerRunningContext(false);
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
      if (this.isPreviewActive && vscode.window.activeTextEditor) {
        await this.updatePreviewForEditor(vscode.window.activeTextEditor);
      }
      vscode.window.showInformationMessage(`Component preview server restarted on port ${port}.`);
    }
  }

  public async startServerInteractive(): Promise<void> {
    if (this.viteServer.isRunning()) {
      vscode.window.showInformationMessage(`Component preview server is already running on port ${this.viteServer.getPort()}.`);
      return;
    }
    const port = await this.startServer();
    if (port) {
      vscode.window.showInformationMessage(`Component preview server started on port ${port}.`);
    }
  }

  public async openIntegratedBrowserTab(url: string, viewColumn = vscode.ViewColumn.Beside): Promise<boolean> {
    const uri = vscode.Uri.parse(url);

    // 1. Try VS Code 1.112+ native integrated browser command
    try {
      await vscode.commands.executeCommand('workbench.action.browser.open', url);
      return true;
    } catch {}

    try {
      await vscode.commands.executeCommand('workbench.action.browser.open', uri);
      return true;
    } catch {}

    // 2. Try Simple Browser
    try {
      await vscode.commands.executeCommand('simpleBrowser.show', uri, { viewColumn });
      return true;
    } catch {}

    try {
      await vscode.commands.executeCommand('simpleBrowser.show', url, { viewColumn });
      return true;
    } catch {}

    return false;
  }

  public async showPreview(editor?: vscode.TextEditor): Promise<void> {
    if (!isIntegratedBrowserSupported()) {
      showUnsupportedVersionToast();
      return;
    }

    const targetEditor = editor || vscode.window.activeTextEditor;
    if (!targetEditor) {
      vscode.window.showInformationMessage('Open a JSX or TSX file to preview components.');
      return;
    }

    const document = targetEditor.document;
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      vscode.window.showInformationMessage('Component Preview only supports JSX and TSX files.');
      return;
    }

    this.outputChannel.appendLine(`[Preview] Opening Integrated Browser preview for ${document.fileName}`);

    const port = await this.startServer(targetEditor);
    if (!port) {
      return;
    }

    this.isPreviewActive = true;
    await this.updatePreviewForEditor(targetEditor);

    const previewUrl = this.viteServer.getPreviewUrl();
    await this.openIntegratedBrowserTab(previewUrl);

    const config = vscode.workspace.getConfiguration('componentPreview');
    const lockGroup = config.get<boolean>('lockEditorGroup', true);
    if (lockGroup) {
      try {
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      } catch {}
    }
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
        this.updatePreviewForEditor(vscode.window.activeTextEditor);
      }
    }

    this.updateLockStateInUI();
  }

  private updateLockStateInUI() {
    vscode.commands.executeCommand('setContext', 'componentPreview.isLocked', this.isLocked);
    this.codeLensProvider?.refresh();

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
      await this.updatePreviewForEditor(vscode.window.activeTextEditor);
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
    vscode.env.openExternal(vscode.Uri.parse(url));
  }

  public isComponentLocked(filePath: string, compName: string): boolean {
    if (!this.isLocked) return false;
    return this.lockedFilePath === filePath && this.lockedComponentName === compName;
  }

  public getActiveComponent(): { filePath: string; compName: string } | null {
    if (this.currentComponent && this.currentFilePath) {
      return {
        filePath: this.currentFilePath,
        compName: this.currentComponent.name,
      };
    }
    return null;
  }

  /**
   * Updates state in the background Vite server to render target component.
   * Vite HMR hot-swaps the component in the Integrated Browser tab in real-time.
   */
  private async renderTargetComponent(
    document: vscode.TextDocument,
    target: ScannedComponent,
    allComponents?: string[]
  ): Promise<void> {
    this.outputChannel.appendLine(`[Preview] Active component: <${target.name} /> (${target.meta.variants.length} variant(s))`);

    this.currentFilePath = document.fileName;
    this.currentComponent = target;

    // Clear diagnostics on new render
    this.diagnosticCollection.delete(document.uri);
    this.codeLensProvider?.refresh();

    this.viteServer.updateState({
      currentFile: document.fileName,
      currentComponentName: target.name,
      componentStartLine: target.nameLine || target.startLine,
      commentStartLine: target.commentStartLine,
      meta: target.meta,
      allComponents,
      isLocked: this.isLocked,
    });
  }

  private async updatePreviewForEditor(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      return;
    }

    const cursorLine = editor.selection.active.line + 1;
    const scanResult = scanComponents(document.getText(), document.fileName, cursorLine);

    if (!scanResult.targetComponent) {
      this.outputChannel.appendLine(`[Preview] No React component found in ${document.fileName}`);
      return;
    }

    const allComponentNames = scanResult.components.map((c) => c.name);
    await this.renderTargetComponent(document, scanResult.targetComponent, allComponentNames);
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (this.isLocked || this.isNavigatingToSource || !editor || !this.isPreviewActive) {
      return;
    }
    this.updatePreviewForEditor(editor);
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    if (!this.isPreviewActive || this.isLocked) return;
    const editor = event.textEditor;

    // Check if cursor moved to a different component in the same file
    if (this.currentFilePath === editor.document.fileName) {
      const cursorLine = editor.selection.active.line + 1;
      const scanResult = scanComponents(editor.document.getText(), editor.document.fileName, cursorLine);
      if (scanResult.targetComponent && scanResult.targetComponent.name !== this.currentComponent?.name) {
        const allComponentNames = scanResult.components.map((c) => c.name);
        this.renderTargetComponent(editor.document, scanResult.targetComponent, allComponentNames);
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

    // Clear previous diagnostics for this document on save
    this.diagnosticCollection.delete(document.uri);
    this.codeLensProvider.refresh();

    const activeEditor = vscode.window.activeTextEditor;

    if (!this.isPreviewActive) {
      const config = vscode.workspace.getConfiguration('componentPreview');
      const autoOpen = config.get<boolean>('autoOpenOnSave', false);
      if (autoOpen && activeEditor && activeEditor.document === document) {
        await this.showPreview(activeEditor);
      }
      return;
    }

    // Trigger update on save via Vite Hot Code Replacement
    if (activeEditor && activeEditor.document === document) {
      await this.updatePreviewForEditor(activeEditor);
    }
  }

  private resolveSourcePath(p: string): string | null {
    if (!p) return null;

    if (p.startsWith('/@fs/')) {
      p = p.substring(5);
    }

    if (p.startsWith('file:///')) {
      p = vscode.Uri.parse(p).fsPath;
    }

    p = p.replace(/\?.*$/, '');

    if (path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isFile()) {
      return path.resolve(p);
    }

    const cleanRel = p.replace(/^[/\\]+/, '');

    if (this.currentFilePath) {
      const currentDir = path.dirname(this.currentFilePath);
      const relToCurrent = path.resolve(currentDir, cleanRel);
      if (fs.existsSync(relToCurrent) && fs.statSync(relToCurrent).isFile()) {
        return relToCurrent;
      }
    }

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

    if (this.currentFilePath && path.basename(this.currentFilePath) === path.basename(p)) {
      return this.currentFilePath;
    }

    return null;
  }

  /**
   * Navigates to a specific file, line, and column in the active VS Code window.
   */
  public async navigateToSource(
    filePath: string,
    line?: number,
    column?: number,
    originalResolved?: boolean
  ): Promise<void> {
    try {
      const now = Date.now();
      const targetKey = `${filePath}:${line || 1}:${column || 1}`;
      if (now - this.lastNavigateTime < 400 && this.lastNavigateTarget === targetKey) {
        return;
      }
      this.lastNavigateTime = now;
      this.lastNavigateTarget = targetKey;

      let targetLineNum = line;
      let targetColNum = column;

      if (!originalResolved && line && line > 0 && this.viteServer.isRunning()) {
        const resolved = await this.viteServer.resolveOriginalPosition(
          filePath,
          line,
          column || 1
        );
        targetLineNum = resolved.line;
        targetColNum = resolved.column;
        if (resolved.filePath) {
          filePath = resolved.filePath;
        }
      }

      let targetPath = this.resolveSourcePath(filePath);

      if (!targetPath && this.currentFilePath && fs.existsSync(this.currentFilePath)) {
        targetPath = this.currentFilePath;
      }

      if (!targetPath) {
        throw new Error(`File not found: ${filePath}`);
      }

      this.isNavigatingToSource = true;

      const uri = vscode.Uri.file(targetPath);
      const doc = await vscode.workspace.openTextDocument(uri);

      const targetLine = Math.max((targetLineNum || this.currentComponent?.startLine || 1) - 1, 0);
      const targetCol = Math.max((targetColNum || 1) - 1, 0);
      const pos = new vscode.Position(targetLine, targetCol);
      const selection = new vscode.Range(pos, pos);

      let targetColumn: vscode.ViewColumn = vscode.ViewColumn.One;
      const existingEditor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === doc.uri.fsPath
      );

      if (existingEditor && existingEditor.viewColumn) {
        targetColumn = existingEditor.viewColumn;
      } else {
        const activeCol = vscode.window.activeTextEditor?.viewColumn;
        targetColumn = activeCol || vscode.ViewColumn.One;
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
      this.outputChannel.appendLine(`[Preview Error] Could not navigate to source ${filePath}: ${msg}`);
      vscode.window.showWarningMessage(`Could not navigate to source file: ${filePath}`);
    } finally {
      setTimeout(() => {
        this.isNavigatingToSource = false;
      }, 500);
    }
  }

  public reportRuntimeDiagnostic(
    message?: string,
    source?: string,
    location?: { filePath: string; line: number; column: number; fileName?: string }
  ): void {
    if (!location?.filePath) return;
    const targetPath = this.resolveSourcePath(location.filePath);
    if (!targetPath) return;

    const targetUri = vscode.Uri.file(targetPath);
    const lineNum = Math.max((location.line || 1) - 1, 0);
    const colNum = Math.max((location.column || 1) - 1, 0);

    let endCol = colNum + 15;
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === targetUri.fsPath);
    if (openDoc && lineNum < openDoc.lineCount) {
      const lineText = openDoc.lineAt(lineNum).text;
      endCol = Math.max(lineText.length, colNum + 1);
    }

    const range = new vscode.Range(lineNum, colNum, lineNum, endCol);
    const diagMsg = message ? `[Component Preview] ${message}` : '[Component Preview] Runtime Error';
    const diag = new vscode.Diagnostic(range, diagMsg, vscode.DiagnosticSeverity.Error);
    diag.source = 'Component Preview';
    if (source) {
      diag.code = source;
    }

    this.diagnosticCollection.set(targetUri, [diag]);
  }

  public async switchComponent(componentName: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName === this.currentFilePath) {
      const scanResult = scanComponents(editor.document.getText(), editor.document.fileName);
      const target = scanResult.components.find((c) => c.name === componentName);
      if (target) {
        const allComponentNames = scanResult.components.map((c) => c.name);
        await this.renderTargetComponent(editor.document, target, allComponentNames);
      }
    }
  }

  public async showComponent(documentUri?: vscode.Uri, componentName?: string, line?: number): Promise<void> {
    let editor: vscode.TextEditor | undefined;
    if (documentUri) {
      const doc = await vscode.workspace.openTextDocument(documentUri);
      editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
    } else {
      editor = vscode.window.activeTextEditor;
    }

    if (!editor) return;

    if (line !== undefined && line > 0) {
      const targetLine = Math.max(line - 1, 0);
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    const port = await this.startServer(editor);
    if (!port) return;

    if (componentName) {
      const scanResult = scanComponents(editor.document.getText(), editor.document.fileName);
      const target = scanResult.components.find((c) => c.name === componentName);
      if (target) {
        if (!this.isPreviewActive) {
          await this.showPreview(editor);
        }
        const allComponentNames = scanResult.components.map((c) => c.name);
        await this.renderTargetComponent(editor.document, target, allComponentNames);
        return;
      }
    }

    await this.showPreview(editor);
  }

  public resolveDebugBrowserType(overridePref?: string): DebugBrowserType {
    const config = vscode.workspace.getConfiguration('componentPreview');
    const pref = overridePref || config.get<string>('debugBrowser', 'integrated');
    return resolveDebugBrowserType(pref);
  }

  public async openWebviewDeveloperTools(): Promise<void> {
    if (!isIntegratedBrowserSupported()) {
      showUnsupportedVersionToast();
      return;
    }

    try {
      this.outputChannel.appendLine('[Preview] Opening Browser Developer Tools...');
      await vscode.commands.executeCommand('workbench.action.browser.toggleDevTools');
    } catch {
      try {
        await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`[Preview Error] Could not open Developer Tools: ${msg}`);
        vscode.window.showWarningMessage('Could not open Developer Tools.');
      }
    }
  }

  public async startDebugSession(
    document?: vscode.TextDocument,
    componentName?: string,
    browserTypeOverride?: DebugBrowserType
  ): Promise<boolean> {
    if (!isIntegratedBrowserSupported()) {
      showUnsupportedVersionToast();
      return false;
    }

    if (!this.viteServer.isRunning()) {
      const port = await this.startServer();
      if (!port) return false;
    }

    const active = this.getActiveComponent();
    const compName = componentName || active?.compName || this.currentComponent?.name || 'Component';
    const filePath = document?.fileName || active?.filePath || this.currentFilePath || '';

    const workspaceFolder = filePath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
      : vscode.workspace.workspaceFolders?.[0];

    const webRoot = workspaceFolder
      ? workspaceFolder.uri.fsPath
      : filePath
      ? path.dirname(filePath)
      : process.cwd();

    const previewUrl = this.viteServer.getPreviewUrl();
    const primaryBrowser = browserTypeOverride || this.resolveDebugBrowserType();
    const fallbackBrowser = primaryBrowser === 'editor-browser'
      ? detectInstalledBrowser()
      : primaryBrowser === 'pwa-chrome' ? 'pwa-msedge' : 'pwa-chrome';

    const debugConfig = buildComponentDebugConfig({
      compName,
      previewUrl,
      webRoot,
      browserType: primaryBrowser,
    });

    this.outputChannel.appendLine(`[Debug] Launching Integrated Browser debugging session for <${compName} /> with ${primaryBrowser}...`);
    this.outputChannel.appendLine(`[Debug] URL: ${previewUrl}`);
    this.outputChannel.appendLine(`[Debug] webRoot: ${webRoot}`);

    try {
      let started = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
      if (!started) {
        this.outputChannel.appendLine(`[Debug] Primary launch with ${primaryBrowser} was not accepted. Trying fallback: ${fallbackBrowser}...`);
        const fallbackConfig = buildComponentDebugConfig({
          compName,
          previewUrl,
          webRoot,
          browserType: fallbackBrowser,
        });
        started = await vscode.debug.startDebugging(workspaceFolder, fallbackConfig);
      }

      if (started) {
        this.isPreviewActive = true;
        this.outputChannel.appendLine(`[Debug] Successfully started debugging <${compName} />.`);
        vscode.window.showInformationMessage(`Debugging <${compName} /> started. Set breakpoints in your component code.`);
      } else {
        this.outputChannel.appendLine(`[Debug] Debugger could not be started.`);
        vscode.window.showWarningMessage(
          `Could not start integrated browser debugger. You can inspect elements via "Component Preview: Open Developer Tools".`
        );
      }
      return started;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Debug Error] Failed to launch debug session: ${msg}`);
      try {
        const fallbackConfig = buildComponentDebugConfig({
          compName,
          previewUrl,
          webRoot,
          browserType: fallbackBrowser,
        });
        const fallbackStarted = await vscode.debug.startDebugging(workspaceFolder, fallbackConfig);
        if (fallbackStarted) {
          this.isPreviewActive = true;
          this.outputChannel.appendLine(`[Debug] Fallback launch with ${fallbackBrowser} succeeded.`);
          return true;
        }
      } catch {}
      vscode.window.showErrorMessage(`Failed to start debugging: ${msg}`);
      return false;
    }
  }

  public async debugComponent(documentUri?: vscode.Uri, componentName?: string, line?: number): Promise<boolean> {
    if (!isIntegratedBrowserSupported()) {
      showUnsupportedVersionToast();
      return false;
    }

    let editor: vscode.TextEditor | undefined;
    if (documentUri) {
      const doc = await vscode.workspace.openTextDocument(documentUri);
      editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
    } else {
      editor = vscode.window.activeTextEditor;
    }

    if (!editor) {
      vscode.window.showInformationMessage('Open a JSX or TSX file to debug components.');
      return false;
    }

    if (line !== undefined && line > 0) {
      const targetLine = Math.max(line - 1, 0);
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    const port = await this.startServer(editor);
    if (!port) return false;

    let targetCompName = componentName;
    const scanResult = scanComponents(editor.document.getText(), editor.document.fileName, line);
    let target = targetCompName ? scanResult.components.find((c) => c.name === targetCompName) : undefined;
    if (!target) {
      target = scanResult.targetComponent || scanResult.components[0];
      if (target) {
        targetCompName = target.name;
      }
    }

    if (target) {
      const allComponentNames = scanResult.components.map((c) => c.name);
      await this.renderTargetComponent(editor.document, target, allComponentNames);
    }

    this.isPreviewActive = true;
    return this.startDebugSession(editor.document, targetCompName);
  }

  public async debugPreview(editor?: vscode.TextEditor): Promise<boolean> {
    if (!isIntegratedBrowserSupported()) {
      showUnsupportedVersionToast();
      return false;
    }

    const targetEditor = editor || vscode.window.activeTextEditor;
    if (!targetEditor) {
      if (this.viteServer.isRunning() && this.currentComponent) {
        return this.startDebugSession(undefined, this.currentComponent.name);
      }
      vscode.window.showInformationMessage('Open a JSX or TSX file to debug components.');
      return false;
    }
    return this.debugComponent(targetEditor.document.uri);
  }

  public getEffectiveThemeKind(theme?: vscode.ColorTheme): 'dark' | 'light' {
    const t = theme || vscode.window.activeColorTheme;
    return t.kind === vscode.ColorThemeKind.Light || t.kind === vscode.ColorThemeKind.HighContrastLight
      ? 'light'
      : 'dark';
  }

  private handleColorThemeChange(theme: vscode.ColorTheme) {
    const themeKind = this.getEffectiveThemeKind(theme);
    this.viteServer.broadcastThemeChange(themeKind);
  }

  public dispose() {
    this.diagnosticCollection.clear();
    this.diagnosticCollection.dispose();
    this.viteServer.stop();
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
