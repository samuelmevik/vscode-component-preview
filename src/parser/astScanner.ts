import * as ts from 'typescript';
import { ComponentPreviewMeta, parsePreviewComments } from './commentParser';

export interface ScannedComponent {
  name: string;
  isDefaultExport: boolean;
  isNamedExport: boolean;
  startLine: number;
  endLine: number;
  meta: ComponentPreviewMeta;
}

export interface ScanResult {
  filePath: string;
  components: ScannedComponent[];
  targetComponent?: ScannedComponent;
}

/**
 * Checks if an identifier name resembles a React component (PascalCase or starts with capital letter).
 */
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
    // Avoid duplicates
    if (components.some((c) => c.name === name)) {
      return;
    }

    const comments = getLeadingComments(node);
    const meta = parsePreviewComments(comments, name);

    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    components.push({
      name,
      isDefaultExport,
      isNamedExport,
      startLine: start.line + 1,
      endLine: end.line + 1,
      meta,
    });
  }

  function visit(node: ts.Node) {
    const isExported = (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
    const isDefault = (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;

    // 1. Function Declarations: export function MyComponent(...) {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      if (isComponentIdentifier(name)) {
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
    // Check if cursor is directly inside a component or right before it (where the comments are)
    targetComponent = components.find(
      (c) => cursorLine >= c.startLine - 5 && cursorLine <= c.endLine
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
