import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Component, Layers, Lock, Unlock } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { MockReduxProvider, ActionLogItem } from './MockReduxProvider';
import { ActionPanel } from './ActionPanel';
import { subscribeToConsoleLogs } from './consoleInterceptor';
import './harness.scss';

export interface PreviewVariantData {
  name: string;
  props?: Record<string, any>;
  store?: Record<string, any>;
  slice?: string;
  parseError?: string;
}

interface HarnessProps {
  ComponentToRender: React.ComponentType<any>;
  initialComponentName: string;
  initialVariants: PreviewVariantData[];
  initialIsLocked?: boolean;
}

export const Harness: React.FC<HarnessProps> = ({
  ComponentToRender,
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

  const activeVariant = useMemo(() => {
    return variants[activeVariantIndex] || variants[0] || { name: 'Default', props: {}, store: {} };
  }, [variants, activeVariantIndex]);

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
  const preparedProps = useMemo(() => {
    const rawProps = { ...(activeVariant.props || {}) };

    // Create a proxy that catches any undefined `on*` callbacks requested by the component
    return new Proxy(rawProps, {
      get(target, propKey, receiver) {
        if (typeof propKey === 'string') {
          // If already defined in mock props, return it
          if (propKey in target) {
            return Reflect.get(target, propKey, receiver);
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
  }, [activeVariant.props, addActionLog]);

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
          ) : (
            <MockReduxProvider
              initialState={activeVariant.store || {}}
              onActionDispatched={addActionLog}
            >
              <div className="preview-component-host">
                <ComponentToRender {...preparedProps} />
              </div>
            </MockReduxProvider>
          )}
        </ErrorBoundary>
      </main>

      {/* Action / Event Inspector Drawer */}
      <ActionPanel logs={actionLogs} onClear={clearActionLogs} />
    </div>
  );
};
