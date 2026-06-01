import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buildPaymentUri } from "@/lib/security/client";
import type { CoinId } from "@/lib/coin/profile";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";

interface QrCodeDisplayProps {
  coin: CoinId;
  address: string;
  amount?: number | null;
  label?: string;
  message?: string;
  size?: number;
}

export function QrCodeDisplay({
  coin,
  address,
  amount,
  label,
  message,
  size = 200,
}: QrCodeDisplayProps) {
  const [uri, setUri] = useState(address);
  const { copied: uriCopied, copy, reset: resetCopyFeedback } =
    useCopyToClipboard();

  useEffect(() => {
    void buildPaymentUri(
      coin,
      address,
      amount ?? undefined,
      label,
      message,
    ).then(setUri);
  }, [coin, address, amount, label, message]);

  useEffect(() => {
    resetCopyFeedback();
  }, [uri, resetCopyFeedback]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg border border-border bg-white p-3">
        <QRCodeSVG value={uri} size={size} level="M" includeMargin={false} />
      </div>
      <p className="max-w-xs break-all text-center text-[10px] text-fg-muted">
        {uri}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void copy(uri)}
          className={cn(
            uriCopied &&
              "border-success/40 bg-success/10 text-success hover:bg-success/15",
          )}
          aria-live="polite"
        >
          {uriCopied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy URI
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const w = window.open("", "_blank");
            if (!w) return;
            w.document.write(`
              <html><head><title>Payment Request</title></head>
              <body style="font-family:sans-serif;text-align:center;padding:2rem">
                <h2>Payment Request</h2>
                ${label ? `<p>${label}</p>` : ""}
                ${amount != null ? `<p><strong>${amount}</strong></p>` : ""}
                <p style="font-family:monospace;font-size:12px;word-break:break-all">${address}</p>
                <p style="font-size:11px;color:#666">${uri}</p>
              </body></html>
            `);
            w.print();
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>
    </div>
  );
}
