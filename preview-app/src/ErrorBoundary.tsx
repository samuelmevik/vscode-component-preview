import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[Preview ErrorBoundary]', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.fallbackKey !== this.props.fallbackKey && this.state.hasError) {
      this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="preview-error-card">
          <div className="preview-error-header">
            <AlertCircle className="preview-error-icon" size={20} />
            <h3>Component Render Error</h3>
          </div>
          <div className="preview-error-message">
            {this.state.error?.message || 'An unknown error occurred while rendering the component.'}
          </div>
          {this.state.errorInfo?.componentStack && (
            <pre className="preview-error-stack">
              {this.state.errorInfo.componentStack}
            </pre>
          )}
          <button
            className="preview-retry-btn"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            <RefreshCw size={14} /> Retry Render
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
