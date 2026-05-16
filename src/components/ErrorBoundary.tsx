import { Component, type ReactNode } from 'react';

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
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-3 p-8">
          <p className="font-medium text-red-500">Qualcosa è andato storto</p>
          <p className="text-sm text-center">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100"
          >
            Riprova
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
