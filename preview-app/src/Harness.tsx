import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Component,
  Lock,
  Unlock,
  Power,
  Maximize2,
  Smartphone,
  Tablet,
  Monitor,
  Sun,
  Moon,
  Grid,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Layers,
} from 'lucide-react';
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
  viewport?: { width?: number; height?: number } | string;
  wrapperPath?: string;
  parseError?: string;
}

interface HarnessProps {
  ComponentToRender: React.ComponentType<any>;
  userModule?: Record<string, any>;
  storeModules?: Record<string, any>;
  wrapperModules?: Record<string, any>;
  initialComponentName: string;
  initialVariants: PreviewVariantData[];
  initialAllComponents?: string[];
  initialIsLocked?: boolean;
}

type ViewportMode = 'responsive' | 'mobile' | 'tablet' | 'desktop';
type CanvasTheme = 'dark' | 'light' | 'checkerboard';

const VIEWPORT_PRESETS: Record<Exclude<ViewportMode, 'responsive'>, { width: number; height: number; label: string }> = {
  mobile: { width: 375, height: 667, label: 'Mobile (375 × 667)' },
  tablet: { width: 768, height: 1024, label: 'Tablet (768 × 1024)' },
  desktop: { width: 1280, height: 800, label: 'Desktop (1280 × 800)' },
};

