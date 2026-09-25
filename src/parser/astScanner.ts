import * as path from 'path';
import * as ts from 'typescript';
import { ComponentPreviewMeta, parsePreviewComments } from './commentParser';

export interface ScannedComponent {
  name: string;
  isDefaultExport: boolean;
  isNamedExport: boolean;
  startLine: number;
  endLine: number;
  commentStartLine: number;
  meta: ComponentPreviewMeta;
}

export interface ScanResult {
  filePath: string;
  components: ScannedComponent[];
  targetComponent?: ScannedComponent;
}

function isComponentIdentifier(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Scans a JSX/TSX source file, identifies React components, extracts their leading comments,
 * and parses preview metadata.
 */
export function scanComponents(sourceText: string, filePath: string, cursorLine?: number): ScanResult {
  const isTsx = filePath.endsWith('.tsx');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  );

  const components: ScannedComponent[] = [];

  function getLeadingComments(node: ts.Node): string[] {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) || [];
    return commentRanges.map((range) => fullText.substring(range.pos, range.end));
  }

  function registerComponent(
    name: string,
    node: ts.Node,
    isDefaultExport: boolean,
    isNamedExport: boolean
  ) {
    if (components.some((c) => c.name === name)) {
      return;
    }

    const comments = getLeadingComments(node);
    const meta = parsePreviewComments(comments, name);

    const fullStart = sourceFile.getLineAndCharacterOfPosition(node.getFullStart());
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    components.push({
      name,
      isDefaultExport,
      isNamedExport,
      startLine: start.line + 1,
      endLine: end.line + 1,
      commentStartLine: fullStart.line + 1,
      meta,
    });
  }

  function visit(node: ts.Node) {
    const isExported = (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
    const isDefault = (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;

    // 1. Function Declarations: export function MyComponent(...) {} or export default function(...) {}
    if (ts.isFunctionDeclaration(node)) {
      const name =
        node.name?.text ||
        (isDefault ? path.basename(filePath, path.extname(filePath)) : undefined);

      if (name && isComponentIdentifier(name)) {
        registerComponent(name, node, isDefault, isExported);
      }
    }

    // 2. Variable Statements: export const MyComponent = (...) => {}
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          if (isComponentIdentifier(name)) {
            registerComponent(name, node, isDefault, isExported);
          }
        }
      }
    }

    // 3. Export Assignment: export default MyComponent;
    else if (ts.isExportAssignment(node)) {
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const existing = components.find((c) => c.name === name);
        if (existing) {
          existing.isDefaultExport = true;
        } else if (isComponentIdentifier(name)) {
          registerComponent(name, node, true, true);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Determine target component based on cursorLine or defaults
  let targetComponent: ScannedComponent | undefined;

  if (cursorLine !== undefined) {
    // Check if cursor is directly inside a component or in its leading comments
    targetComponent = components.find(
      (c) => cursorLine >= c.commentStartLine && cursorLine <= c.endLine
    );
  }

  // Fallbacks: default export -> first exported -> first component
  if (!targetComponent) {
    targetComponent =
      components.find((c) => c.isDefaultExport) ||
      components.find((c) => c.isNamedExport) ||
      components[0];
  }

  return {
    filePath,
    components,
    targetComponent,
  };
}
