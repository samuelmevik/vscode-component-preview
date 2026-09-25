import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Component, Layers, Lock, Unlock, Power } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { MockReduxProvider, ActionLogItem } from './MockReduxProvider';
import { ActionPanel } from './ActionPanel';
import { subscribeToConsoleLogs } from './consoleInterceptor';
import './harness.scss';

export interface PreviewVariantData {
  name: string;
  props?: Record<string, any>;
  store?: Record<string, any>;
  storePath?: string;
  slice?: string;
  parseError?: string;
}

interface HarnessProps {
  ComponentToRender: React.ComponentType<any>;
  userModule?: Record<string, any>;
  storeModules?: Record<string, any>;
  initialComponentName: string;
  initialVariants: PreviewVariantData[];
  initialIsLocked?: boolean;
}

export const Harness: React.FC<HarnessProps> = ({
  ComponentToRender,
  userModule = {},
  storeModules = {},
  initialComponentName,
  initialVariants,
  initialIsLocked = false,
}) => {
  const [componentName, setComponentName] = useState(initialComponentName);
  const [variants, setVariants] = useState<PreviewVariantData[]>(initialVariants);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [actionLogs, setActionLogs] = useState<ActionLogItem[]>([]);
  const [isLocked, setIsLocked] = useState(initialIsLocked);

  useEffect(() => {
    setIsLocked(initialIsLocked);
  }, [initialIsLocked]);

  // Listen for live updates from VS Code extension host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'SYNC_LOCK') {
        setIsLocked(!!message.payload.locked);
      }

      if (message.type === 'SYNC_PREVIEW') {
        if (message.payload.isLocked !== undefined) {
          setIsLocked(!!message.payload.isLocked);
        }
        if (message.payload.componentName) {
          setComponentName(message.payload.componentName);
        }
        if (message.payload.variants && Array.isArray(message.payload.variants)) {
          setVariants(message.payload.variants);
          setActiveVariantIndex((prev) =>
            prev < message.payload.variants.length ? prev : 0
          );
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleToggleLock = useCallback(() => {
    setIsLocked((prev) => {
      const nextLocked = !prev;
      // Post to parent Webview container
      window.parent.postMessage({ type: 'TOGGLE_LOCK', payload: { locked: nextLocked } }, '*');
      // Post to background dev server as well
      fetch('/__preview_api/toggle_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: nextLocked }),
      }).catch(() => {});
      return nextLocked;
    });
  }, []);

  const handleStopServer = useCallback(() => {
    // Post to parent Webview container
    window.parent.postMessage({ type: 'STOP_SERVER' }, '*');
    // Post to background dev server as well
    fetch('/__preview_api/stop_server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => { });
  }, []);

  const activeVariant = useMemo(() => {
    const raw = variants[activeVariantIndex] || variants[0] || { name: 'Default', props: {}, store: {} };
    let resolvedStore = raw.store;
    if (typeof resolvedStore === 'string' && userModule && resolvedStore in userModule) {
      resolvedStore = userModule[resolvedStore];
    }
    let resolvedProps = raw.props;
    if (typeof resolvedProps === 'string' && userModule && resolvedProps in userModule) {
      resolvedProps = userModule[resolvedProps];
    }
    return {
      ...raw,
      props: resolvedProps,
      store: resolvedStore,
      storePath: raw.storePath,
    };
  }, [variants, activeVariantIndex, userModule]);

  const addActionLog = useCallback((item: ActionLogItem) => {
    setActionLogs((prev) => [item, ...prev.slice(0, 49)]); // keep last 50 actions
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToConsoleLogs((item) => {
      addActionLog(item);
    });
    return unsubscribe;
  }, [addActionLog]);

  const clearActionLogs = useCallback(() => {
    setActionLogs([]);
  }, []);

  // Construct props with auto-mocked callback proxies (e.g. onClick, onChange)
  // and resolve file exports, function expressions, HTML markup, and children
  const preparedProps = useMemo(() => {
    const rawProps = { ...(activeVariant.props || {}) };

    const resolveChildValue = (val: any): any => {
      if (typeof val === 'string') {
        const trimmed = val.trim();

        // 1. Exported component from file (e.g. children: SparkleIcon)
        if (userModule && trimmed in userModule) {
          const fileExport = userModule[trimmed];
          if (typeof fileExport === 'function' && /^[A-Z]/.test(trimmed)) {
            return React.createElement(fileExport);
          }
          return fileExport;
        }

        // 2. HTML markup string (e.g. <span>Save <strong>Now</strong></span>)
        if (/<[a-z][\s\S]*>/i.test(trimmed)) {
          return React.createElement('span', {
            dangerouslySetInnerHTML: { __html: trimmed },
          });
        }

        return val;
      }

      // 3. Array of children
      if (Array.isArray(val)) {
        return val.map((item, idx) => {
          const resolved = resolveChildValue(item);
          if (React.isValidElement(resolved)) {
            return React.cloneElement(resolved, { key: idx });
          }
          return resolved;
        });
      }

      return val;
    };

    // Resolve children if specified (unless it's an arrow function / render prop)
    if (rawProps.children !== undefined) {
      const isRenderProp =
        typeof rawProps.children === 'string' &&
        (/^(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/.test(rawProps.children.trim()) ||
          /^(?:async\s+)?function\s*\(/.test(rawProps.children.trim()));

      if (!isRenderProp) {
        rawProps.children = resolveChildValue(rawProps.children);
      }
    }

    for (const [key, value] of Object.entries(rawProps)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();

        // 1. Direct reference to an exported function, component, or variable in the file
        if (userModule && trimmed in userModule) {
          const fileExport = userModule[trimmed];
          if (typeof fileExport === 'function') {
            // If it's a component (starts with capital) and passed as an icon or element prop
            if (/^[A-Z]/.test(trimmed) && key !== 'Component' && !key.startsWith('on')) {
              rawProps[key] = React.createElement(fileExport);
              continue;
            }

            rawProps[key] = (...args: any[]) => {
              const sanitizedArgs = args.map((arg) => {
                if (arg && typeof arg === 'object' && 'nativeEvent' in arg) {
                  return `[SyntheticEvent ${arg.type}]`;
                }
                return arg;
              });

              addActionLog({
                id: Math.random().toString(36).substring(2, 9),
                source: 'callback',
                name: `${key} -> ${trimmed}()`,
                payload: sanitizedArgs.length === 1 ? sanitizedArgs[0] : sanitizedArgs,
                timestamp: new Date().toLocaleTimeString(),
              });

              return fileExport(...args);
            };
          } else {
            rawProps[key] = fileExport;
          }
          continue;
        }

        // 2. Function expressions or arrow functions (e.g. (e) => handleButtonClick(e), () => alert(1), or render props)
        const isFunction =
          /^(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/.test(trimmed) ||
          /^(?:async\s+)?function\s*\(/.test(trimmed);

        if (isFunction) {
          try {
            // Provide all file exports and console in scope
            const scope = { ...(userModule || {}), console };
            const parsedFn = new Function('scope', `with (scope) { return (${trimmed}); }`)(scope);
            if (typeof parsedFn === 'function') {
              rawProps[key] = (...args: any[]) => {
                const sanitizedArgs = args.map((arg) => {
                  if (arg && typeof arg === 'object' && 'nativeEvent' in arg) {
                    return `[SyntheticEvent ${arg.type}]`;
                  }
                  return arg;
                });

                addActionLog({
                  id: Math.random().toString(36).substring(2, 9),
                  source: 'callback',
                  name: `${key}()`,
                  payload: sanitizedArgs.length === 1 ? sanitizedArgs[0] : sanitizedArgs,
                  timestamp: new Date().toLocaleTimeString(),
                });

                return parsedFn(...args);
              };
            }
          } catch (e) {
            console.warn(`[Component Preview] Failed to parse function prop "${key}":`, e);
          }
        }
      }
    }

    // Create a proxy that catches any undefined `on*` callbacks requested by the component
    return new Proxy(rawProps, {
      get(target, propKey, receiver) {
        if (typeof propKey === 'string') {
          // If already defined in mock props
          if (propKey in target) {
            const val = Reflect.get(target, propKey, receiver);
            // If the prop is an on* callback, but the value is a string that wasn't resolved to a function, wrap it
            if (/^on[A-Z]/.test(propKey) && typeof val !== 'function') {
              return (...args: any[]) => {
                const sanitizedArgs = args.map((arg) => {
                  if (arg && typeof arg === 'object' && 'nativeEvent' in arg) {
                    return `[SyntheticEvent ${arg.type}]`;
                  }
                  return arg;
                });

                addActionLog({
                  id: Math.random().toString(36).substring(2, 9),
                  source: 'callback',
                  name: `${propKey} ("${val}")()`,
                  payload: sanitizedArgs.length === 1 ? sanitizedArgs[0] : sanitizedArgs,
                  timestamp: new Date().toLocaleTimeString(),
                });
              };
            }
            return val;
          }

          // Auto-mock any prop starting with 'on' followed by a capital letter
          if (/^on[A-Z]/.test(propKey)) {
            return (...args: any[]) => {
              const sanitizedArgs = args.map((arg) => {
                if (arg && typeof arg === 'object' && 'nativeEvent' in arg) {
                  return `[SyntheticEvent ${arg.type}]`;
                }
                return arg;
              });

              addActionLog({
                id: Math.random().toString(36).substring(2, 9),
                source: 'callback',
                name: `${propKey}()`,
                payload: sanitizedArgs.length === 1 ? sanitizedArgs[0] : sanitizedArgs,
                timestamp: new Date().toLocaleTimeString(),
              });
            };
          }
        }
        return Reflect.get(target, propKey, receiver);
      },
    });
  }, [activeVariant.props, userModule, addActionLog]);

  return (
    <div className="preview-container">
      {/* Top Header / Variant Switcher */}
      <header className="preview-nav">
        <div className="preview-comp-info">
          <Component className="comp-icon" size={16} />
          <span className="comp-name">{componentName}</span>
          <span className="comp-type">React Component</span>
          <button
            className={`preview-lock-btn ${isLocked ? 'locked' : 'unlocked'}`}
            onClick={handleToggleLock}
            title={
              isLocked
                ? `Locked to <${componentName} />. Click to unlock dynamic cursor/file tracking.`
                : `Lock preview to <${componentName} /> (keeps this component even if you browse other files).`
            }
          >
            {isLocked ? <Lock size={12} className="lock-icon" /> : <Unlock size={12} className="lock-icon" />}
            <span>{isLocked ? 'Locked' : 'Lock'}</span>
          </button>
          <button
            className="preview-stop-btn"
            onClick={handleStopServer}
            title="Stop preview server"
          >
            <Power size={12} className="power-icon" />
            <span>Stop Server</span>
          </button>
        </div>

        {variants.length > 1 && (
          <div className="variant-tabs">
            {variants.map((v, index) => (
              <button
                key={`${v.name}-${index}`}
                className={`variant-tab ${index === activeVariantIndex ? 'active' : ''}`}
                onClick={() => setActiveVariantIndex(index)}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Main Canvas Area */}
      <main className="preview-canvas-wrapper">
        <ErrorBoundary fallbackKey={`${componentName}-${activeVariantIndex}`}>
          {activeVariant.parseError ? (
            <div className="preview-error-card">
              <div className="preview-error-header">
                <h3>Comment YAML Parsing Error</h3>
              </div>
              <p className="preview-error-message">{activeVariant.parseError}</p>
            </div>
          ) : (() => {
            const activeStorePath = activeVariant.storePath;
            const cleanStorePath = activeStorePath ? activeStorePath.split('#')[0].trim() : undefined;
            const activeStoreModule = cleanStorePath && storeModules ? storeModules[cleanStorePath] : undefined;
            const activeStoreError = activeStoreModule?.__error__;
            const storeExportName = activeStorePath && activeStorePath.includes('#')
              ? activeStorePath.split('#')[1]?.trim()
              : undefined;

            if (activeStoreError) {
              return (
                <div className="preview-error-card">
                  <div className="preview-error-header">
                    <h3>Redux Store Resolution Error</h3>
                  </div>
                  <p className="preview-error-message">{activeStoreError}</p>
                </div>
              );
            }

            return (
              <MockReduxProvider
                storeModule={activeStoreModule}
                exportName={storeExportName}
                initialState={activeVariant.store || {}}
                onActionDispatched={addActionLog}
              >
                <div className="preview-component-host">
                  <ComponentToRender {...preparedProps} />
                </div>
              </MockReduxProvider>
            );
          })()}
        </ErrorBoundary>
      </main>

      {/* Action / Event Inspector Drawer */}
      <ActionPanel logs={actionLogs} onClear={clearActionLogs} />
    </div>
  );
};
