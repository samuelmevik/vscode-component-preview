import React from 'react';
import { AlertCircle, RefreshCw, ExternalLink, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { parseErrorInfo, navigateToSource, ErrorLocation, resolveExactLocation } from './errorLocationParser';
import { reportRuntimeError } from './errorInterceptor';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackKey?: string;
  currentFilePath?: string;
  componentName?: string;
  componentStartLine?: number;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  resolvedLocation?: ErrorLocation;
  showFullStack: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, showFullStack: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[Preview ErrorBoundary]', error, errorInfo);
    try {
      reportRuntimeError(error, 'render', this.props.currentFilePath);
    } catch {}

    const parsed = parseErrorInfo(
      error,
      this.props.currentFilePath,
      this.props.componentStartLine || 1
    );
    if (parsed.primaryLocation && !parsed.primaryLocation.originalResolved) {
      resolveExactLocation(parsed.primaryLocation)
        .then((resolved) => {
          if (
            resolved &&
            (resolved.line !== parsed.primaryLocation?.line ||
              resolved.column !== parsed.primaryLocation?.column ||
              resolved.originalResolved)
          ) {
            this.setState({ resolvedLocation: resolved });
          }
        })
        .catch(() => {});
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.fallbackKey !== this.props.fallbackKey && this.state.hasError) {
      this.setState({ hasError: false, error: undefined, errorInfo: undefined, resolvedLocation: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error;
      const parsed = parseErrorInfo(
        error,
        this.props.currentFilePath,
        this.props.componentStartLine || 1
      );

      const targetLocation: ErrorLocation | undefined =
        this.state.resolvedLocation ||
        parsed.primaryLocation ||
        (this.props.currentFilePath
          ? {
              filePath: this.props.currentFilePath,
              fileName: this.props.currentFilePath.split(/[/\\]/).pop() || this.props.currentFilePath,
              functionName: this.props.componentName,
              line: this.props.componentStartLine || 1,
              column: 1,
              originalResolved: true,
            }
          : undefined);

      const targetLabel = targetLocation?.functionName
        ? `<${targetLocation.functionName} />`
        : this.props.componentName
        ? `<${this.props.componentName} />`
        : 'Source';

      return (
        <div className="preview-error-card">
          <div className="preview-error-header">
            <AlertCircle className="preview-error-icon" size={20} />
            <h3>Component Render Error</h3>
            {targetLocation && (
              <span className="preview-error-badge">
                {targetLocation.fileName}:{targetLocation.line}
              </span>
            )}
          </div>

          <div className="preview-error-message">
            {error?.message || 'An unknown error occurred while rendering the component.'}
          </div>

          {/* Primary Action: Click to Open Component Directly in VS Code */}
          {targetLocation && (
            <div className="preview-error-primary-action">
              <button
                className="preview-jump-btn"
                onClick={() => navigateToSource(targetLocation)}
                title={`Open ${targetLocation.filePath} at line ${targetLocation.line} in VS Code`}
              >
                <ExternalLink size={14} />
                <span>
                  Open {targetLabel} in Editor ({targetLocation.fileName}:{targetLocation.line})
                </span>
              </button>
              {this.props.currentFilePath &&
                targetLocation.filePath !== this.props.currentFilePath && (
                  <button
                    className="preview-jump-btn secondary"
                    onClick={() =>
                      navigateToSource({
                        filePath: this.props.currentFilePath!,
                        line: this.props.componentStartLine || 1,
                      })
                    }
                    title={`Open main component file ${this.props.currentFilePath}`}
                  >
                    <ExternalLink size={13} />
                    <span>
                      Open Main Component ({this.props.componentName ? `<${this.props.componentName} />` : 'File'})
                    </span>
                  </button>
                )}
            </div>
          )}

          {/* User Code Frames List */}
          {parsed.userFrames.length > 0 && (
            <div className="preview-error-frames">
              <div className="frames-heading">Stack Frames in Your Code:</div>
              <div className="frames-list">
                {parsed.userFrames.map((frame, idx) => (
                  <div key={idx} className="frame-item">
                    <span className="frame-fn">{frame.functionName || '(anonymous)'}</span>
                    <span className="frame-file">{frame.fileName}:{frame.line}</span>
                    <button
                      className="frame-jump-link"
                      onClick={() =>
                        navigateToSource({
                          filePath: frame.filePath!,
                          line: frame.line,
                          column: frame.column,
                        })
                      }
                      title={`Jump to ${frame.fileName}:${frame.line}`}
                    >
                      <ExternalLink size={11} /> Jump
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Full Stack Details */}
          <div className="preview-error-details-toggle">
            <button
              className="toggle-stack-btn"
              onClick={() => this.setState((prev) => ({ showFullStack: !prev.showFullStack }))}
            >
              {this.state.showFullStack ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>{this.state.showFullStack ? 'Hide Stack Details' : 'Show Stack Details'}</span>
            </button>
          </div>

          {this.state.showFullStack && (
            <div className="preview-error-stack-wrapper">
              {error?.stack && (
                <div className="stack-block">
                  <div className="stack-block-title">JavaScript Stack:</div>
                  <pre className="preview-error-stack">{error.stack}</pre>
                </div>
              )}
              {this.state.errorInfo?.componentStack && (
                <div className="stack-block">
                  <div className="stack-block-title">React Component Stack:</div>
                  <pre className="preview-error-stack">{this.state.errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          )}

          {/* Error Actions Row */}
          <div className="preview-error-actions">
            <button
              className="preview-retry-btn"
              onClick={() => this.setState({ hasError: false, error: undefined })}
            >
              <RefreshCw size={13} /> Retry Render
            </button>
            {this.props.onReset && (
              <button className="preview-reset-btn" onClick={this.props.onReset}>
                <RotateCcw size={13} /> Reset Component
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
