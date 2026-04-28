import { Component, ErrorInfo, ReactNode } from 'react'
import { WindowControls } from './WindowControls'

interface Props {
  children?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    if (this.state.error) {
      navigator.clipboard.writeText(this.state.error.stack || this.state.error.message)
      // We could add a toast here, but since the app is crashed,
      // we'll just rely on the button text changing temporarily if we wanted to be fancy.
      // For now, simple clipboard is enough.
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-9999 flex flex-col bg-(--bg-gradient) overflow-hidden">
          <div className="absolute top-0 left-0 w-full z-20 header-glass">
            <WindowControls view="games" onNavigate={() => {}} updateInfo={null} />
          </div>

          <div className="flex-1 flex items-center justify-center p-8 relative">
            {/* Decorative background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-(--accent-glow) rounded-full blur-[120px] pointer-events-none opacity-50" />

            <div className="relative glass-surface-elevated max-w-2xl w-full rounded-2xl p-10 flex flex-col items-center gap-8 shadow-2xl animate-fade-slide">
              {/* Warning Icon Container */}
              <div className="relative">
                <div className="absolute inset-0 bg-red-500/20 rounded-full blur-2xl animate-pulse" />
                <div className="relative h-20 w-20 flex items-center justify-center bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
              </div>

              {/* Text Content */}
              <div className="text-center space-y-3">
                <h1 className="text-3xl font-black italic tracking-tighter uppercase">
                  Something went <span className="text-red-400">wrong</span>
                </h1>
                <p className="text-(--text-secondary) max-w-md mx-auto">
                  The application encountered an unexpected error and needs to restart. We've
                  captured the technical details below.
                </p>
              </div>

              {/* Error Details Recess */}
              <div className="w-full glass-recessed rounded-xl p-4 font-mono text-[11px] text-red-300/80 overflow-auto max-h-32 custom-scrollbar">
                <div className="font-bold mb-1 uppercase tracking-widest text-[9px] opacity-50">
                  Error Name
                </div>
                <div className="mb-3">{this.state.error?.name || 'Unknown Error'}</div>
                <div className="font-bold mb-1 uppercase tracking-widest text-[9px] opacity-50">
                  Message
                </div>
                <div className="whitespace-pre-wrap">
                  {this.state.error?.message || 'No message available'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="accent-action action-hover-scale flex-1 cursor-pointer font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 4v6h-6" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Reload Application
                </button>

                <button
                  type="button"
                  onClick={this.handleCopyError}
                  className="accent-surface-action action-hover-scale flex-1 cursor-pointer font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