export const Harness: React.FC<HarnessProps> = ({
  ComponentToRender,
  userModule = {},
  storeModules = {},
  wrapperModules = {},
  initialComponentName,
  initialVariants,
  initialAllComponents = [],
  initialIsLocked = false,
}) => {
  const [componentName, setComponentName] = useState(initialComponentName);
  const [variants, setVariants] = useState<PreviewVariantData[]>(initialVariants);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [actionLogs, setActionLogs] = useState<ActionLogItem[]>([]);
  const [isLocked, setIsLocked] = useState(initialIsLocked);
  const [allComponents, setAllComponents] = useState<string[]>(initialAllComponents);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>('dark');
  const [zoom, setZoom] = useState<number>(100);

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
        if (Array.isArray(message.payload.allComponents)) {
          setAllComponents(message.payload.allComponents);
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

  const handleSwitchComponent = useCallback((newCompName: string) => {
    setComponentName(newCompName);
    window.parent.postMessage(
      { type: 'SWITCH_COMPONENT', payload: { componentName: newCompName } },
      '*'
    );
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
      slice: raw.slice,
      viewport: raw.viewport,
      wrapperPath: raw.wrapperPath,
    };
  }, [variants, activeVariantIndex, userModule]);

  const preparedProps = useMemo(() => {
    return prepareProps(activeVariant.props, userModule, addActionLog);
  }, [activeVariant.props, userModule, addActionLog]);

  // Determine effective component to render (supports switching via dropdown)
  const CurrentComponent = useMemo(() => {
    if (userModule && componentName in userModule) {
      return userModule[componentName];
    }
    return ComponentToRender;
  }, [userModule, componentName, ComponentToRender]);

  // Determine active viewport dimensions
  const activeViewport = useMemo(() => {
    if (activeVariant.viewport) {
      if (typeof activeVariant.viewport === 'object') {
        const { width, height } = activeVariant.viewport;
        if (width || height) {
          return {
            width: width || 375,
            height: height || 667,
            label: `Custom (${width || 'auto'} × ${height || 'auto'})`,
          };
        }
      } else if (typeof activeVariant.viewport === 'string' && activeVariant.viewport in VIEWPORT_PRESETS) {
        return VIEWPORT_PRESETS[activeVariant.viewport as keyof typeof VIEWPORT_PRESETS];
      }
    }

    if (viewportMode !== 'responsive' && viewportMode in VIEWPORT_PRESETS) {
      return VIEWPORT_PRESETS[viewportMode as keyof typeof VIEWPORT_PRESETS];
    }

    return null;
  }, [activeVariant.viewport, viewportMode]);

  const cycleTheme = useCallback(() => {
    setCanvasTheme((curr) => {
      if (curr === 'dark') return 'light';
      if (curr === 'light') return 'checkerboard';
      return 'dark';
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 25, 200));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 25, 50));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(100);
  }, []);

  return (
    <div className={`preview-container theme-${canvasTheme}`}>
      {/* Top Header / Navigation & Controls */}
      <header className="preview-nav">
        <div className="preview-left-group">
          {/* Component Title or Selector */}
          <div className="preview-comp-info">
            <Component className="comp-icon" size={16} />
            {allComponents.length > 1 ? (
              <div className="comp-dropdown-wrapper">
                <select
                  className="comp-select"
                  value={componentName}
                  onChange={(e) => handleSwitchComponent(e.target.value)}
                  title="Switch between exported components in this file"
                >
                  {allComponents.map((name) => (
                    <option key={name} value={name}>
                      &lt;{name} /&gt;
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="comp-name">&lt;{componentName} /&gt;</span>
            )}
            <span className="comp-type">React</span>
          </div>

          {/* Variant Tabs */}
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
        </div>

        {/* Right Toolbar Controls */}
        <div className="preview-toolbar">
          {/* Viewport Presets Switcher */}
          <div className="toolbar-btn-group" title="Responsive Viewport Presets">
            <button
              className={`toolbar-btn ${viewportMode === 'responsive' && !activeVariant.viewport ? 'active' : ''}`}
              onClick={() => setViewportMode('responsive')}
              title="Responsive (Full Width)"
            >
              <Maximize2 size={13} />
            </button>
            <button
              className={`toolbar-btn ${viewportMode === 'mobile' ? 'active' : ''}`}
              onClick={() => setViewportMode('mobile')}
              title="Mobile (375 × 667)"
            >
              <Smartphone size={13} />
            </button>
            <button
              className={`toolbar-btn ${viewportMode === 'tablet' ? 'active' : ''}`}
              onClick={() => setViewportMode('tablet')}
              title="Tablet (768 × 1024)"
            >
              <Tablet size={13} />
            </button>
            <button
              className={`toolbar-btn ${viewportMode === 'desktop' ? 'active' : ''}`}
              onClick={() => setViewportMode('desktop')}
              title="Desktop (1280 × 800)"
            >
              <Monitor size={13} />
            </button>
          </div>

          {/* Canvas Theme Toggle */}
          <button
            className={`toolbar-btn theme-toggle ${canvasTheme}`}
            onClick={cycleTheme}
            title={`Canvas Theme: ${canvasTheme.toUpperCase()} (Click to toggle)`}
          >
            {canvasTheme === 'dark' ? (
              <Moon size={13} />
            ) : canvasTheme === 'light' ? (
              <Sun size={13} />
            ) : (
              <Grid size={13} />
            )}
          </button>

          {/* Zoom Controls */}
          <div className="toolbar-btn-group zoom-group" title="Canvas Zoom">
            <button className="toolbar-btn" onClick={handleZoomOut} title="Zoom Out (-25%)">
              <ZoomOut size={13} />
            </button>
            <span className="zoom-text" onClick={handleZoomReset} title="Reset Zoom">
              {zoom}%
            </span>
            <button className="toolbar-btn" onClick={handleZoomIn} title="Zoom In (+25%)">
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Lock Button */}
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

          {/* Stop Server Button */}
          <button
            className="preview-stop-btn"
            onClick={handleStopServer}
            title="Stop preview server"
          >
            <Power size={12} className="power-icon" />
            <span>Stop</span>
          </button>
        </div>
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

            // Resolve optional wrapper component from wrapperPath
            const activeWrapperPath = activeVariant.wrapperPath;
            const cleanWrapperPath = activeWrapperPath ? activeWrapperPath.split('#')[0].trim() : undefined;
            const activeWrapperModule = cleanWrapperPath && wrapperModules ? wrapperModules[cleanWrapperPath] : undefined;
            const WrapperComponent =
              activeWrapperModule?.default ||
              activeWrapperModule?.Wrapper ||
              (activeWrapperModule ? Object.values(activeWrapperModule).find((v) => typeof v === 'function') : null) ||
              React.Fragment;

            const renderedContent = (
              <MockReduxProvider
                storeModule={activeStoreModule}
                exportName={storeExportName}
                slice={activeVariant.slice}
                initialState={activeVariant.store || {}}
                onActionDispatched={addActionLog}
              >
                <div className="preview-component-host">
                  <WrapperComponent>
                    <CurrentComponent {...preparedProps} />
                  </WrapperComponent>
                </div>
              </MockReduxProvider>
            );

            if (activeViewport) {
              return (
                <div className="device-frame-container" style={{ transform: `scale(${zoom / 100})` }}>
                  <div className="device-frame-badge">{activeViewport.label}</div>
                  <div
                    className="device-frame"
                    style={{
                      width: activeViewport.width,
                      height: activeViewport.height,
                    }}
                  >
                    <div className="device-content">{renderedContent}</div>
                  </div>
                </div>
              );
            }

            return (
              <div
                className="responsive-canvas-container"
                style={{ transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined }}
              >
                {renderedContent}
              </div>
            );
          })()}
        </ErrorBoundary>
      </main>

      {/* Action / Event Inspector Drawer */}
      <ActionPanel logs={actionLogs} onClear={clearActionLogs} />
    </div>
  );
};
