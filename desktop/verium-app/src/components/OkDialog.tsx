import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface OkDialogProps {
  open: boolean;
  title: string;
  message: string;
  okLabel?: string;
  onOk: () => void;
}

/** Modal with a single acknowledge button (no cancel). */
export function OkDialog({
  open,
  title,
  message,
  okLabel = "OK",
  onOk,
}: OkDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") onOk();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOk]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOk();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ok-dialog-title"
        aria-describedby="ok-dialog-message"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-warning/40 bg-bg-panel shadow-2xl"
      >
        <div className="border-b border-border px-5 py-3">
          <h2 id="ok-dialog-title" className="text-base font-semibold text-fg">
            {title}
          </h2>
        </div>
        <p id="ok-dialog-message" className="px-5 py-4 text-sm text-fg-muted">
          {message}
        </p>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" size="sm" onClick={onOk}>
            {okLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
