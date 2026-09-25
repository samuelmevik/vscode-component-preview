import * as YAML from 'yaml';

export interface PreviewVariant {
  name: string;
  props?: Record<string, any>;
  store?: Record<string, any>;
  storePath?: string;
  slice?: string;
  viewport?: { width?: number; height?: number };
  rawYaml?: string;
  parseError?: string;
}

export interface ComponentPreviewMeta {
  componentName: string;
  variants: PreviewVariant[];
}

/**
 * Extracts and parses all @preview blocks from a collection of comment strings.
 * Supports:
 *   /* @preview
 *   props:
 *     title: "Hello"
 *   * /
 *
 * And named variants:
 *   /* @preview: Loading State
 *   props:
 *     isLoading: true
 *   * /
 */
function dedent(text: string): string {
  const rawLines = text.split(/\r?\n/);
  while (rawLines.length > 0 && rawLines[0].trim() === '') rawLines.shift();
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();

  if (rawLines.length === 0) return '';

  let minIndent = Infinity;
  for (const line of rawLines) {
    if (line.trim().length > 0) {
      const match = line.match(/^(\s*)/);
      const indent = match ? match[1].length : 0;
      if (indent < minIndent) {
        minIndent = indent;
      }
    }
  }

  if (minIndent === Infinity || minIndent === 0) {
    return rawLines.join('\n');
  }

  return rawLines.map((line) => (line.length >= minIndent ? line.slice(minIndent) : line)).join('\n');
}

export function parsePreviewComments(comments: string[], componentName: string): ComponentPreviewMeta {
  const variants: PreviewVariant[] = [];

  for (const comment of comments) {
    // Clean up comment markers: /* ... */ or // ...
    const cleaned = comment
      .replace(/^\/\*+/, '')
      .replace(/\*+\/$/, '')
      .replace(/^\s*\*\s?/gm, ''); // remove leading asterisks from JSDoc lines

    // Match lines starting with @preview or @preview: <name>
    const previewRegex = /@preview(?::\s*([^\n\r]+))?([\s\S]*)/i;
    const match = cleaned.match(previewRegex);

    if (match) {
      const variantName = match[1]?.trim() || (variants.length === 0 ? 'Default' : `Variant ${variants.length + 1}`);
      const yamlContent = dedent(match[2] || '');

      if (!yamlContent) {
        variants.push({
          name: variantName,
          props: {},
          store: {},
        });
        continue;
      }

      try {
        const parsed = YAML.parse(yamlContent);
        if (typeof parsed === 'object' && parsed !== null) {
          const props = parsed.props && typeof parsed.props === 'object'
            ? { ...parsed.props }
            : (parsed.props === null ? null : {});

          // Support top-level children: in addition to props.children:
          if (parsed.children !== undefined && props && props.children === undefined) {
            props.children = parsed.children;
          }

          const rawStorePath = parsed.storePath || parsed.storeFile;
          const storePath = typeof rawStorePath === 'string' ? rawStorePath.trim() : undefined;

          variants.push({
            name: variantName,
            props: props,
            store: parsed.store || parsed.state || {},
            storePath: storePath,
            slice: parsed.slice,
            viewport: parsed.viewport,
            rawYaml: yamlContent
          });
        } else {
          variants.push({
            name: variantName,
            props: {},
            store: {},
            rawYaml: yamlContent
          });
        }
      } catch (err: any) {
        variants.push({
          name: variantName,
          parseError: `YAML Syntax Error: ${err.message}`,
          rawYaml: yamlContent
        });
      }
    }
  }

  // If no preview comments found, provide a fallback default variant
  if (variants.length === 0) {
    variants.push({
      name: 'Default',
      props: {},
      store: {}
    });
  } else {
    // If a variant doesn't specify storePath, inherit from the first variant that defines it,
    // unless explicitly overridden with 'none' or 'mock'
    const defaultStorePath = variants.find(
      (v) => v.storePath && v.storePath !== 'none' && v.storePath !== 'mock'
    )?.storePath;

    for (const v of variants) {
      if (v.storePath === undefined) {
        if (defaultStorePath) {
          v.storePath = defaultStorePath;
        }
      } else if (v.storePath === 'none' || v.storePath === 'mock') {
        v.storePath = undefined;
      }
    }
  }

  return {
    componentName,
    variants
  };
}
