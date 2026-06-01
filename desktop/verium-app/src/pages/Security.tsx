import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Lock, Shield, Smartphone } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { RecoveryPhraseWizard } from "@/components/RecoveryPhraseWizard";
import { RestoreFromPhraseForm } from "@/components/RestoreFromPhraseForm";
import { TwoFactorEnrollmentPanel } from "@/components/TwoFactorEnrollmentPanel";
import { useActiveCoin } from "@/lib/coin/context";
import {
  autoLockGetConfig,
  autoLockSetConfig,
  passkeyDisable,
  passkeyEnrollPin,
  passkeyStatus,
  PASSKEY_GATE_QUERY_KEY,
  recoveryApplyHdSeed,
  recoveryWalletIsHd,
  spendingControlsGet,
  spendingControlsSave,
  twoFactorDisable,
  twoFactorStatus,
  type AutoLockConfig,
  type SpendingControlsConfig,
} from "@/lib/security/client";

const totpInputClass =
  "h-8 w-32 rounded-md border border-border bg-bg-subtle px-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent focus:ring-1 focus:ring-accent/30";

const DEFAULT_AUTO_LOCK: AutoLockConfig = {
  enabled: false,
  idle_seconds: 900,
  lock_on_blur: false,
  lock_on_sleep: false,
};

const DEFAULT_SPENDING: SpendingControlsConfig = {
  allowlist_only: false,
  require_first_send_confirmation: true,
  clipboard_guard_enabled: true,
};

