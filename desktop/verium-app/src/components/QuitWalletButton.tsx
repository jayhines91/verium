import { useState } from "react";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { tauriQuitWallet } from "@/lib/rpc/client";

export function QuitWalletButton() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quitting, setQuitting] = useState(false);

  const onQuit = async () => {
    setQuitting(true);
    try {
      await tauriQuitWallet();
    } catch {
      // The invoke can fail while the WebView tears down during app.exit().
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full justify-start gap-2 px-0 text-fg-muted hover:text-fg"
        onClick={() => setConfirmOpen(true)}
      >
        <Power className="h-3.5 w-3.5" />
        Quit wallet
      </Button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-md w-full rounded-lg border border-border bg-bg-panel p-6 space-y-4">
            <h4 className="text-lg font-semibold">Quit Vericonomy Wallet?</h4>
            <p className="text-sm text-fg-muted">
              This stops CPU mining and staking, shuts down veriumd and
              vericoind, locks your wallets, and closes the application.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmOpen(false)}
                disabled={quitting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={onQuit}
                disabled={quitting}
              >
                {quitting ? "Quitting…" : "Quit wallet"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
