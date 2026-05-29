import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Clipboard, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { tauriDiagnosticBundle } from "@/lib/rpc/client";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    copied: false,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error, info);
  }

  reset = () => {
    this.setState({ error: null, componentStack: null, copied: false });
  };

  copyDiagnostics = async () => {
    const { error, componentStack } = this.state;
    let bundle: Record<string, unknown> = {
      message: error?.message,
      stack: error?.stack,
      componentStack,
    };
    try {
      const diag = await tauriDiagnosticBundle("verium");
      bundle = { ...bundle, ...diag };
    } catch {
      // Diagnostic command may not be available if Tauri itself died.
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { error, componentStack, copied } = this.state;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8 text-fg">
        <div className="w-full max-w-xl space-y-4 rounded-xl border border-danger/30 bg-bg-panel p-6 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-danger">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Something went wrong</h1>
              <p className="mt-1 text-sm text-fg-muted">
                The wallet UI hit an unexpected error. Your funds and daemon are
                unaffected. You can try again, or send us a diagnostic bundle so
                we can fix it.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-[11px] text-fg-muted">
            {error.message}
          </div>

          {componentStack && (
            <details className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
              <summary className="cursor-pointer text-fg">Stack trace</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px] text-fg-muted">
                {componentStack}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={this.reset}>
              <RefreshCcw className="h-3.5 w-3.5" /> Try again
            </Button>
            <Button variant="secondary" onClick={this.copyDiagnostics}>
              <Clipboard className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy diagnostic bundle"}
            </Button>
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Reload wallet
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
