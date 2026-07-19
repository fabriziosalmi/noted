import { Component, type ReactNode } from 'react';
import { translate } from '../lib/i18n';
import { useStore } from '../store/useStore';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      // Class component (no hooks): read the language directly from the store.
      const lang = useStore.getState().settings?.language;
      const tr = (key: Parameters<typeof translate>[0]) => translate(key, lang);
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-3 p-8">
          <p className="font-medium text-red-500">{tr('errBoundaryTitle')}</p>
          <p className="text-sm text-center max-w-sm">{tr('errBoundaryBody')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {tr('errBoundaryReload')}
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {tr('errBoundaryRetry')}
            </button>
          </div>
          {this.state.error?.message && (
            <details className="text-xs text-gray-400 mt-2 max-w-sm w-full">
              <summary className="cursor-pointer text-center">{tr('errBoundaryDetails')}</summary>
              <pre className="whitespace-pre-wrap mt-1 text-left">{this.state.error.message}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
