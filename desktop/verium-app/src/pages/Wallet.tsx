import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WalletUnlockForm } from "@/components/WalletUnlockForm";
import { rpcGetWalletInfo } from "@/lib/rpc/client";
import {
  formatUnlockedUntil,
  isWalletEncrypted,
  isWalletLocked,
  isWalletUnlocked,
  normalizeUnlockDuration,
  UNLOCK_DURATION_OPTIONS,
} from "@/lib/wallet-unlock";
import { useUserPreferences } from "@/lib/user-preferences";
import { cn, formatNumber, formatVrm } from "@/lib/utils";

export function Wallet() {
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
    refetchInterval: 5_000,
  });

  const locked = isWalletLocked(wallet.data);
  const encrypted = isWalletEncrypted(wallet.data);
  const unlocked = isWalletUnlocked(wallet.data);
  const unlockedUntil = wallet.data?.unlocked_until ?? 0;
  const durationSeconds = normalizeUnlockDuration(
    prefs.wallet_unlock_duration_seconds,
  );

  if (wallet.isLoading) {
    return (
      <div className="py-10 text-center text-sm text-fg-muted">
        Loading wallet…
      </div>
    );
  }

  if (!wallet.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wallet unavailable</CardTitle>
          <CardDescription>
            Connect to your node and ensure a wallet is loaded.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (locked) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Immature</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">
                {formatVrm(wallet.data.immature_balance, 4)}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                from recently mined blocks
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="py-6">
            <WalletUnlockForm
              title="Unlock your wallet"
              description="Enter your passphrase to view balances, receive addresses, and mine. Your passphrase is never stored — only the unlock duration preference is remembered."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Spendable balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.balance, 4)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unconfirmed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.unconfirmed_balance, 4)}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              incoming payments still confirming
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Immature</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.immature_balance, 4)}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              from recently mined blocks
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Encryption and unlock state. Passphrase is never stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Status:</span>
            {!encrypted ? (
              <Badge tone="warning">Unencrypted</Badge>
            ) : unlocked ? (
              <Badge tone="success">
                Unlocked {formatUnlockedUntil(unlockedUntil)}
              </Badge>
            ) : (
              <Badge tone="neutral">Locked</Badge>
            )}
          </div>
          {encrypted && unlocked && (
            <>
              <p className="text-xs text-fg-subtle">
                Your wallet stays unlocked for the duration below while you use
                the app. Sending still requires an unlocked wallet.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-fg-muted">
                  Remember unlock duration
                </label>
                {UNLOCK_DURATION_OPTIONS.map((option) => {
                  const active = durationSeconds === option.seconds;
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                        active
                          ? "border-accent bg-accent/10"
                          : "border-border bg-bg-subtle hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="wallet-unlock-duration-pref"
                        checked={active}
                        onChange={() =>
                          void updatePrefs({
                            wallet_unlock_duration_seconds: option.seconds,
                          })
                        }
                        className="mt-0.5 accent-accent"
                      />
                      <span
                        className={
                          option.warning ? "text-warning" : undefined
                        }
                      >
                        {option.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="text-xs text-fg-subtle">
          {`Keypool size: ${formatNumber(wallet.data.keypoolsize ?? 0)}`}
        </CardFooter>
      </Card>
    </div>
  );
}
