import { useEffect } from "react";
import { X } from "lucide-react";
import { useToastStore, type ToastItem } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const ms = toast.durationMs ?? 6_000;
    const timer = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(timer);
  }, [toast.durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm",
        toast.tone === "success"
          ? "border-success/40 bg-bg-panel/95"
          : "border-border bg-bg-panel/95",
      )}
    >
      <div
        className={cn(
          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
          toast.tone === "success" ? "bg-success" : "bg-accent",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{toast.title}</div>
        {toast.description && (
          <div className="mt-0.5 text-xs text-fg-muted">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(100vw-2rem,24rem)] flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={() => dismiss(toast.id)}
        />
      ))}
    </div>
  );
}
