import * as YAML from 'yaml';

export interface PreviewVariant {
  name: string;
  props?: Record<string, any>;
  store?: Record<string, any>;
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
      const yamlContent = match[2]?.trim() || '';

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
          variants.push({
            name: variantName,
            props: parsed.props || parsed.props === null ? parsed.props : {},
            store: parsed.store || parsed.state || {},
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
  }

  return {
    componentName,
    variants
  };
}
