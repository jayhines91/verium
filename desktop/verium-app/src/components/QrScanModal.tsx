import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { parsePaymentUri } from "@/lib/security/client";

interface QrScanModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (address: string, amount?: number) => void;
}

export function QrScanModal({ open, onClose, onScan }: QrScanModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !videoRef.current) return;

    setError(null);
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        void (async () => {
          try {
            const parsed = await parsePaymentUri(result.data);
            onScan(parsed.address, parsed.amount ?? undefined);
            onClose();
          } catch {
            // Plain address fallback
            if (result.data.length > 20) {
              onScan(result.data.trim());
              onClose();
            }
          }
        })();
      },
      { highlightScanRegion: true, preferredCamera: "environment" },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => {
      setError("Camera unavailable. Paste the address manually instead.");
    });

    return () => {
      void scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [open, onClose, onScan]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Scan QR code</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <video ref={videoRef} className="w-full rounded-lg bg-black" />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
