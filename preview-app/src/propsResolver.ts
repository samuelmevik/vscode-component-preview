import React from 'react';
import { ActionLogItem } from './MockReduxProvider';

const IS_FUNCTION_REGEX = /^(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>|^(?:async\s+)?function\s*\(/;
const IS_HTML_REGEX = /<[a-z][\s\S]*>/i;
const IS_CALLBACK_PROP_REGEX = /^on[A-Z]/;

function sanitizeArgs(args: any[]): any {
  const sanitized = args.map((arg) => {
    if (arg && typeof arg === 'object' && 'nativeEvent' in arg) {
      return `[SyntheticEvent ${arg.type}]`;
    }
    return arg;
  });
  return sanitized.length === 1 ? sanitized[0] : sanitized;
}

function resolveChildValue(val: any, userModule: Record<string, any>): any {
  if (typeof val === 'string') {
    const trimmed = val.trim();

    // 1. Exported component from file (e.g. children: SparkleIcon)
    if (trimmed in userModule) {
      const fileExport = userModule[trimmed];
      if (typeof fileExport === 'function' && /^[A-Z]/.test(trimmed)) {
        return React.createElement(fileExport);
      }
      return fileExport;
    }

    // 2. HTML markup string (e.g. <span>Save <strong>Now</strong></span>)
    if (IS_HTML_REGEX.test(trimmed)) {
      return React.createElement('span', {
        dangerouslySetInnerHTML: { __html: trimmed },
      });
    }

    return val;
  }

  // 3. Array of children
  if (Array.isArray(val)) {
    return val.map((item, idx) => {
      const resolved = resolveChildValue(item, userModule);
      if (React.isValidElement(resolved)) {
        return React.cloneElement(resolved, { key: idx });
      }
      return resolved;
    });
  }

  return val;
}

function logCallback(
  propName: string,
  args: any[],
  onActionLog: (item: ActionLogItem) => void,
  suffix = '()'
) {
  onActionLog({
    id: Math.random().toString(36).substring(2, 9),
    source: 'callback',
    name: `${propName}${suffix}`,
    payload: sanitizeArgs(args),
    timestamp: new Date().toLocaleTimeString(),
  });
}

/**
 * Prepares component props:
 * - Resolves children (HTML markup, exported subcomponents, arrays)
 * - Resolves function strings / arrow functions
 * - Injects Proxy to auto-mock unknown on* callback handlers
 */
export function prepareProps(
  rawProps: Record<string, any> = {},
  userModule: Record<string, any> = {},
  onActionLog: (item: ActionLogItem) => void
): Record<string, any> {
  const props = { ...rawProps };

  // Resolve children unless it's a render prop function
  if (props.children !== undefined) {
    const isRenderProp =
      typeof props.children === 'string' &&
      IS_FUNCTION_REGEX.test(props.children.trim());

    if (!isRenderProp) {
      props.children = resolveChildValue(props.children, userModule);
    }
  }

  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();

    // 1. Reference to an exported item from the module
    if (trimmed in userModule) {
      const fileExport = userModule[trimmed];
      if (typeof fileExport === 'function') {
        if (/^[A-Z]/.test(trimmed) && key !== 'Component' && !key.startsWith('on')) {
          props[key] = React.createElement(fileExport);
        } else {
          props[key] = (...args: any[]) => {
            logCallback(key, args, onActionLog, ` -> ${trimmed}()`);
            return fileExport(...args);
          };
        }
      } else {
        props[key] = fileExport;
      }
      continue;
    }

    // 2. Inline function expressions (e.g. (e) => alert(e))
    if (IS_FUNCTION_REGEX.test(trimmed)) {
      try {
        const scope = { ...userModule, console };
        const parsedFn = new Function('scope', `with (scope) { return (${trimmed}); }`)(scope);
        if (typeof parsedFn === 'function') {
          props[key] = (...args: any[]) => {
            logCallback(key, args, onActionLog);
            return parsedFn(...args);
          };
        }
      } catch (e) {
        console.warn(`[Component Preview] Failed to parse function prop "${key}":`, e);
      }
    }
  }

  // Proxy to catch undefined on* callbacks requested by the component
  return new Proxy(props, {
    get(target, propKey, receiver) {
      if (typeof propKey !== 'string') {
        return Reflect.get(target, propKey, receiver);
      }

      if (propKey in target) {
        const val = Reflect.get(target, propKey, receiver);
        if (IS_CALLBACK_PROP_REGEX.test(propKey) && typeof val !== 'function') {
          return (...args: any[]) => {
            logCallback(propKey, args, onActionLog, ` ("${val}")()`);
          };
        }
        return val;
      }

      if (IS_CALLBACK_PROP_REGEX.test(propKey)) {
        return (...args: any[]) => {
          logCallback(propKey, args, onActionLog);
        };
      }

      return Reflect.get(target, propKey, receiver);
    },
  });
}
