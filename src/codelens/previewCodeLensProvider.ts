import * as vscode from 'vscode';
import { scanComponents } from '../parser/astScanner';

export interface CodeLensPreviewStateProvider {
  isComponentLocked: (filePath: string, compName: string) => boolean;
  getActiveComponent: () => { filePath: string; compName: string } | null;
}

export class PreviewCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private stateProvider: CodeLensPreviewStateProvider;

  constructor(stateProvider: CodeLensPreviewStateProvider) {
    this.stateProvider = stateProvider;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('componentPreview');
    if (!config.get<boolean>('enableCodeLens', true)) {
      return [];
    }

    if (!document.fileName.endsWith('.tsx') && !document.fileName.endsWith('.jsx')) {
      return [];
    }

    try {
      const scanResult = scanComponents(document.getText(), document.fileName);
      const codeLenses: vscode.CodeLens[] = [];

      for (const comp of scanResult.components) {
        // Position CodeLens directly on the component's name definition line!
        // Right next to the component name, NOT up at the start of any comment blocks.
        const targetLine = Math.max((comp.nameLine || comp.startLine) - 1, 0);
        const targetCol = Math.max((comp.nameColumn || 1) - 1, 0);
        const range = new vscode.Range(targetLine, targetCol, targetLine, targetCol + comp.name.length);

        const isLocked = this.stateProvider.isComponentLocked(document.fileName, comp.name);
        const active = this.stateProvider.getActiveComponent();
        const isActive = active?.filePath === document.fileName && active?.compName === comp.name;

        // 1. Primary Action: Open Preview for this component
        const icon = isActive ? '$(eye)' : '$(play)';
        const label = isActive ? `Previewing <${comp.name} />` : `Preview <${comp.name} />`;
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `${icon} ${label}`,
            tooltip: `Open live component preview for <${comp.name} />`,
            command: 'componentPreview.openComponent',
            arguments: [document.uri, comp.name, comp.nameLine || comp.startLine],
          })
        );

        // 2. Variants Information: Show variant count and names
        if (comp.meta.variants.length > 1) {
          const count = comp.meta.variants.length;
          const names = comp.meta.variants.map((v) => v.name).join(', ');
          const previewNames = names.length > 30 ? names.slice(0, 30) + '…' : names;
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `$(layers) ${count} Variants (${previewNames})`,
              tooltip: `Defined scenario variants: ${names}`,
              command: 'componentPreview.openComponent',
              arguments: [document.uri, comp.name, comp.nameLine || comp.startLine],
            })
          );
        } else if (comp.meta.variants.length === 1 && comp.meta.variants[0]?.name && comp.meta.variants[0].name !== 'Default') {
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `$(layers) Variant: ${comp.meta.variants[0].name}`,
              tooltip: `Scenario variant: ${comp.meta.variants[0].name}`,
              command: 'componentPreview.openComponent',
              arguments: [document.uri, comp.name, comp.nameLine || comp.startLine],
            })
          );
        }

        // 3. Lock State Indicator (if locked)
        if (isLocked) {
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: '$(lock) Locked (Click to Unlock)',
              tooltip: 'Click to unlock preview and resume auto-tracking active editor',
              command: 'componentPreview.toggleLock',
            })
          );
        }
      }

      return codeLenses;
    } catch {
      return [];
    }
  }
}
