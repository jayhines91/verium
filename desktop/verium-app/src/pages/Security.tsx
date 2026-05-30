import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  KeyRound,
  Lock,
  Shield,
  Smartphone,
  Usb,
  Users,
} from "lucide-react";
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
import { HardwarePsbtSendCard } from "@/components/HardwarePsbtSendCard";
import { DumpPrivkeyCard } from "@/components/DumpPrivkeyCard";
import { TwoFactorEnrollmentPanel } from "@/components/TwoFactorEnrollmentPanel";
import { useActiveCoin } from "@/lib/coin/context";
import {
  autoLockGetConfig,
  autoLockSetConfig,
  hardwareWalletAdd,
  hardwareWalletImportXpub,
  hardwareWalletList,
  hardwareWalletRemove,
  multisigCreateAddress,
  multisigList,
  multisigSave,
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
  type HardwareWalletConfig,
  type MultisigWalletConfig,
  type SpendingControlsConfig,
} from "@/lib/security/client";

const totpInputClass =
  "h-8 w-32 rounded-md border border-border bg-bg-subtle px-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent focus:ring-1 focus:ring-accent/30";

export function Security() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const [totpCode, setTotpCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [walletUnlockPass, setWalletUnlockPass] = useState("");

  const twoFa = useQuery({ queryKey: ["two-factor"], queryFn: twoFactorStatus });
  const passkey = useQuery({ queryKey: ["passkey"], queryFn: passkeyStatus });
  const autoLock = useQuery({ queryKey: ["auto-lock"], queryFn: autoLockGetConfig });
  const hw = useQuery({ queryKey: ["hw-wallets"], queryFn: hardwareWalletList });
  const ms = useQuery({ queryKey: ["multisig"], queryFn: multisigList });
  const spending = useQuery({ queryKey: ["spending-controls"], queryFn: spendingControlsGet });
  const isHd = useQuery({ queryKey: ["wallet-is-hd", coin], queryFn: () => recoveryWalletIsHd(coin) });

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
    onSuccess: () => {
      setWalletUnlockPass("");
      queryClient.invalidateQueries({ queryKey: ["wallet-is-hd", coin] });
    },
  });

  const saveAutoLock = async (patch: Partial<AutoLockConfig>) => {
    const current = autoLock.data ?? {
      enabled: false,
      idle_seconds: 900,
      lock_on_blur: true,
      lock_on_sleep: true,
    };
    await autoLockSetConfig({ ...current, ...patch });
    queryClient.invalidateQueries({ queryKey: ["auto-lock"] });
  };

  const saveSpending = async (patch: Partial<SpendingControlsConfig>) => {
    const current = spending.data ?? {
      allowlist_only: false,
      require_first_send_confirmation: true,
      clipboard_guard_enabled: true,
    };
    await spendingControlsSave({ ...current, ...patch });
    queryClient.invalidateQueries({ queryKey: ["spending-controls"] });
  };

  const addHwWallet = async () => {
    const xpub = prompt("Paste hardware wallet xpub:");
    if (!xpub) return;
    const label = prompt("Label for this device:") ?? "Hardware wallet";
    const config: HardwareWalletConfig = {
      id: crypto.randomUUID(),
      vendor: "manual",
      label,
      xpub,
      derivation_path: "m/44'/0'/0'",
      created_at: Date.now() / 1000,
    };
    await hardwareWalletAdd(config);
    await hardwareWalletImportXpub(coin, xpub, label);
    queryClient.invalidateQueries({ queryKey: ["hw-wallets"] });
  };

  const createMultisig = async () => {
    const label = prompt("Multisig wallet label:") ?? "Multisig";
    const pk1 = prompt("Cosigner 1 pubkey (hex):");
    const pk2 = prompt("Cosigner 2 pubkey (hex):");
    if (!pk1 || !pk2) return;
    const addr = await multisigCreateAddress(coin, 2, [pk1, pk2], label);
    const wallet: MultisigWalletConfig = {
      id: crypto.randomUUID(),
      label,
      required_sigs: 2,
      total_cosigners: 2,
      cosigners: [
        { id: "1", label: "Cosigner 1", xpub: pk1, derivation_path: "" },
        { id: "2", label: "Cosigner 2", xpub: pk2, derivation_path: "" },
      ],
      multisig_address: addr,
      created_at: Date.now() / 1000,
    };
    await multisigSave(wallet);
    queryClient.invalidateQueries({ queryKey: ["multisig"] });
    alert(`Multisig address: ${addr}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Security center</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Recovery, 2FA, passkeys, hardware wallets, multisig, and spending controls.
          Wallet backups are in Settings.
        </p>
      </div>

      {/* Recovery phrase */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" /> Recovery phrase (BIP39)
          </CardTitle>
          <CardDescription>
            {isHd.data
              ? "Your wallet uses HD derivation with a recovery phrase."
              : "Upgrade to HD to enable mnemonic recovery."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!isHd.data && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Non-HD wallet detected. Generate a phrase and upgrade to enable recovery.
            </div>
          )}
          {!showRecovery ? (
            <Button onClick={() => setShowRecovery(true)}>Set up recovery phrase</Button>
          ) : (
            <div className="flex flex-col gap-3">
              {!isHd.data && (
                <input
                  type="password"
                  value={walletUnlockPass}
                  onChange={(e) => setWalletUnlockPass(e.target.value)}
                  placeholder="Wallet passphrase (required to unlock before upgrade)"
                  className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
                />
              )}
              <RecoveryPhraseWizard
                onComplete={(phrase) => {
                  if (!isHd.data) {
                    applyHd.mutate({
                      phrase,
                      unlockPassphrase: walletUnlockPass || undefined,
                    });
                  }
                }}
              />
            </div>
          )}
          {applyHd.isPending && (
            <p className="text-xs text-fg-muted">Applying HD seed…</p>
          )}
          {applyHd.error && (
            <p className="text-xs text-danger">{String(applyHd.error)}</p>
          )}
          {applyHd.isSuccess && (
            <p className="text-xs text-success">HD seed applied via sethdseed.</p>
          )}
        </CardContent>
      </Card>

      {/* 2FA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-accent" /> Two-factor authentication
          </CardTitle>
          <CardDescription>
            When enabled, every send requires a TOTP code, along with passphrase changes and
            key exports.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge tone={twoFa.data?.enabled ? "success" : "neutral"}>
            {twoFa.data?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {!twoFa.data?.enabled && (
            <TwoFactorEnrollmentPanel showStartButton />
          )}
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

      {/* Passkey / PIN */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" /> App unlock PIN
          </CardTitle>
          <CardDescription>PIN gate before the wallet UI opens.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge tone={passkey.data?.enabled ? "success" : "neutral"}>
            {passkey.data?.enabled ? "PIN enrolled" : "Not enrolled"}
          </Badge>
          {!passkey.data?.enabled ? (
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
                    pin.length < 6 ||
                    pin !== confirmPin ||
                    enrollPin.isPending
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
              {enrollPin.isSuccess && (
                <p className="text-xs text-success">
                  PIN enrolled. Enter it on the unlock screen to continue using the app.
                </p>
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

      {/* Auto-lock */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" /> Auto-lock
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoLock.data?.enabled ?? false}
              onChange={(e) => void saveAutoLock({ enabled: e.target.checked })}
              className="accent-accent"
            />
            Lock wallet after idle timeout
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoLock.data?.lock_on_blur ?? true}
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
              value={Math.round((autoLock.data?.idle_seconds ?? 900) / 60)}
              onChange={(e) =>
                void saveAutoLock({ idle_seconds: Number(e.target.value) * 60 })
              }
              className="h-8 w-20 rounded border border-border px-2 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Spending controls */}
      <Card>
        <CardHeader>
          <CardTitle>Spending controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spending.data?.clipboard_guard_enabled ?? true}
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
              checked={spending.data?.require_first_send_confirmation ?? true}
              onChange={(e) =>
                void saveSpending({ require_first_send_confirmation: e.target.checked })
              }
              className="accent-accent"
            />
            Extra confirmation for first send to new address
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spending.data?.allowlist_only ?? false}
              onChange={(e) => void saveSpending({ allowlist_only: e.target.checked })}
              className="accent-accent"
            />
            Allowlist-only sends (address book only)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Daily cap (VRM):</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={spending.data?.daily_spend_cap_vrm ?? ""}
              onChange={(e) =>
                void saveSpending({
                  daily_spend_cap_vrm: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="h-8 w-28 rounded border border-border px-2"
            />
          </div>
        </CardContent>
      </Card>

      {/* Hardware wallets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb className="h-4 w-4 text-accent" /> Hardware wallets
          </CardTitle>
          <CardDescription>
            Trezor, Ledger, Coldcard via xpub import + PSBT signing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Configured: {hw.data?.length ?? 0} device(s). Import xpub from Trezor, Ledger, or Coldcard.
          </p>
          {hw.data?.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs">
              <span>{w.label} ({w.vendor})</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void hardwareWalletRemove(w.id).then(() =>
                    queryClient.invalidateQueries({ queryKey: ["hw-wallets"] }),
                  );
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => void addHwWallet()}>
            Import hardware wallet xpub
          </Button>
        </CardContent>
      </Card>

      <HardwarePsbtSendCard />

      {/* Multisig */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" /> Multisig wallets
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ms.data?.map((w) => (
            <div key={w.id} className="rounded border border-border px-3 py-2 text-xs">
              <div className="font-medium">{w.label}</div>
              <div className="text-fg-muted">{w.multisig_address ?? "—"}</div>
              <div className="text-fg-subtle">
                {w.required_sigs}-of-{w.total_cosigners}
              </div>
            </div>
          ))}
          <Button size="sm" onClick={() => void createMultisig()}>
            Create 2-of-2 multisig
          </Button>
        </CardContent>
      </Card>

      <DumpPrivkeyCard />
    </div>
  );
}
