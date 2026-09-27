import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  RefreshCw,
  Layers,
  Hand,
  Maximize,
  AlertTriangle,
  X,
  ExternalLink,
  Bug,
  ChevronDown,
} from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { MockReduxProvider, ActionLogItem } from './MockReduxProvider';
import { ActionPanel } from './ActionPanel';
import { subscribeToConsoleLogs } from './consoleInterceptor';
import { subscribeToNetworkLogs } from './networkInterceptor';
import './reduxInterceptor';
import { prepareProps } from './propsResolver';
import {
  subscribeToRuntimeErrors,
  setActiveSourceFile,
  RuntimeErrorItem,
} from './errorInterceptor';
import { navigateToSource } from './errorLocationParser';
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
  currentFilePath?: string;
  componentStartLine?: number;
  commentStartLine?: number;
}

type ViewportMode = 'responsive' | 'mobile' | 'tablet' | 'desktop';
type CanvasTheme = 'auto' | 'dark' | 'light' | 'checkerboard';

const VIEWPORT_PRESETS: Record<Exclude<ViewportMode, 'responsive'>, { width: number; height: number; label: string }> = {
  mobile: { width: 375, height: 667, label: 'Mobile (375 × 667)' },
  tablet: { width: 768, height: 1024, label: 'Tablet (768 × 1024)' },
  desktop: { width: 1280, height: 800, label: 'Desktop (1280 × 800)' },
};

const EMPTY_STORE = Object.freeze({});

