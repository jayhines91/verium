import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { estimateSendFee } from "@/lib/send-fee-estimate";
import {
  formatRecipientLine,
  formatVrmAlternates,
  formatVrmAmount,
} from "@/lib/vrm-units";
import { cn, formatNumber } from "@/lib/utils";

const CONFIRM_DELAY_SEC = 3;

export interface SendConfirmRecipient {
  address: string;
  label?: string;
  amount: number;
}

interface SendConfirmDialogProps {
  open: boolean;
  recipients: SendConfirmRecipient[];
  feeRatePerKb: number;
  subtractFeeFromAmount: boolean;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SendConfirmDialog({
  open,
  recipients,
  feeRatePerKb,
  subtractFeeFromAmount,
  confirming = false,
  onConfirm,
  onCancel,
}: SendConfirmDialogProps) {
  const [secDelay, setSecDelay] = useState(CONFIRM_DELAY_SEC);

  useEffect(() => {
    if (!open) {
      setSecDelay(CONFIRM_DELAY_SEC);
      return;
    }

    setSecDelay(CONFIRM_DELAY_SEC);
    const timer = window.setInterval(() => {
      setSecDelay((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirming) onCancel();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, confirming, onCancel]);

  if (!open) return null;

  const sendAmount = recipients.reduce((sum, row) => sum + row.amount, 0);
  const feeEstimate = estimateSendFee(feeRatePerKb, recipients.length);
  const totalDebited = subtractFeeFromAmount
    ? sendAmount
    : sendAmount + feeEstimate.totalFee;
  const multiple = recipients.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-confirm-title"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
      >
        <div className="border-b border-border px-5 py-3">
          <h2 id="send-confirm-title" className="text-base font-semibold">
            Confirm send coins
          </h2>
        </div>

        <div className="flex gap-4 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <HelpCircle className="h-5 w-5" aria-hidden />
          </div>

          <div className="min-w-0 flex-1 space-y-3 text-sm">
            <div>
              <p className="font-medium text-fg">
                Are you sure you want to send?
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                Please, review your transaction.
              </p>
            </div>

            {!multiple ? (
              recipients[0] && (
                <p className="break-all text-xs leading-relaxed text-fg">
                  {formatRecipientLine(recipients[0])}
                </p>
              )
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-fg-muted">
                  {recipients.length} recipients — review each address and
                  amount before confirming.
                </p>
                <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border bg-bg-subtle/60 p-3">
                  {recipients.map((row) => (
                    <li
                      key={`${row.address}-${row.amount}`}
                      className="break-all text-[11px] leading-relaxed text-fg"
                    >
                      {formatRecipientLine(row)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <hr className="border-border" />

            <div className="space-y-1">
              <p className="font-semibold text-fg">Transaction fee</p>
              <p className="text-sm">
                {multiple ? (
                  <>
                    {formatVrmAmount(feeEstimate.feePerTx, 8)} per transaction (
                    {formatNumber(feeEstimate.sizeKb, 3)} kB) ·{" "}
                    <span className="font-semibold tabular-nums text-danger">
                      {formatVrmAmount(feeEstimate.totalFee, 8)} total
                    </span>
                  </>
                ) : (
                  <>
                    ({formatNumber(feeEstimate.sizeKb, 3)} kB):{" "}
                    <span className="font-semibold tabular-nums text-danger">
                      {formatVrmAmount(feeEstimate.feePerTx, 8)}
                    </span>
                  </>
                )}
              </p>
              <p className="text-[11px] text-fg-subtle">
                Estimated from the configured fee rate. Actual fee may differ
                slightly.
              </p>
            </div>

            <hr className="border-border" />

            <div>
              <p className="text-sm">
                <span className="font-semibold">Total Amount:</span>{" "}
                <span className="font-semibold tabular-nums">
                  {formatVrmAmount(totalDebited, 8)}
                </span>
              </p>
              <p className="mt-1 text-xs tabular-nums text-fg-muted">
                {formatVrmAlternates(totalDebited)}
              </p>
              {subtractFeeFromAmount && (
                <p className="mt-1 text-[11px] text-fg-subtle">
                  Fee will be subtracted from the amount sent.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={secDelay > 0 || confirming}
            onClick={onConfirm}
            className={cn(secDelay > 0 && "min-w-[5.5rem]")}
          >
            {confirming
              ? "Sending…"
              : secDelay > 0
                ? `Yes (${secDelay})`
                : "Yes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