export function Security() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const [totpCode, setTotpCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [showPhraseRestore, setShowPhraseRestore] = useState(false);
  const [walletUnlockPass, setWalletUnlockPass] = useState("");

  const twoFa = useQuery({ queryKey: ["two-factor"], queryFn: twoFactorStatus });
  const passkey = useQuery({ queryKey: ["passkey"], queryFn: passkeyStatus });
  const autoLock = useQuery({ queryKey: ["auto-lock"], queryFn: autoLockGetConfig });
  const spending = useQuery({ queryKey: ["spending-controls"], queryFn: spendingControlsGet });
  const isHd = useQuery({
    queryKey: ["wallet-is-hd", coin],
    queryFn: () => recoveryWalletIsHd(coin),
  });

  const disable2fa = useMutation({
    mutationFn: (code: string) => twoFactorDisable(code),
    onSuccess: () => {
      setTotpCode("");
      queryClient.invalidateQueries({ queryKey: ["two-factor"] });
    },
  });
  const enrollPin = useMutation({
    mutationFn: () => passkeyEnrollPin(pin),
    onSuccess: async () => {
      setPin("");
      setConfirmPin("");
      await queryClient.invalidateQueries({ queryKey: ["passkey"] });
      await queryClient.invalidateQueries({ queryKey: PASSKEY_GATE_QUERY_KEY });
    },
  });
  const disablePin = useMutation({
    mutationFn: () => passkeyDisable(pin),
    onSuccess: async () => {
      setPin("");
      await queryClient.invalidateQueries({ queryKey: ["passkey"] });
      await queryClient.invalidateQueries({ queryKey: PASSKEY_GATE_QUERY_KEY });
    },
  });
  const applyHd = useMutation({
    mutationFn: ({
      phrase,
      unlockPassphrase,
    }: {
      phrase: string;
      unlockPassphrase?: string;
    }) =>
      recoveryApplyHdSeed(coin, phrase, undefined, unlockPassphrase),
    onSuccess: async () => {
      setWalletUnlockPass("");
      setShowRecovery(false);
      queryClient.setQueryData(["wallet-is-hd", coin], true);
      await queryClient.invalidateQueries({ queryKey: ["wallet-is-hd", coin] });
    },
  });

  const walletIsHd = isHd.data === true || applyHd.isSuccess;
  const pinEnrolled = passkey.data?.enabled === true;

  const saveAutoLock = async (patch: Partial<AutoLockConfig>) => {
    const current = { ...DEFAULT_AUTO_LOCK, ...autoLock.data };
    await autoLockSetConfig({ ...current, ...patch });
    queryClient.invalidateQueries({ queryKey: ["auto-lock"] });
  };

  const saveSpending = async (patch: Partial<SpendingControlsConfig>) => {
    const current = await spendingControlsGet();
    await spendingControlsSave({ ...current, ...patch });
    queryClient.invalidateQueries({ queryKey: ["spending-controls"] });
  };

  const autoLockCfg = { ...DEFAULT_AUTO_LOCK, ...autoLock.data };
  const spendingCfg = { ...DEFAULT_SPENDING, ...spending.data };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Security center</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Recovery phrase, app PIN, 2FA, spending controls, and auto-lock.
          Wallet.dat backups are in Settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" /> Recovery phrase (BIP39)
          </CardTitle>
          <CardDescription>
            {walletIsHd
              ? "Restore or rotate access using your 24-word phrase. wallet.dat backup is in Settings."
              : "Upgrade to HD to generate a recovery phrase."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!walletIsHd && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Non-HD wallet detected. Generate a phrase and upgrade to enable recovery.
            </div>
          )}
          {walletIsHd && (
            <p className="text-xs text-success">
              HD recovery is enabled. To restore keys from a phrase, use the form below
              (replaces wallet keys — back up wallet.dat first).
            </p>
          )}
          {!walletIsHd && !showRecovery && (
            <Button onClick={() => setShowRecovery(true)}>Set up recovery phrase</Button>
          )}
          {showRecovery && !walletIsHd && (
            <div className="flex flex-col gap-3">
              <input
                type="password"
                value={walletUnlockPass}
                onChange={(e) => setWalletUnlockPass(e.target.value)}
                placeholder="Wallet passphrase (required to unlock before upgrade)"
                className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
              />
              <RecoveryPhraseWizard
                onComplete={async (phrase) => {
                  await applyHd.mutateAsync({
                    phrase,
                    unlockPassphrase: walletUnlockPass || undefined,
                  });
                }}
              />
            </div>
          )}
          {walletIsHd && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowPhraseRestore((v) => !v)}
              >
                {showPhraseRestore ? "Hide" : "Restore from recovery phrase"}
              </Button>
              {showPhraseRestore && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                  <RestoreFromPhraseForm
                    onRestored={() => {
                      setShowPhraseRestore(false);
                      void queryClient.invalidateQueries({
                        queryKey: ["wallet-is-hd", coin],
                      });
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {applyHd.isPending && (
            <p className="text-xs text-fg-muted">Applying HD seed…</p>
          )}
          {applyHd.error && (
            <p className="text-xs text-danger">{String(applyHd.error)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-accent" /> Two-factor authentication
          </CardTitle>
          <CardDescription>
            When enabled, sends and sensitive actions require a TOTP code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge tone={twoFa.data?.enabled ? "success" : "neutral"}>
            {twoFa.data?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {!twoFa.data?.enabled && <TwoFactorEnrollmentPanel showStartButton />}
          {twoFa.data?.enabled && (
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Code to disable"
                className={totpInputClass}
              />
              <Button
                size="sm"
                variant="danger"
                onClick={() => disable2fa.mutate(totpCode)}
                disabled={disable2fa.isPending || totpCode.length < 6}
              >
                Disable 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" /> App unlock PIN
          </CardTitle>
          <CardDescription>
            PIN gate before the wallet UI opens. Restart the app after enrolling to
            test the lock screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge tone={pinEnrolled ? "success" : "neutral"}>
            {pinEnrolled ? "PIN enrolled" : "Not enrolled"}
          </Badge>
          {!pinEnrolled ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={12}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="6–12 digit PIN"
                  className="h-9 w-40 rounded border border-border px-3 text-sm"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={12}
                  value={confirmPin}
                  onChange={(e) =>
                    setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="Confirm PIN"
                  className="h-9 w-40 rounded border border-border px-3 text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => enrollPin.mutate()}
                  disabled={
                    pin.length < 6 || pin !== confirmPin || enrollPin.isPending
                  }
                >
                  {enrollPin.isPending ? "Enrolling…" : "Enroll PIN"}
                </Button>
              </div>
              {pin.length > 0 && confirmPin.length > 0 && pin !== confirmPin && (
                <p className="text-xs text-danger">PINs do not match.</p>
              )}
              {enrollPin.error && (
                <p className="text-xs text-danger">{String(enrollPin.error)}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={12}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="Current PIN"
                  className="h-9 w-40 rounded border border-border px-3 text-sm"
                />
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => disablePin.mutate()}
                  disabled={pin.length < 6 || disablePin.isPending}
                >
                  {disablePin.isPending ? "Removing…" : "Remove PIN"}
                </Button>
              </div>
              {disablePin.error && (
                <p className="text-xs text-danger">{String(disablePin.error)}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" /> Auto-lock
          </CardTitle>
          <CardDescription>
            Locks the chain wallet via RPC (passphrase required to unlock again).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoLockCfg.enabled}
              onChange={(e) => void saveAutoLock({ enabled: e.target.checked })}
              className="accent-accent"
            />
            Lock wallet after idle timeout
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoLockCfg.lock_on_blur}
              onChange={(e) => void saveAutoLock({ lock_on_blur: e.target.checked })}
              className="accent-accent"
            />
            Lock when app loses focus
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Idle timeout (minutes):</span>
            <input
              type="number"
              min={1}
              max={1440}
              disabled={!autoLockCfg.enabled}
              value={Math.round(autoLockCfg.idle_seconds / 60)}
              onChange={(e) =>
                void saveAutoLock({ idle_seconds: Number(e.target.value) * 60 })
              }
              className="h-8 w-20 rounded border border-border px-2 text-sm disabled:opacity-50"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spending controls</CardTitle>
          <CardDescription>
            Applied when you confirm a send from the Transactions page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spendingCfg.clipboard_guard_enabled}
              onChange={(e) =>
                void saveSpending({ clipboard_guard_enabled: e.target.checked })
              }
              className="accent-accent"
            />
            Clipboard hijack detection on send
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spendingCfg.require_first_send_confirmation}
              onChange={(e) =>
                void saveSpending({
                  require_first_send_confirmation: e.target.checked,
                })
              }
              className="accent-accent"
            />
            Extra confirmation for first send to new address
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spendingCfg.allowlist_only}
              onChange={(e) => void saveSpending({ allowlist_only: e.target.checked })}
              className="accent-accent"
            />
            Allowlist-only sends (address book send entries only)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Daily cap (VRM):</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={spendingCfg.daily_spend_cap_vrm ?? ""}
              onChange={(e) =>
                void saveSpending({
                  daily_spend_cap_vrm: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
              className="h-8 w-28 rounded border border-border px-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Daily cap (VRC):</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={spendingCfg.daily_spend_cap_vrc ?? ""}
              onChange={(e) =>
                void saveSpending({
                  daily_spend_cap_vrc: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
              className="h-8 w-28 rounded border border-border px-2"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