export const Harness: React.FC<HarnessProps> = ({
  ComponentToRender,
  userModule = {},
  storeModules = {},
  wrapperModules = {},
  initialComponentName,
  initialVariants,
  initialAllComponents = [],
  initialIsLocked = false,
  currentFilePath: initialFilePath,
  componentStartLine: initialComponentStartLine,
  commentStartLine: initialCommentStartLine,
}) => {
  const [componentName, setComponentName] = useState(initialComponentName);
  const [currentFilePath, setCurrentFilePath] = useState<string | undefined>(initialFilePath);
  const [componentStartLine, setComponentStartLine] = useState<number | undefined>(initialComponentStartLine);
  const [commentStartLine, setCommentStartLine] = useState<number | undefined>(initialCommentStartLine);
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeErrorItem[]>([]);
  const [variants, setVariants] = useState<PreviewVariantData[]>(initialVariants);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [actionLogs, setActionLogs] = useState<ActionLogItem[]>(() => {
    try {
      const preserve = localStorage.getItem('component-preview-preserve-log') === 'true';
      if (preserve) {
        const saved = sessionStorage.getItem('component-preview-persisted-logs');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch {}
    return [];
  });
  const [isLocked, setIsLocked] = useState(initialIsLocked);
  const [allComponents, setAllComponents] = useState<string[]>(initialAllComponents);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [vscodeTheme, setVsCodeTheme] = useState<'dark' | 'light'>('dark');
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(() => {
    try {
      const saved = localStorage.getItem('vscode_preview_canvas_theme');
      if (saved === 'auto' || saved === 'dark' || saved === 'light' || saved === 'checkerboard') {
        return saved;
      }
    } catch {}
    return 'auto';
  });
  const [remountCount, setRemountCount] = useState<number>(0);

  useEffect(() => {
    try {
      localStorage.setItem('vscode_preview_canvas_theme', canvasTheme);
    } catch {}
  }, [canvasTheme]);

  const isFirstMountRef = useRef(true);

  // Keep internal state in sync with props passed from Vite virtual entry
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    setVariants(initialVariants);
    setActiveVariantIndex((prev) => (prev < initialVariants.length ? prev : 0));
    setRemountCount((prev) => prev + 1);
    setRuntimeErrors([]);
  }, [initialVariants]);

  useEffect(() => {
    setComponentName(initialComponentName);
  }, [initialComponentName]);

  useEffect(() => {
    setCurrentFilePath(initialFilePath);
  }, [initialFilePath]);

  useEffect(() => {
    setComponentStartLine(initialComponentStartLine);
  }, [initialComponentStartLine]);

  useEffect(() => {
    setCommentStartLine(initialCommentStartLine);
  }, [initialCommentStartLine]);

  useEffect(() => {
    setAllComponents(initialAllComponents);
  }, [initialAllComponents]);

  const effectiveTheme = useMemo(() => {
    if (canvasTheme === 'auto') {
      return vscodeTheme;
    }
    return canvasTheme;
  }, [canvasTheme, vscodeTheme]);

  // Sync actionLogs to sessionStorage when preserveLog is active
  useEffect(() => {
    try {
      const preserve = localStorage.getItem('component-preview-preserve-log') === 'true';
      if (preserve) {
        sessionStorage.setItem('component-preview-persisted-logs', JSON.stringify(actionLogs.slice(0, 100)));
      } else {
        sessionStorage.removeItem('component-preview-persisted-logs');
      }
    } catch {}
  }, [actionLogs]);

  useEffect(() => {
    setActiveSourceFile(currentFilePath);
  }, [currentFilePath]);
  // Camera navigation & zoom state (persists across component swaps & file switches)
  const [camera, setCamera] = useState<{ zoom: number; pan: { x: number; y: number } }>(() => {
    try {
      const saved = sessionStorage.getItem('vscode_preview_camera_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed?.zoom === 'number' &&
          typeof parsed?.pan?.x === 'number' &&
          typeof parsed?.pan?.y === 'number'
        ) {
          return parsed;
        }
      }
    } catch {}
    return { zoom: 100, pan: { x: 0, y: 0 } };
  });
  const [panMode, setPanMode] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const canvasWrapperRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const spacePressedRef = useRef(spacePressed);
  spacePressedRef.current = spacePressed;
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;

  // Persist camera position so it remains stable across component swaps
  useEffect(() => {
    try {
      sessionStorage.setItem('vscode_preview_camera_state', JSON.stringify(camera));
    } catch {}
  }, [camera]);

  useEffect(() => {
    setIsLocked(initialIsLocked);
  }, [initialIsLocked]);

  // Listen for live updates from VS Code extension host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'SYNC_THEME') {
        const themeKind = message.payload?.themeKind;
        if (themeKind === 'light' || themeKind === 'dark') {
          setVsCodeTheme(themeKind);
        }
      }

      if (message.type === 'SYNC_LOCK') {
        setIsLocked(!!message.payload.locked);
      }

      if (message.type === 'SYNC_PREVIEW') {
        // Reset error state and remount so any newly previewed component or updated code renders fresh
        setRemountCount((prev) => prev + 1);
        setRuntimeErrors([]);

        if (message.payload.themeKind) {
          setVsCodeTheme(message.payload.themeKind === 'light' ? 'light' : 'dark');
        }

        if (message.payload.isLocked !== undefined) {
          setIsLocked(!!message.payload.isLocked);
        }
        if (message.payload.currentFilePath) {
          setCurrentFilePath(message.payload.currentFilePath);
        }
        if (message.payload.componentStartLine !== undefined) {
          setComponentStartLine(message.payload.componentStartLine);
        }
        if (message.payload.commentStartLine !== undefined) {
          setCommentStartLine(message.payload.commentStartLine);
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

      if (message.type === 'RESET_COMPONENT_STATE') {
        setRemountCount((prev) => prev + 1);
        setRuntimeErrors([]);
      }
    };

    window.addEventListener('message', handleMessage);

    // Listen for Vite HMR updates to clear error states when code is saved
    const hot = (import.meta as any).hot;
    let handleBeforeUpdate: (() => void) | undefined;
    let handleThemeChange: ((data: any) => void) | undefined;
    if (hot && typeof hot.on === 'function') {
      handleBeforeUpdate = () => {
        setRemountCount((prev) => prev + 1);
      };
      hot.on('vite:beforeUpdate', handleBeforeUpdate);

      handleThemeChange = (data: { themeKind?: 'dark' | 'light' }) => {
        if (data?.themeKind) {
          setVsCodeTheme(data.themeKind);
        }
      };
      hot.on('preview:theme', handleThemeChange);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (hot && typeof hot.off === 'function') {
        if (handleBeforeUpdate) hot.off('vite:beforeUpdate', handleBeforeUpdate);
        if (handleThemeChange) hot.off('preview:theme', handleThemeChange);
      }
    };
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

  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const debugMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showDebugMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (debugMenuRef.current && !debugMenuRef.current.contains(e.target as Node)) {
        setShowDebugMenu(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [showDebugMenu]);

  const handleStartDebug = useCallback(() => {
    setShowDebugMenu(false);
    window.parent.postMessage(
      { type: 'START_DEBUG', payload: { componentName } },
      '*'
    );
    fetch('/__preview_api/start_debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentName }),
    }).catch(() => {});
  }, [componentName]);

  const handleOpenDevTools = useCallback(() => {
    setShowDebugMenu(false);
    window.parent.postMessage({ type: 'OPEN_DEVTOOLS' }, '*');
    fetch('/__preview_api/open_devtools', {
      method: 'POST',
    }).catch(() => {});
  }, []);

  const handleTriggerDebuggerStatement = useCallback(() => {
    setShowDebugMenu(false);
    try {
      // eslint-disable-next-line no-debugger
      debugger;
      const fn = new Function('debugger;');
      fn();
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const lockPrefix = isLocked ? '🔒 ' : '';
      document.title = `${lockPrefix}Preview: <${componentName} />`;
    }
  }, [componentName, isLocked]);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const handleSwitchComponent = useCallback((newCompName: string) => {
    setSwitchingTo(newCompName);
    window.parent.postMessage(
      { type: 'SWITCH_COMPONENT', payload: { componentName: newCompName } },
      '*'
    );
    fetch('/__preview_api/switch_component', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentName: newCompName }),
    })
      .catch(() => {})
      .finally(() => {
        setSwitchingTo(null);
      });
  }, []);

  const addActionLog = useCallback((item: ActionLogItem) => {
    setActionLogs((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === item.id);
      if (existingIdx !== -1) {
        const updated = [...prev];
        updated[existingIdx] = item;
        return updated;
      }
      return [item, ...prev.slice(0, 299)];
    });
  }, []);

  const dismissRuntimeError = useCallback((id: string) => {
    setRuntimeErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  useEffect(() => {
    const unsubConsole = subscribeToConsoleLogs(addActionLog);
    const unsubNetwork = subscribeToNetworkLogs(addActionLog);
    const unsubErrors = subscribeToRuntimeErrors((item) => {
      setRuntimeErrors((prev) => {
        const existingIdx = prev.findIndex((e) => e.id === item.id);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = item;
          return updated;
        }
        return [item, ...prev.slice(0, 4)];
      });

      const logItem: ActionLogItem = {
        id: item.id,
        source: 'error',
        level: 'error',
        name: item.location?.functionName
          ? `Exception in ${item.location.functionName}()`
          : item.source === 'render'
          ? 'Component Render Error'
          : 'Runtime Exception',
        payload: {
          __isError: true,
          message: item.message,
          stack: item.stack,
          source: item.source,
        },
        timestamp: item.timestamp,
        location: item.location,
      };

      setActionLogs((prev) => {
        const existingIdx = prev.findIndex((a) => a.id === item.id);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = logItem;
          return updated;
        }
        return [logItem, ...prev.slice(0, 49)];
      });
    });

    return () => {
      unsubConsole();
      unsubNetwork();
      unsubErrors();
    };
  }, [addActionLog]);

  const clearActionLogs = useCallback(() => {
    setActionLogs([]);
    try {
      sessionStorage.removeItem('component-preview-persisted-logs');
    } catch {}
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

  useEffect(() => {
    try {
      (window as any).__preview_current_props__ = preparedProps;
      (window as any).__preview_component_name__ = componentName;
    } catch {}
  }, [preparedProps, componentName]);

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
      if (curr === 'auto') return 'dark';
      if (curr === 'dark') return 'light';
      if (curr === 'light') return 'checkerboard';
      return 'auto';
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setIsTransitioning(true);
    setCamera((prev) => {
      const nextZoom = Math.min(prev.zoom + 25, 500);
      const s1 = prev.zoom / 100;
      const s2 = nextZoom / 100;
      return {
        zoom: nextZoom,
        pan: {
          x: Math.round(prev.pan.x * (s2 / s1)),
          y: Math.round(prev.pan.y * (s2 / s1)),
        },
      };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setIsTransitioning(true);
    setCamera((prev) => {
      const nextZoom = Math.max(prev.zoom - 25, 10);
      const s1 = prev.zoom / 100;
      const s2 = nextZoom / 100;
      return {
        zoom: nextZoom,
        pan: {
          x: Math.round(prev.pan.x * (s2 / s1)),
          y: Math.round(prev.pan.y * (s2 / s1)),
        },
      };
    });
  }, []);

  const handleResetCamera = useCallback(() => {
    setIsTransitioning(true);
    setCamera({
      zoom: 100,
      pan: { x: 0, y: 0 },
    });
  }, []);

  const handleFitToScreen = useCallback(() => {
    const wrapper = canvasWrapperRef.current;
    const stage = stageRef.current;
    if (!wrapper || !stage) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const availableWidth = wrapperRect.width - 64; // 32px padding on each side
    const availableHeight = wrapperRect.height - 64;

    if (availableWidth <= 0 || availableHeight <= 0) return;

    // Find the content target: device frame or component host
    const contentEl =
      stage.querySelector<HTMLElement>('.device-frame') ||
      stage.querySelector<HTMLElement>('.preview-component-host') ||
      (stage.firstElementChild as HTMLElement | null);

    if (!contentEl) return;

    const contentRect = contentEl.getBoundingClientRect();
    const currentScale = cameraRef.current.zoom / 100;
    const naturalWidth = contentRect.width / currentScale;
    const naturalHeight = contentRect.height / currentScale;

    if (naturalWidth <= 0 || naturalHeight <= 0) return;

    const scaleX = availableWidth / naturalWidth;
    const scaleY = availableHeight / naturalHeight;
    const targetScale = Math.min(scaleX, scaleY, 1.0);
    const targetZoom = Math.max(Math.round(targetScale * 100), 10);

    setIsTransitioning(true);
    setCamera({
      zoom: targetZoom,
      pan: { x: 0, y: 0 },
    });
  }, []);


  // Zoom by scroll wheel with focal point under cursor, and trackpad swipe/shift-scroll support
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e: WheelEvent) => {
      // If user holds Ctrl/Cmd or Space, or has Pan Mode explicitly active, they intend to zoom the canvas
      const isZoomModifier = e.ctrlKey || e.metaKey || spacePressedRef.current || panModeRef.current;

      if (!isZoomModifier) {
        // Check if mouse is hovering inside a component with scrollable content
        let curr = e.target as HTMLElement | null;
        let hasScrollableContainer = false;

        while (curr && curr !== wrapper) {
          if (curr.classList && curr.classList.contains('preview-canvas-wrapper')) {
            break;
          }

          const style = window.getComputedStyle(curr);
          const oy = style.overflowY;
          const ox = style.overflowX;

          const isScrollableY =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            curr.scrollHeight > curr.clientHeight + 1;

          const isScrollableX =
            (ox === 'auto' || ox === 'scroll' || ox === 'overlay') &&
            curr.scrollWidth > curr.clientWidth + 1;

          if (isScrollableY || isScrollableX) {
            hasScrollableContainer = true;
            break;
          }

          curr = curr.parentElement;
        }

        if (hasScrollableContainer) {
          // Allow the scrollable component to scroll natively; do NOT zoom in/out!
          return;
        }
      }

      e.preventDefault();

      // Horizontal trackpad swipe
      if (Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) === 0) {
        setIsTransitioning(false);
        setCamera((prev) => ({
          ...prev,
          pan: {
            x: Math.round(prev.pan.x - e.deltaX),
            y: prev.pan.y,
          },
        }));
        return;
      }

      // Normalize delta across browsers
      let delta = -e.deltaY;
      if (e.deltaMode === 1) {
        delta *= 33;
      } else if (e.deltaMode === 2) {
        delta *= 100;
      }

      // Shift + wheel = horizontal pan
      if (e.shiftKey) {
        setIsTransitioning(false);
        setCamera((prev) => ({
          ...prev,
          pan: {
            x: Math.round(prev.pan.x + delta),
            y: prev.pan.y,
          },
        }));
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - (rect.left + rect.width / 2);
      const mouseY = e.clientY - (rect.top + rect.height / 2);

      // Smooth proportional zoom
      const clampedDelta = Math.max(Math.min(delta, 120), -120);
      const factor = Math.exp(clampedDelta * 0.002);

      setIsTransitioning(false);

      setCamera((prev) => {
        const nextZoom = Math.min(Math.max(Math.round(prev.zoom * factor), 10), 500);
        if (nextZoom === prev.zoom) return prev;

        const s1 = prev.zoom / 100;
        const s2 = nextZoom / 100;

        return {
          zoom: nextZoom,
          pan: {
            x: Math.round(mouseX - (mouseX - prev.pan.x) * (s2 / s1)),
            y: Math.round(mouseY - (mouseY - prev.pan.y) * (s2 / s1)),
          },
        };
      });
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      wrapper.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Keyboard navigation: Spacebar for pan tool, H to toggle pan mode, Esc to exit, Ctrl+0 to reset
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable);

      if (isInput) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      }
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setPanMode((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setPanMode(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleResetCamera();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const handleBlur = () => {
      setSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleResetCamera]);

  // Move camera via drag (Middle-click, Space+drag, Pan mode, Alt+drag, or dragging canvas background)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0 && e.button !== 1) return;

      const isMiddleClick = e.button === 1;
      const target = e.target as HTMLElement;
      const isOverComponent = Boolean(target.closest('.preview-component-host'));

      const shouldPan = isMiddleClick || spacePressed || panMode || e.altKey || !isOverComponent;

      if (!shouldPan) return;

      e.preventDefault();
      setIsTransitioning(false);
      setIsPanning(true);

      const startX = e.clientX;
      const startY = e.clientY;
      const startPanX = cameraRef.current.pan.x;
      const startPanY = cameraRef.current.pan.y;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        setCamera((prev) => ({
          ...prev,
          pan: {
            x: startPanX + dx,
            y: startPanY + dy,
          },
        }));
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        upEvent.preventDefault();
        setIsPanning(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [spacePressed, panMode]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const isOverComponent = Boolean(target.closest('.preview-component-host'));
      if (!isOverComponent) {
        handleResetCamera();
      }
    },
    [handleResetCamera]
  );

  const handleAuxClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  }, []);

  const canvasBgStyle = useMemo(() => {
    if (effectiveTheme === 'checkerboard') {
      const px = camera.pan.x;
      const py = camera.pan.y;
      return {
        backgroundPosition: `${px}px ${py}px, ${px}px ${py + 10}px, ${px + 10}px ${py - 10}px, ${px - 10}px ${py}px`,
      };
    }
    return {
      backgroundPosition: `${camera.pan.x}px ${camera.pan.y}px`,
    };
  }, [effectiveTheme, camera.pan.x, camera.pan.y]);

  return (
    <div className={`preview-container theme-${effectiveTheme} ${canvasTheme === 'auto' ? 'mode-auto' : ''}`}>
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
                  value={switchingTo || componentName}
                  onChange={(e) => handleSwitchComponent(e.target.value)}
                  disabled={Boolean(switchingTo)}
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
            title={
              canvasTheme === 'auto'
                ? `Canvas Theme: AUTO (Synced with VS Code: ${vscodeTheme.toUpperCase()}) (Click to change)`
                : `Canvas Theme: ${canvasTheme.toUpperCase()} (Click to toggle)`
            }
          >
            {canvasTheme === 'auto' ? (
              <span className="auto-theme-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700 }}>
                {vscodeTheme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
                <span style={{ fontSize: 9, opacity: 0.85 }}>A</span>
              </span>
            ) : canvasTheme === 'dark' ? (
              <Moon size={13} />
            ) : canvasTheme === 'light' ? (
              <Sun size={13} />
            ) : (
              <Grid size={13} />
            )}
          </button>

          {/* Camera Navigation & Zoom Controls */}
          <div className="toolbar-btn-group camera-group" title="Camera & Zoom Controls (Scroll to zoom | Drag background, Space+drag, or Middle-click to pan)">
            <button
              className={`toolbar-btn ${panMode ? 'active' : ''}`}
              onClick={() => setPanMode((p) => !p)}
              title={panMode ? 'Exit Pan Mode (H / Esc)' : 'Pan Tool (H) - Drag anywhere to move camera'}
            >
              <Hand size={13} />
            </button>
            <button
              className="toolbar-btn"
              onClick={handleZoomOut}
              title="Zoom Out (or scroll wheel down)"
            >
              <ZoomOut size={13} />
            </button>
            <span
              className="zoom-text"
              onClick={handleResetCamera}
              title="Camera zoom level (Click to reset to 100% & Center)"
            >
              {camera.zoom}%
            </span>
            <button
              className="toolbar-btn"
              onClick={handleZoomIn}
              title="Zoom In (or scroll wheel up)"
            >
              <ZoomIn size={13} />
            </button>
            <button
              className="toolbar-btn"
              onClick={handleFitToScreen}
              title="Fit to Screen - Scale component to fit visible canvas"
            >
              <Maximize size={13} />
            </button>
            <button
              className="toolbar-btn"
              onClick={handleResetCamera}
              title="Reset Camera (100% & Centered)"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Reset Component State Button */}
          <button
            className="toolbar-btn"
            onClick={() => setRemountCount((c) => c + 1)}
            title="Reset Component State (cleanly remounts component with initial props & state)"
          >
            <RefreshCw size={13} />
          </button>

          {/* Debug Component in VS Code Button & Menu */}
          <div className="toolbar-btn-group debug-group" title="Debug Component (Attach VS Code debugger with breakpoints & stepping)">
            <button
              className="toolbar-btn debug-btn"
              onClick={handleStartDebug}
              title={`Debug <${componentName} /> in VS Code (Attaches debugger with source breakpoints)`}
            >
              <Bug size={13} className="debug-icon" />
              <span className="debug-btn-text">Debug</span>
            </button>
            <button
              className={`toolbar-btn debug-dropdown-btn ${showDebugMenu ? 'active' : ''}`}
              onClick={() => setShowDebugMenu((prev) => !prev)}
              title="More debugging options"
            >
              <ChevronDown size={10} />
            </button>
            {showDebugMenu && (
              <div className="debug-dropdown-menu" ref={debugMenuRef}>
                <button
                  className="debug-menu-item"
                  onClick={handleStartDebug}
                >
                  <Bug size={13} className="menu-icon" />
                  <div className="menu-item-text">
                    <strong>Start VS Code Debugger</strong>
                    <small>Launch browser session with breakpoints &amp; stepping</small>
                  </div>
                </button>
                <button
                  className="debug-menu-item"
                  onClick={handleOpenDevTools}
                >
                  <ExternalLink size={13} className="menu-icon" />
                  <div className="menu-item-text">
                    <strong>Open Webview DevTools</strong>
                    <small>Inspect DOM elements, styles &amp; internal console</small>
                  </div>
                </button>
                <button
                  className="debug-menu-item"
                  onClick={handleTriggerDebuggerStatement}
                >
                  <AlertTriangle size={13} className="menu-icon" />
                  <div className="menu-item-text">
                    <strong>Trigger debugger; statement</strong>
                    <small>Pause execution in open DevTools or attached debugger</small>
                  </div>
                </button>
              </div>
            )}
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
      <main
        ref={canvasWrapperRef}
        className={`preview-canvas-wrapper ${isPanning ? 'is-panning' : ''} ${panMode ? 'pan-mode' : ''} ${spacePressed ? 'space-pressed' : ''}`}
        style={canvasBgStyle}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onAuxClick={handleAuxClick}
      >
        <ErrorBoundary
          key={remountCount}
          fallbackKey={`${componentName}-${activeVariantIndex}-${remountCount}`}
          currentFilePath={currentFilePath}
          componentName={componentName}
          componentStartLine={componentStartLine}
          onReset={() => setRemountCount((prev) => prev + 1)}
        >
          {activeVariant.parseError ? (
            <div className="preview-error-card">
              <div className="preview-error-header">
                <h3>Comment YAML Parsing Error</h3>
              </div>
              <p className="preview-error-message">{activeVariant.parseError}</p>
              {currentFilePath && (
                <button
                  className="preview-jump-btn"
                  onClick={() =>
                    navigateToSource({
                      filePath: currentFilePath,
                      line: commentStartLine || componentStartLine || 1,
                    })
                  }
                  title={`Open comment in ${currentFilePath}`}
                >
                  <ExternalLink size={13} />
                  <span>
                    Open Comment in Editor ({currentFilePath.split(/[/\\]/).pop()}:{commentStartLine || 1})
                  </span>
                </button>
              )}
            </div>
          ) : (() => {
            const activeStorePath = activeVariant.storePath || variants.find((v) => v.storePath)?.storePath;
            const cleanStorePath = activeStorePath ? activeStorePath.split('#')[0].trim() : undefined;
            const activeStoreModule = cleanStorePath && storeModules
              ? storeModules[cleanStorePath]
              : (storeModules && Object.keys(storeModules).length === 1
                  ? Object.values(storeModules)[0]
                  : undefined);
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
                  {currentFilePath && (
                    <button
                      className="preview-jump-btn"
                      onClick={() =>
                        navigateToSource({
                          filePath: currentFilePath,
                          line: componentStartLine || 1,
                        })
                      }
                      title={`Open variant definition in ${currentFilePath}`}
                    >
                      <ExternalLink size={13} />
                      <span>
                        Open Component in Editor ({currentFilePath.split(/[/\\]/).pop()}:{componentStartLine || 1})
                      </span>
                    </button>
                  )}
                </div>
              );
            }

            // Resolve optional wrapper component from wrapperPath
            const activeWrapperPath = activeVariant.wrapperPath || variants.find((v) => v.wrapperPath)?.wrapperPath;
            const cleanWrapperPath = activeWrapperPath ? activeWrapperPath.split('#')[0].trim() : undefined;
            const activeWrapperModule = cleanWrapperPath && wrapperModules
              ? wrapperModules[cleanWrapperPath]
              : (wrapperModules && Object.keys(wrapperModules).length === 1
                  ? Object.values(wrapperModules)[0]
                  : undefined);
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
                initialState={activeVariant.store || EMPTY_STORE}
                onActionDispatched={addActionLog}
              >
                <div className="preview-component-host">
                  <WrapperComponent>
                    <CurrentComponent {...preparedProps} />
                  </WrapperComponent>
                </div>
              </MockReduxProvider>
            );

            return (
              <div
                ref={stageRef}
                className={`canvas-camera-stage ${isTransitioning ? 'transitioning' : ''}`}
                style={{
                  transform: `translate3d(${camera.pan.x}px, ${camera.pan.y}px, 0) scale(${camera.zoom / 100})`,
                }}
              >
                {activeViewport ? (
                  <div className="device-frame-container">
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
                ) : (
                  <div className="responsive-canvas-container">
                    {renderedContent}
                  </div>
                )}
              </div>
            );
          })()}
        </ErrorBoundary>

        {/* Floating Camera Status & Reset Pill */}
        {(camera.pan.x !== 0 || camera.pan.y !== 0 || camera.zoom !== 100) && (
          <div className="camera-indicator">
            <span className="camera-coords">
              Pan: {camera.pan.x > 0 ? `+${camera.pan.x}` : camera.pan.x}px,{' '}
              {camera.pan.y > 0 ? `+${camera.pan.y}` : camera.pan.y}px &bull; {camera.zoom}%
            </span>
            <button
              className="camera-reset-link"
              onClick={handleResetCamera}
              title="Reset camera to center (100%)"
            >
              <RotateCcw size={10} /> Reset
            </button>
          </div>
        )}
      </main>

      {/* Floating Runtime Error Toasts (for event handler & async throws) */}
      {runtimeErrors.length > 0 && (
        <div className="preview-error-toasts-container">
          {runtimeErrors.map((err) => (
            <div key={err.id} className="preview-error-toast">
              <div className="toast-main">
                <AlertTriangle size={15} className="toast-icon" />
                <div className="toast-body">
                  <div className="toast-title">
                    {err.location?.functionName
                      ? `Error in ${err.location.functionName}()`
                      : 'Runtime Exception'}
                  </div>
                  <div className="toast-message">{err.message}</div>
                </div>
              </div>
              <div className="toast-actions">
                {err.location && (
                  <button
                    className="toast-jump-btn"
                    onClick={() => navigateToSource(err.location!)}
                    title={`Open ${err.location.filePath}:${err.location.line} in VS Code`}
                  >
                    <ExternalLink size={12} />
                    <span>{err.location.fileName}:{err.location.line}</span>
                  </button>
                )}
                <button
                  className="toast-dismiss-btn"
                  onClick={() => dismissRuntimeError(err.id)}
                  title="Dismiss error notification"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action / Event Inspector Drawer */}
      <ActionPanel logs={actionLogs} onClear={clearActionLogs} componentName={componentName} />
    </div>
  );
};
