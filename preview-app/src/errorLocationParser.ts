export interface ErrorLocation {
  filePath: string;
  fileName: string;
  functionName?: string;
  line: number;
  column: number;
}

export interface ParsedStackFrame {
  raw: string;
  functionName?: string;
  filePath?: string;
  fileName?: string;
  line?: number;
  column?: number;
  isUserCode: boolean;
}

export interface ParsedErrorInfo {
  message: string;
  primaryLocation?: ErrorLocation;
  userFrames: ParsedStackFrame[];
  allFrames: ParsedStackFrame[];
}

/**
 * Normalizes raw file paths extracted from browser stack traces (Vite /@fs/ URLs, Windows drives, etc.)
 */
export function normalizeSourcePath(rawPath: string): string {
  let cleaned = rawPath.trim();

  // Strip query parameters (?t=1234567, ?import, etc.)
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1) {
    cleaned = cleaned.substring(0, qIdx);
  }

  // Strip hash if present
  const hIdx = cleaned.indexOf('#');
  if (hIdx !== -1) {
    cleaned = cleaned.substring(0, hIdx);
  }

  // Decode URI encoding (e.g. %20 for spaces)
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {}

  // Strip http://host:port/@fs/ or /@fs/ prefix from Vite
  cleaned = cleaned.replace(/^https?:\/\/[^/]+\/@fs\//i, '');
  cleaned = cleaned.replace(/^\/@fs\//i, '');

  // Strip standard http://host:port/ prefix
  cleaned = cleaned.replace(/^https?:\/\/[^/]+\//i, '');

  // Fix leading slash on Windows drive letters (e.g. /C:/Users -> C:/Users)
  if (/^\/[a-zA-Z]:[/\\]/.test(cleaned)) {
    cleaned = cleaned.substring(1);
  }

  // Normalize backslashes to forward slashes for consistency
  cleaned = cleaned.replace(/\\/g, '/');

  // Normalize Windows drive letters to uppercase
  cleaned = cleaned.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toUpperCase()}:`);

  return cleaned;
}

/**
 * Tests whether a stack frame refers to internal libraries rather than user source code.
 */
export function isInternalFrame(pathOrLine: string): boolean {
  return (
    pathOrLine.includes('node_modules') ||
    pathOrLine.includes('/@vite/') ||
    pathOrLine.includes('/@react-refresh') ||
    pathOrLine.includes('/preview-app/') ||
    pathOrLine.includes('react-dom') ||
    pathOrLine.includes('react_devtools_backend') ||
    pathOrLine.includes('preview_entry.tsx') ||
    pathOrLine.includes('vite/dist/client') ||
    pathOrLine.includes('vscode-component-preview')
  );
}

/**
 * Parses a single stack line from V8 / Chromium, Firefox, or Safari into a structured frame.
 */
export function parseStackLine(lineStr: string): ParsedStackFrame | null {
  const trimmed = lineStr.trim();
  if (!trimmed || !trimmed.startsWith('at ') && !trimmed.includes('@')) {
    return null;
  }

  let functionName: string | undefined;
  let rawUrl: string | undefined;
  let lineNum: number | undefined;
  let colNum: number | undefined;

  // Format 1: V8 "at functionName (http://...:line:col)" or "at async functionName (http://...:line:col)"
  const v8NamedMatch = trimmed.match(/^at\s+(?:async\s+)?([^\s(]+)\s+\((.+)\)$/);
  if (v8NamedMatch) {
    functionName = v8NamedMatch[1];
    const locationPart = v8NamedMatch[2];
    const locMatch = locationPart.match(/(.+):(\d+):(\d+)$/);
    if (locMatch) {
      rawUrl = locMatch[1];
      lineNum = parseInt(locMatch[2], 10);
      colNum = parseInt(locMatch[3], 10);
    } else {
      rawUrl = locationPart;
    }
  } else {
    // Format 2: V8 "at http://...:line:col"
    const v8AnonMatch = trimmed.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (v8AnonMatch) {
      rawUrl = v8AnonMatch[1];
      lineNum = parseInt(v8AnonMatch[2], 10);
      colNum = parseInt(v8AnonMatch[3], 10);
    } else {
      // Format 3: Firefox / Safari "functionName@http://...:line:col" or "@http://...:line:col"
      const ffMatch = trimmed.match(/^(?:([^@]*)@)?(.+):(\d+):(\d+)$/);
      if (ffMatch) {
        functionName = ffMatch[1] || undefined;
        rawUrl = ffMatch[2];
        lineNum = parseInt(ffMatch[3], 10);
        colNum = parseInt(ffMatch[4], 10);
      }
    }
  }

  if (!rawUrl) {
    return {
      raw: trimmed,
      isUserCode: false,
    };
  }

  const normalizedPath = normalizeSourcePath(rawUrl);
  const fileName = normalizedPath.split('/').pop() || normalizedPath;
  const isUser = !isInternalFrame(rawUrl) && !isInternalFrame(normalizedPath);

  // Clean up function name if it contains noise like "Object." or "<anonymous>"
  if (functionName) {
    if (functionName.includes('<anonymous>')) {
      functionName = undefined;
    } else if (functionName.startsWith('Object.')) {
      functionName = functionName.replace(/^Object\./, '');
    }
  }

  return {
    raw: trimmed,
    functionName,
    filePath: normalizedPath,
    fileName,
    line: lineNum,
    column: colNum,
    isUserCode: isUser,
  };
}

/**
 * Parses full stack trace of an Error into user-code frames and primary navigation location.
 */
export function parseErrorInfo(
  error: Error | string | any,
  fallbackFile?: string,
  fallbackLine = 1
): ParsedErrorInfo {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : error?.message || 'An unknown error occurred';

  const stack = error instanceof Error ? error.stack : typeof error === 'string' ? error : error?.stack;

  const allFrames: ParsedStackFrame[] = [];
  const userFrames: ParsedStackFrame[] = [];

  if (stack && typeof stack === 'string') {
    const rawLines = stack.split('\n');
    for (const rawLine of rawLines) {
      const parsed = parseStackLine(rawLine);
      if (parsed) {
        allFrames.push(parsed);
        if (parsed.isUserCode && parsed.filePath && parsed.line) {
          userFrames.push(parsed);
        }
      }
    }
  }

  let primaryLocation: ErrorLocation | undefined;

  if (userFrames.length > 0) {
    const top = userFrames[0];
    primaryLocation = {
      filePath: top.filePath!,
      fileName: top.fileName!,
      functionName: top.functionName,
      line: top.line!,
      column: top.column || 1,
    };
  } else if (fallbackFile) {
    const normalizedFallback = normalizeSourcePath(fallbackFile);
    primaryLocation = {
      filePath: normalizedFallback,
      fileName: normalizedFallback.split('/').pop() || normalizedFallback,
      line: fallbackLine,
      column: 1,
    };
  }

  return {
    message,
    primaryLocation,
    userFrames,
    allFrames,
  };
}

/**
 * Sends a navigation request to open the file and line in the active VS Code window.
 * Supports both webview iframe postMessage and external browser HTTP API.
 */
export function navigateToSource(location: {
  filePath: string;
  line?: number;
  column?: number;
}): void {
  if (!location.filePath) return;

  const payload = {
    filePath: location.filePath,
    line: location.line ?? 1,
    column: location.column ?? 1,
  };

  // 1. Send to parent window (VS Code Webview Panel host)
  if (typeof window !== 'undefined') {
    try {
      window.parent.postMessage(
        {
          type: 'NAVIGATE_TO_SOURCE',
          payload,
        },
        '*'
      );
    } catch {}

    // 2. Also call Vite dev server API for external browser mode
    try {
      fetch('/__preview_api/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }
}
