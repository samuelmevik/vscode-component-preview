import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Component, Lock, Unlock, Power } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { MockReduxProvider, ActionLogItem } from './MockReduxProvider';
import { ActionPanel } from './ActionPanel';
import { subscribeToConsoleLogs } from './consoleInterceptor';
import { prepareProps } from './propsResolver';
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
        if (Array.isArray(message.payload.variants)) {
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
      window.parent.postMessage({ type: 'TOGGLE_LOCK', payload: { locked: nextLocked } }, '*');
      fetch('/__preview_api/toggle_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: nextLocked }),
      }).catch(() => {});
      return nextLocked;
    });
  }, []);

  const handleStopServer = useCallback(() => {
    window.parent.postMessage({ type: 'STOP_SERVER' }, '*');
    fetch('/__preview_api/stop_server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  }, []);

  const addActionLog = useCallback((item: ActionLogItem) => {
    setActionLogs((prev) => [item, ...prev.slice(0, 49)]); // keep last 50 actions
  }, []);

  useEffect(() => {
    return subscribeToConsoleLogs(addActionLog);
  }, [addActionLog]);

  const clearActionLogs = useCallback(() => {
    setActionLogs([]);
  }, []);

  const activeVariant = useMemo(() => {
    const raw = variants[activeVariantIndex] || variants[0] || { name: 'Default', props: {}, store: {} };
    let resolvedStore = raw.store;
    if (typeof resolvedStore === 'string' && resolvedStore in userModule) {
      resolvedStore = userModule[resolvedStore];
    }
    let resolvedProps = raw.props;
    if (typeof resolvedProps === 'string' && resolvedProps in userModule) {
      resolvedProps = userModule[resolvedProps];
    }
    return {
      ...raw,
      props: resolvedProps,
      store: resolvedStore,
      storePath: raw.storePath,
    };
  }, [variants, activeVariantIndex, userModule]);

  const preparedProps = useMemo(() => {
    return prepareProps(activeVariant.props, userModule, addActionLog);
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
