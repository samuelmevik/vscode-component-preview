export interface ErrorLocation {
  filePath: string;
  fileName: string;
  functionName?: string;
  line: number;
  column: number;
  rawUrl?: string;
  originalResolved?: boolean;
}

export interface ParsedStackFrame {
  raw: string;
  rawUrl?: string;
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
    rawUrl,
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
      rawUrl: top.rawUrl,
      originalResolved: false,
    };
  } else if (fallbackFile) {
    const normalizedFallback = normalizeSourcePath(fallbackFile);
    primaryLocation = {
      filePath: normalizedFallback,
      fileName: normalizedFallback.split('/').pop() || normalizedFallback,
      line: fallbackLine,
      column: 1,
      originalResolved: true,
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
  originalResolved?: boolean;
}): void {
  if (!location.filePath) return;

  const payload = {
    filePath: location.filePath,
    line: location.line ?? 1,
    column: location.column ?? 1,
    originalResolved: !!location.originalResolved,
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

export interface RawSourceMap {
  version: number;
  sources: string[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
  sourcesContent?: string[];
}

export interface OriginalPosition {
  source?: string;
  line?: number;
  column?: number;
  name?: string;
}

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_MAP = new Map<string, number>();
for (let i = 0; i < VLQ_CHARS.length; i++) {
  VLQ_MAP.set(VLQ_CHARS[i], i);
}

/**
 * Decodes a Base64-VLQ encoded segment into an array of integer field values.
 */
export function decodeVLQ(str: string): number[] {
  const result: number[] = [];
  let shift = 0;
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const val = VLQ_MAP.get(str[i]);
    if (val === undefined) continue;
    const hasContinuation = (val & 32) !== 0;
    const digit = val & 31;
    value += digit << shift;
    if (hasContinuation) {
      shift += 5;
    } else {
      const isNegative = (value & 1) === 1;
      result.push(isNegative ? -(value >> 1) : (value >> 1));
      value = 0;
      shift = 0;
    }
  }
  return result;
}

/**
 * Finds the original source position (1-indexed line, 0-indexed column) in a v3 SourceMap
 * corresponding to the generated 1-indexed line and 1-indexed column.
 */
export function findOriginalPosition(
  map: RawSourceMap,
  genLine: number,
  genCol: number = 1
): OriginalPosition | null {
  if (!map.mappings) return null;
  const lines = map.mappings.split(';');
  const targetLineIdx = genLine - 1;
  const targetColIdx = Math.max(0, genCol - 1);
  if (targetLineIdx < 0 || targetLineIdx >= lines.length) return null;

  let sourceIndex = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIndex = 0;
  let bestMatch: (OriginalPosition & { genCol: number }) | null = null;

  for (let l = 0; l <= targetLineIdx; l++) {
    const lineStr = lines[l];
    if (!lineStr) continue;
    let currGenCol = 0;
    const segs = lineStr.split(',');
    for (const seg of segs) {
      if (!seg) continue;
      const d = decodeVLQ(seg);
      currGenCol += d[0];
      if (d.length >= 4) {
        sourceIndex += d[1];
        origLine += d[2];
        origCol += d[3];
        if (d.length >= 5) nameIndex += d[4];

        if (l === targetLineIdx) {
          if (currGenCol <= targetColIdx) {
            bestMatch = {
              source: map.sources ? map.sources[sourceIndex] : undefined,
              line: origLine + 1,
              column: origCol,
              name: d.length >= 5 && map.names ? map.names[nameIndex] : undefined,
              genCol: currGenCol,
            };
          } else if (!bestMatch) {
            bestMatch = {
              source: map.sources ? map.sources[sourceIndex] : undefined,
              line: origLine + 1,
              column: origCol,
              name: d.length >= 5 && map.names ? map.names[nameIndex] : undefined,
              genCol: currGenCol,
            };
            break;
          } else {
            break;
          }
        }
      }
    }
  }

  return bestMatch;
}

function decodeBase64Utf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

const sourceMapCache = new Map<string, { map: RawSourceMap; timestamp: number }>();

/**
 * Fetches the source map for a given module URL, parsing inline base64 source maps
 * generated by Vite dev server.
 */
export async function fetchSourceMapForUrl(url: string): Promise<RawSourceMap | null> {
  const cached = sourceMapCache.get(url);
  if (cached && Date.now() - cached.timestamp < 15000) {
    return cached.map;
  }

  try {
    let fetchUrl = url;
    if (typeof window !== 'undefined') {
      if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
        fetchUrl = fetchUrl.startsWith('/') ? fetchUrl : `/${fetchUrl}`;
      }
    }

    const nativeFetch =
      typeof window !== 'undefined' && (window as any).__component_preview_native_fetch__
        ? (window as any).__component_preview_native_fetch__
        : typeof fetch === 'function'
        ? fetch
        : null;

    if (!nativeFetch) return null;

    const resp = await nativeFetch(fetchUrl, {
      headers: { 'x-component-preview-internal': 'true' },
    });
    if (!resp.ok) return null;
    const code = await resp.text();

    const smMatch = code.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m);
    if (!smMatch) return null;

    const smUrl = smMatch[1].trim();
    let rawMap: RawSourceMap | null = null;

    if (smUrl.includes('base64,')) {
      const b64 = smUrl.substring(smUrl.indexOf('base64,') + 7);
      const jsonStr = decodeBase64Utf8(b64);
      rawMap = JSON.parse(jsonStr) as RawSourceMap;
    } else {
      let fullSmUrl = smUrl;
      if (typeof window !== 'undefined' && !smUrl.startsWith('http://') && !smUrl.startsWith('https://')) {
        fullSmUrl = new URL(smUrl, window.location.href).toString();
      }
      const smResp = await nativeFetch(fullSmUrl, {
        headers: { 'x-component-preview-internal': 'true' },
      });
      if (smResp.ok) {
        rawMap = (await smResp.json()) as RawSourceMap;
      }
    }

    if (rawMap) {
      sourceMapCache.set(url, { map: rawMap, timestamp: Date.now() });
      return rawMap;
    }
  } catch {}

  return null;
}

