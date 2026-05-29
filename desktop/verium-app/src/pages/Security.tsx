import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  HardDrive,
  KeyRound,
  Lock,
  Shield,
  ShieldCheck,
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
import { TotpQrCode } from "@/components/TotpQrCode";
import { useActiveCoin } from "@/lib/coin/context";
import {
  auditLogExport,
  auditLogList,
  autoLockGetConfig,
  autoLockSetConfig,
  backupExportCloud,
  backupHealth,
  backupRunNow,
  backupSchedulerGetConfig,
  backupSchedulerSaveConfig,
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
  recoveryApplyHdSeed,
  recoveryWalletIsHd,
  slip39Combine,
  slip39Split,
  spendingControlsGet,
  spendingControlsSave,
  twoFactorConfirmEnrollment,
  twoFactorDisable,
  twoFactorPendingOtpauthUri,
  twoFactorStartEnrollment,
  twoFactorStatus,
  verifyInstallation,
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
  const [confirm2faError, setConfirm2faError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [savedPhrase, setSavedPhrase] = useState("");
  const [shamirShares, setShamirShares] = useState<string[]>([]);
  const [combineInput, setCombineInput] = useState("");

  const twoFa = useQuery({ queryKey: ["two-factor"], queryFn: twoFactorStatus });
  const pendingOtpauth = useQuery({
    queryKey: ["two-factor-pending-uri", twoFa.data?.secret_base32],
    queryFn: twoFactorPendingOtpauthUri,
    enabled: Boolean(!twoFa.data?.enabled && twoFa.data?.secret_base32),
  });
  const passkey = useQuery({ queryKey: ["passkey"], queryFn: passkeyStatus });
  const autoLock = useQuery({ queryKey: ["auto-lock"], queryFn: autoLockGetConfig });
  const audit = useQuery({ queryKey: ["audit-log"], queryFn: () => auditLogList(50) });
  const hw = useQuery({ queryKey: ["hw-wallets"], queryFn: hardwareWalletList });
  const ms = useQuery({ queryKey: ["multisig"], queryFn: multisigList });
  const spending = useQuery({ queryKey: ["spending-controls"], queryFn: spendingControlsGet });
  const backupH = useQuery({ queryKey: ["backup-health"], queryFn: backupHealth });
  const backupCfg = useQuery({ queryKey: ["backup-scheduler"], queryFn: backupSchedulerGetConfig });
  const isHd = useQuery({ queryKey: ["wallet-is-hd", coin], queryFn: () => recoveryWalletIsHd(coin) });
  const installVerify = useQuery({ queryKey: ["install-verify"], queryFn: verifyInstallation });

  const enroll2fa = useMutation({
    mutationFn: twoFactorStartEnrollment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["two-factor"] }),
  });
  const enrollmentSecret =
    enroll2fa.data?.secret_base32 ?? twoFa.data?.secret_base32 ?? null;
  const enrollmentOtpauth =
    enroll2fa.data?.otpauth_uri ?? pendingOtpauth.data ?? null;
  const showEnrollmentPanel =
    !twoFa.data?.enabled && Boolean(enrollmentSecret && enrollmentOtpauth);
  const confirm2fa = useMutation({
    mutationFn: ({ code, secret }: { code: string; secret: string }) =>
      twoFactorConfirmEnrollment(code, secret),
    onMutate: () => setConfirm2faError(null),
    onSuccess: async () => {
      setTotpCode("");
      setConfirm2faError(null);
      enroll2fa.reset();
      queryClient.setQueryData(
        ["two-factor"],
        (prev: Awaited<ReturnType<typeof twoFactorStatus>> | undefined) => ({
          ...(prev ?? {
            enabled: false,
            gated_actions: [],
            secret_base32: null,
          }),
          enabled: true,
          secret_base32: null,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["two-factor"] });
      await queryClient.invalidateQueries({ queryKey: ["two-factor-pending-uri"] });
    },
    onError: (err) => setConfirm2faError(String(err)),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkey"] }),
  });
  const disablePin = useMutation({
    mutationFn: () => passkeyDisable(pin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkey"] }),
  });
  const applyHd = useMutation({
    mutationFn: () => recoveryApplyHdSeed(coin, savedPhrase),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallet-is-hd", coin] }),
  });
  const runBackup = useMutation({ mutationFn: () => backupRunNow(coin) });
  const cloudBackup = useMutation({
    mutationFn: () => backupExportCloud(coin, cloudPassword),
  });
  const splitShamir = useMutation({
    mutationFn: () => slip39Split(savedPhrase, 2, 3),
    onSuccess: (r) => setShamirShares(r.shares.map((s) => s.share_text)),
  });
  const combineShamir = useMutation({
    mutationFn: () => slip39Combine(combineInput.split("\n").filter(Boolean)),
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
        </p>
      </div>

      {/* Installer verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" /> Installer verification
          </CardTitle>
        </CardHeader>
        <CardContent>
          {installVerify.data && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={installVerify.data.app_verified ? "success" : "warning"}>
                App {installVerify.data.app_verified ? "verified" : "unverified"}
              </Badge>
              <Badge tone={installVerify.data.sidecar_verified ? "success" : "warning"}>
                Sidecar {installVerify.data.sidecar_verified ? "verified" : "unverified"}
              </Badge>
              <p className="text-xs text-fg-muted">{installVerify.data.message}</p>
            </div>
          )}
        </CardContent>
      </Card>

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
            <RecoveryPhraseWizard
              onComplete={(phrase) => {
                setSavedPhrase(phrase);
                if (!isHd.data) applyHd.mutate();
              }}
            />
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
          {confirm2fa.isSuccess && twoFa.data?.enabled && (
            <p className="text-xs text-success">
              Two-factor authentication is enabled for sends, passphrase changes, and key exports.
            </p>
          )}
          {!twoFa.data?.enabled && (
            <>
              {!showEnrollmentPanel && (
                <Button size="sm" onClick={() => enroll2fa.mutate()} disabled={enroll2fa.isPending}>
                  Start enrollment
                </Button>
              )}
              {enroll2fa.error && (
                <p className="text-xs text-danger">{String(enroll2fa.error)}</p>
              )}
              {showEnrollmentPanel && enrollmentSecret && enrollmentOtpauth && (
                <div className="space-y-3 rounded-md border border-border bg-bg-subtle p-4 text-xs">
                  <TotpQrCode
                    otpauthUri={enrollmentOtpauth}
                    secretBase32={enrollmentSecret}
                  />
                  <p className="text-fg-muted">
                    Enter the 6-digit code from your app to confirm. Use the QR or manual key
                    shown here—do not start enrollment again or the code will change.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setConfirm2faError(null);
                    }}
                    placeholder="6-digit code"
                    className={totpInputClass}
                  />
                  {confirm2faError && (
                    <p className="text-danger">{confirm2faError}</p>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      if (totpCode.length < 6) {
                        setConfirm2faError("Enter the full 6-digit code from your authenticator.");
                        return;
                      }
                      confirm2fa.mutate({ code: totpCode, secret: enrollmentSecret });
                    }}
                    disabled={confirm2fa.isPending || totpCode.length < 6}
                  >
                    {confirm2fa.isPending ? "Confirming…" : "Confirm 2FA"}
                  </Button>
                  {enroll2fa.data?.recovery_codes && (
                    <details>
                      <summary className="cursor-pointer text-fg-muted">
                        Recovery codes (save these offline)
                      </summary>
                      <pre className="mt-1 text-fg">
                        {enroll2fa.data.recovery_codes.join("\n")}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </>
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
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="6+ digit PIN"
                className="h-9 w-40 rounded border border-border px-3 text-sm"
              />
              <Button size="sm" onClick={() => enrollPin.mutate()} disabled={pin.length < 6}>
                Enroll PIN
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Current PIN"
                className="h-9 w-40 rounded border border-border px-3 text-sm"
              />
              <Button size="sm" variant="danger" onClick={() => disablePin.mutate()}>
                Remove PIN
              </Button>
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

      {/* Backup health + Shamir */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-accent" /> Backup &amp; social recovery
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {backupH.data && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>Backups: {backupH.data.backup_count}</div>
              <div>
                Last:{" "}
                {backupH.data.last_backup_at
                  ? new Date(backupH.data.last_backup_at * 1000).toLocaleString()
                  : "never"}
              </div>
              <div>Scheduler: {backupH.data.scheduler_enabled ? "on (every 24h)" : "off"}</div>
              <div>Cloud: {backupH.data.cloud_configured ? "configured" : "not set"}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
              Run backup now
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const cfg = backupCfg.data ?? {
                  enabled: true,
                  daily_retention: 14,
                  monthly_retention: 12,
                  interval_hours: 24,
                };
                await backupSchedulerSaveConfig({ ...cfg, enabled: true });
                queryClient.invalidateQueries({ queryKey: ["backup-scheduler"] });
              }}
            >
              Enable scheduled backups
            </Button>
          </div>
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-sm font-medium">Encrypted cloud backup</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={cloudPassword}
                onChange={(e) => setCloudPassword(e.target.value)}
                placeholder="Separate backup password"
                className="h-9 flex-1 rounded border border-border px-3 text-sm"
              />
              <Button
                size="sm"
                disabled={!cloudPassword || cloudBackup.isPending}
                onClick={() => cloudBackup.mutate()}
              >
                Export
              </Button>
            </div>
            {cloudBackup.data && (
              <p className="mt-1 text-xs text-success">Saved to {cloudBackup.data}</p>
            )}
          </div>
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-sm font-medium">Shamir social recovery (2-of-3)</p>
            <Button
              size="sm"
              variant="secondary"
              disabled={!savedPhrase || splitShamir.isPending}
              onClick={() => splitShamir.mutate()}
            >
              Split recovery phrase
            </Button>
            {shamirShares.length > 0 && (
              <pre className="mt-2 max-h-32 overflow-auto rounded border border-border bg-bg-subtle p-2 text-[10px]">
                {shamirShares.join("\n")}
              </pre>
            )}
            <textarea
              rows={3}
              value={combineInput}
              onChange={(e) => setCombineInput(e.target.value)}
              placeholder="Paste 2+ shares to combine…"
              className="mt-2 w-full rounded border border-border bg-bg-subtle p-2 text-[10px]"
            />
            <Button
              size="sm"
              className="mt-2"
              onClick={() => combineShamir.mutate()}
              disabled={combineShamir.isPending}
            >
              Combine shares
            </Button>
            {combineShamir.data && (
              <p className="mt-1 text-xs text-success font-mono">{combineShamir.data}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Signed record of sensitive operations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const json = await auditLogExport();
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "vericonomy-audit-log.json";
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-panel text-fg-subtle">
                <tr>
                  <th className="px-3 py-1.5 text-left">Time</th>
                  <th className="px-3 py-1.5 text-left">Action</th>
                  <th className="px-3 py-1.5 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.slice().reverse().map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-1.5 whitespace-nowrap text-fg-muted">
                      {new Date(e.timestamp * 1000).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">{e.action}</td>
                    <td className="px-3 py-1.5 text-fg-muted">{e.detail}</td>
                  </tr>
                ))}
                {(!audit.data || audit.data.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-fg-subtle">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DumpPrivkeyCard />
    </div>
  );
}
