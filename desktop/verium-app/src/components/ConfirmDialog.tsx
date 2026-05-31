import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirming) onCancel();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, confirming, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
      >
        <div className="border-b border-border px-5 py-3">
          <h2 id="confirm-dialog-title" className="text-base font-semibold">
            {title}
          </h2>
        </div>

        {message && (
          <p className="px-5 py-4 text-sm text-fg-muted">{message}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={confirming}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? "Removing…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
