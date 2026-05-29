import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcWalletUnlock } from "@/lib/rpc/client";
import { passkeyStatus } from "@/lib/security/client";
import {
  rpcUnlockTimeoutSeconds,
  shouldUnlockMintingOnly,
} from "@/lib/wallet-unlock";
import { cn } from "@/lib/utils";

interface WalletUnlockFormProps {
  title?: string;
  description?: string;
  onUnlocked?: () => void;
  mintingOnly?: boolean;
  className?: string;
}

export function WalletUnlockForm({
  title = "Unlock wallet",
  description = "Enter your wallet passphrase to continue. Your passphrase is never stored.",
  onUnlocked,
  mintingOnly = false,
  className,
}: WalletUnlockFormProps) {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const passkey = useQuery({ queryKey: ["passkey"], queryFn: passkeyStatus });
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unlock = useMutation({
    mutationFn: async () => {
      await rpcWalletUnlock(
        coin,
        passphrase,
        rpcUnlockTimeoutSeconds(),
        shouldUnlockMintingOnly(coin, mintingOnly) ? true : undefined,
      );
    },
    onSuccess: () => {
      setPassphrase("");
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "getwalletinfo"),
      });
      onUnlocked?.();
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
          <Lock className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
          {mintingOnly && coin === "vericoin" && (
            <p className="mt-1 text-xs text-fg-subtle">
              Stake-only unlock — coins stay locked for sending until you unlock
              fully.
            </p>
          )}
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (passphrase) unlock.mutate();
        }}
      >
        {passkey.data?.enabled && (
          <p className="text-xs text-fg-subtle">
            App PIN is enrolled — use the PIN gate at launch. Enter your wallet
            passphrase here to unlock signing and sending.
          </p>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <label className="text-fg-muted">Passphrase</label>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="h-10 rounded-md border border-border bg-bg-subtle px-3 text-sm text-fg outline-none focus:border-accent"
            placeholder="Wallet passphrase"
          />
        </div>

        {error && <div className="text-xs text-danger">{error}</div>}

        <Button
          type="submit"
          disabled={!passphrase || unlock.isPending}
          className="self-start"
        >
          {unlock.isPending ? "Unlocking…" : "Unlock wallet"}
        </Button>
      </form>
    </div>
  );
}
