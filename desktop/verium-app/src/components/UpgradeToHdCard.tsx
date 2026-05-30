import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { RecoveryPhraseWizard } from "@/components/RecoveryPhraseWizard";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { recoveryApplyHdSeed, recoveryWalletIsHd } from "@/lib/security/client";
import { useQuery } from "@tanstack/react-query";

export function UpgradeToHdCard() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const [walletPassphrase, setWalletPassphrase] = useState("");
  const [showWizard, setShowWizard] = useState(false);

  const isHd = useQuery({
    queryKey: coinQueryKey(coin, "wallet-is-hd"),
    queryFn: () => recoveryWalletIsHd(coin),
  });

  const apply = useMutation({
    mutationFn: ({
      phrase,
      unlockPassphrase,
    }: {
      phrase: string;
      unlockPassphrase?: string;
    }) =>
      recoveryApplyHdSeed(coin, phrase, undefined, unlockPassphrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "wallet-is-hd") });
      setShowWizard(false);
      setWalletPassphrase("");
    },
  });

  if (isHd.data !== false) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Upgrade to HD wallet
        </CardTitle>
        <CardDescription>
          Enable BIP39 recovery phrase support. Back up wallet.dat first — this
          applies a new HD seed via sethdseed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!showWizard ? (
          <Button size="sm" onClick={() => setShowWizard(true)}>
            Generate recovery phrase &amp; upgrade
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="password"
              value={walletPassphrase}
              onChange={(e) => setWalletPassphrase(e.target.value)}
              placeholder="Wallet passphrase (to unlock before upgrade)"
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
            />
            <RecoveryPhraseWizard
              onComplete={(p) => {
                apply.mutate({
                  phrase: p,
                  unlockPassphrase: walletPassphrase || undefined,
                });
              }}
            />
          </div>
        )}
        {apply.isSuccess && (
          <p className="mt-2 text-xs text-success">{apply.data}</p>
        )}
        {apply.error && (
          <p className="mt-2 text-xs text-danger">{String(apply.error)}</p>
        )}
      </CardContent>
    </Card>
  );
}
