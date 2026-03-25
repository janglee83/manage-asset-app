/**
 * React error boundary for the main asset grid and its sub-tree.
 *
 * If any unhandled rendering exception bubbles up, the boundary catches it,
 * renders a friendly fallback panel, and logs the error to the toast store
 * so the user sees a notification even if the fallback doesn't make it obvious.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <AssetGrid />
 *   </ErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useErrorStore } from "../store/errorStore";

interface Props {
  children: ReactNode;
  /** Short label shown in the fallback — helps identify which panel crashed. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = `${error.message}\n${info.componentStack ?? ""}`;
    useErrorStore.getState().push(
      "error",
      `Render error${this.props.label ? ` in ${this.props.label}` : ""}`,
      detail,
      0, // never auto-dismiss — a render crash is serious
    );
    console.error("[ErrorBoundary]", error, info);
  }

  private reset = () => this.setState({ error: null });

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 h-full text-center text-slate-400">
        <AlertCircle size={32} className="text-red-400" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-slate-200">
            {this.props.label ?? "This panel"} encountered an error
          </p>
          <p className="text-xs text-slate-500 max-w-sm break-words">
            {this.state.error.message}
          </p>
        </div>
        <button
          onClick={this.reset}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 transition-colors"
        >
          <RefreshCw size={12} />
          Try again
        </button>
      </div>
    );
  }
}