/**
 * Asynchronously resolves an ErrorLocation against inline or linked source maps,
 * mapping transpiled line and column back to the exact authoring JSX/TSX source location.
 */
export async function resolveExactLocation(
  location?: ErrorLocation
): Promise<ErrorLocation | undefined> {
  if (!location || location.originalResolved) {
    return location;
  }

  const url = location.rawUrl || location.filePath;
  if (!url) {
    return location;
  }

  try {
    const rawMap = await fetchSourceMapForUrl(url);
    if (!rawMap) {
      return location;
    }

    const pos = findOriginalPosition(rawMap, location.line, location.column);
    if (pos && typeof pos.line === 'number') {
      let mappedPath = location.filePath;
      let mappedName = location.fileName;

      if (pos.source) {
        const cleanSource = normalizeSourcePath(pos.source);
        mappedName = cleanSource.split('/').pop() || pos.source;
        if (location.filePath.includes('/')) {
          const dir = location.filePath.substring(0, location.filePath.lastIndexOf('/'));
          mappedPath = `${dir}/${mappedName}`;
        } else {
          mappedPath = cleanSource;
        }
      }

      return {
        filePath: mappedPath,
        fileName: mappedName,
        functionName: pos.name || location.functionName,
        line: pos.line,
        column: pos.column !== undefined ? pos.column + 1 : location.column,
        rawUrl: location.rawUrl,
        originalResolved: true,
      };
    }
  } catch {}

  return location;
}

/**
 * Asynchronously resolves all frames and primary location in a ParsedErrorInfo
 * using source maps.
 */
export async function resolveExactErrorInfo(info: ParsedErrorInfo): Promise<ParsedErrorInfo> {
  let primaryLocation = info.primaryLocation;
  if (primaryLocation && !primaryLocation.originalResolved) {
    primaryLocation = (await resolveExactLocation(primaryLocation)) || primaryLocation;
  }

  const userFrames = await Promise.all(
    info.userFrames.map(async (frame) => {
      if (frame.filePath && frame.line) {
        const dummyLoc: ErrorLocation = {
          filePath: frame.filePath,
          fileName: frame.fileName || frame.filePath,
          functionName: frame.functionName,
          line: frame.line,
          column: frame.column || 1,
          rawUrl: frame.rawUrl,
        };
        const resolved = await resolveExactLocation(dummyLoc);
        if (resolved && resolved.originalResolved) {
          return {
            ...frame,
            filePath: resolved.filePath,
            fileName: resolved.fileName,
            functionName: resolved.functionName,
            line: resolved.line,
            column: resolved.column,
          };
        }
      }
      return frame;
    })
  );

  return {
    ...info,
    primaryLocation,
    userFrames,
  };
}
