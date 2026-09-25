import * as path from 'path';
import * as fs from 'fs';

export interface AliasConfig {
  find: RegExp | string;
  replacement: string;
}

/**
 * Resolves path aliases from workspace tsconfig.json / jsconfig.json and provides
 * fallbacks for react/react-dom when not present in the workspace node_modules.
 */
export function getWorkspaceAliases(workspaceRoot: string, extensionPath: string): AliasConfig[] {
  const aliases: AliasConfig[] = [];

  // Fallback for React/ReactDOM if workspace does not have them in its node_modules
  const workspaceHasReact = fs.existsSync(path.join(workspaceRoot, 'node_modules', 'react'));
  if (!workspaceHasReact) {
    const extReact = path.join(extensionPath, 'node_modules', 'react');
    const extReactDom = path.join(extensionPath, 'node_modules', 'react-dom');
    if (fs.existsSync(extReact)) {
      aliases.push({ find: 'react', replacement: extReact });
    }
    if (fs.existsSync(extReactDom)) {
      aliases.push({ find: 'react-dom', replacement: extReactDom });
    }
  }

  // Read tsconfig.json or jsconfig.json path mappings from workspace
  for (const configName of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = path.join(workspaceRoot, configName);
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      // Strip comments & trailing commas
      const cleaned = content
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
        .replace(/,\s*([}\]])/g, '$1');
      const parsed = JSON.parse(cleaned);
      const compilerOptions = parsed?.compilerOptions;

      if (compilerOptions?.paths) {
        const baseUrl = compilerOptions.baseUrl
          ? path.resolve(workspaceRoot, compilerOptions.baseUrl)
          : workspaceRoot;

        for (const [key, targets] of Object.entries<string[]>(compilerOptions.paths)) {
          if (!Array.isArray(targets) || targets.length === 0) continue;
          const target = targets[0];

          if (key.endsWith('/*')) {
            const prefix = key.slice(0, -2);
            const targetPrefix = target.endsWith('/*') ? target.slice(0, -2) : target;
            const replacementDir = path.resolve(baseUrl, targetPrefix);
            aliases.push({
              find: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.*)$`),
              replacement: `${replacementDir.replace(/\\/g, '/')}/$1`,
            });
          } else {
            aliases.push({
              find: key,
              replacement: path.resolve(baseUrl, target).replace(/\\/g, '/'),
            });
          }
        }
      }
    } catch {
      // Ignore invalid tsconfig parse errors
    }
    break;
  }

  return aliases;
}
