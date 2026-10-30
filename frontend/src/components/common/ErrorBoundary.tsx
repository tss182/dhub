import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#121317] text-zinc-300 p-8 font-sans">
          <div className="max-w-xl w-full bg-[#191a20] border border-rose-900/50 rounded-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertCircle className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-bold">Something went wrong</h1>
            </div>
            <p className="text-sm text-zinc-400">
              An unexpected error occurred while rendering the workspace.
            </p>
            <div className="p-3 bg-[#121317] rounded border border-[#272932] font-mono text-xs text-rose-300 overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.error?.toString()}
              {this.state.errorInfo?.componentStack}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer transition-colors shadow-sm"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

