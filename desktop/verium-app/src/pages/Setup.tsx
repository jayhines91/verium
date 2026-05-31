import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Circle,
  Cog,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  ShieldCheck,
  Smartphone,
  Wallet as WalletIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey, COIN_PROFILES } from "@/lib/coin/profile";
import { coinSetupCompletePatch } from "@/lib/setup";
import {
  rpcGetConfig,
  rpcGetWalletInfo,
  rpcSetConfig,
  tauriDetectDaemon,
  tauriDetectDaemonRuntime,
  tauriEnsureFirstRun,
  tauriWalletFileStatus,
} from "@/lib/rpc/client";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  resolveWalletSetupMode,
  walletSetupModeLabel,
} from "@/lib/wallet-setup";
import { DaemonConnectionPanel } from "@/components/DaemonConnectionPanel";
import { BootstrapDialog } from "@/components/BootstrapDialog";
import { WalletCreateForm } from "@/components/WalletCreateForm";
import { WalletImportForm } from "@/components/WalletImportForm";
import { WalletUnlockForm } from "@/components/WalletUnlockForm";
import { RestoreFromPhraseForm } from "@/components/RestoreFromPhraseForm";
import { RecoveryPhraseWizard } from "@/components/RecoveryPhraseWizard";
import { TwoFactorEnrollmentPanel } from "@/components/TwoFactorEnrollmentPanel";
import {
  recoveryApplyHdSeed,
  recoveryWalletIsHd,
  twoFactorStatus,
} from "@/lib/security/client";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { isNodeReady, nodeStatusLabel } from "@/lib/node/status";
import { useIsTestNetwork } from "@/lib/network-mode";

type Step =
  | "welcome"
  | "daemon"
  | "wallet"
  | "recovery"
  | "twofa"
  | "bootstrap"
  | "done"
  | "advanced";

const STEPS: { id: Exclude<Step, "advanced">; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "daemon", label: "Start node" },
  { id: "wallet", label: "Wallet" },
  { id: "recovery", label: "Recovery" },
  { id: "twofa", label: "2FA" },
  { id: "bootstrap", label: "Sync" },
  { id: "done", label: "Finish" },
];

type WalletAction =
  | "choose"
  | "create"
  | "import"
  | "restore_phrase"
  | "unlock";

export function Setup() {
  const coin = useActiveCoin();
  const profile = COIN_PROFILES[coin];
  const navigate = useNavigate();
  const isTestNetwork = useIsTestNetwork();
  const [step, setStep] = useState<Step>("welcome");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [datadirDraft, setDatadirDraft] = useState<string>("");
  const [walletAction, setWalletAction] = useState<WalletAction>("choose");
  const [pendingPassphrase, setPendingPassphrase] = useState<string | null>(
    null,
  );
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const updatePrefs = useUserPreferences((s) => s.update);
  const prefs = useUserPreferences((s) => s.prefs);
  const config = useQuery({
    queryKey: coinQueryKey(coin, "daemon-config"),
    queryFn: () => rpcGetConfig(coin),
  });
  const binary = useQuery({
    queryKey: coinQueryKey(coin, "detect-daemon"),
    queryFn: () => tauriDetectDaemon(coin),
  });
  const runtime = useQuery({
    queryKey: coinQueryKey(coin, "detect-daemon-runtime"),
    queryFn: () => tauriDetectDaemonRuntime(coin),
    refetchInterval: step === "daemon" ? 4_000 : false,
    enabled: step === "daemon",
  });
  const walletFile = useQuery({
    queryKey: coinQueryKey(coin, "wallet-file-status"),
    queryFn: () => tauriWalletFileStatus(coin),
    refetchInterval: 4_000,
    enabled: step === "wallet" || step === "daemon",
  });

  const { data: nodeStatus, isConnecting } = useDaemonStatus(coin);
  const connected = isNodeReady(nodeStatus);

  const walletInfo = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    enabled: step === "wallet" && connected,
    retry: 1,
  });

  const walletSetupMode = resolveWalletSetupMode(
    coin,
    connected,
    walletInfo.isLoading,
    walletInfo.data,
    walletFile.data?.exists,
  );
  const walletUnlockAwaitingNode =
    walletAction === "unlock" &&
    walletSetupMode === "loading" &&
    walletFile.data?.exists === true;

  useEffect(() => {
    setStep("welcome");
    setWalletAction("choose");
    setBootstrapOpen(false);
    setPendingPassphrase(null);
    setRecoveryError(null);
  }, [coin]);

  useEffect(() => {
    if (config.data && !datadirDraft) {
      setDatadirDraft(config.data.datadir);
    }
  }, [config.data, datadirDraft]);

  const walletIsHd = useQuery({
    queryKey: coinQueryKey(coin, "wallet-is-hd"),
    queryFn: () => recoveryWalletIsHd(coin),
    enabled: connected && (step === "wallet" || step === "recovery"),
  });

  const twoFa = useQuery({
    queryKey: ["two-factor"],
    queryFn: twoFactorStatus,
    staleTime: 30_000,
    enabled: step !== "welcome" && step !== "advanced",
  });

  const advanceAfterChainWalletReady = () => {
    const twoFaEnabled =
      queryClient.getQueryData<Awaited<ReturnType<typeof twoFactorStatus>>>([
        "two-factor",
      ])?.enabled ?? twoFa.data?.enabled;
    setStep(twoFaEnabled ? "bootstrap" : "twofa");
  };

  const applyRecovery = useMutation({
    mutationFn: ({
      phrase,
      unlock,
    }: {
      phrase: string;
      unlock?: string;
    }) => recoveryApplyHdSeed(coin, phrase, undefined, unlock),
    onSuccess: async () => {
      setRecoveryError(null);
      setPendingPassphrase(null);
      await queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "wallet-is-hd"),
      });
      advanceAfterChainWalletReady();
    },
    onError: (err) => setRecoveryError(String(err)),
  });

  useEffect(() => {
    if (step === "twofa" && twoFa.data?.enabled) {
      setStep("bootstrap");
    }
  }, [step, twoFa.data?.enabled]);

  useEffect(() => {
    if (step !== "wallet") return;
    if (walletSetupMode === "ready" && walletIsHd.data === true) {
      if (twoFa.isLoading) return;
      advanceAfterChainWalletReady();
      return;
    }
    if (walletSetupMode === "needs_unlock") {
      setWalletAction("unlock");
    } else if (
      walletSetupMode === "needs_encrypt" &&
      walletAction === "unlock"
    ) {
      setWalletAction("choose");
    }
  }, [
    step,
    walletSetupMode,
    walletAction,
    walletIsHd.data,
    twoFa.data?.enabled,
    twoFa.isLoading,
  ]);

  const saveConfig = useMutation({
    mutationFn: (partial: Parameters<typeof rpcSetConfig>[1]) =>
      rpcSetConfig(coin, partial),
  });

  const ensureFirstRun = useMutation({
    mutationFn: () => tauriEnsureFirstRun(coin),
  });

  useEffect(() => {
    if (step !== "daemon") return;
    void ensureFirstRun.mutate();
  }, [step, coin]);

  useEffect(() => {
    if (step === "daemon" && connected) {
      setStep("wallet");
    }
  }, [step, connected]);

  const finish = async () => {
    await updatePrefs(coinSetupCompletePatch(coin, prefs));
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-8 text-fg">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="!normal-case !tracking-normal !text-base">
            Set up {profile.displayName}
          </CardTitle>
          <CardDescription>
            Start the bundled {profile.binaryName} node, set up your{" "}
            {profile.symbol} wallet and recovery phrase, enable app-wide 2FA,
            then optionally import a chain bootstrap.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {step !== "advanced" && (
            <ol className="flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
              {STEPS.map((s, idx) => {
                const currentIdx = STEPS.findIndex((x) => x.id === step);
                const reached = idx <= currentIdx;
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    {reached ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Circle className="h-3.5 w-3.5" />
                    )}
                    <span className={reached ? "text-fg" : ""}>{s.label}</span>
                    {idx < STEPS.length - 1 && (
                      <span className="text-fg-subtle">/</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {step === "welcome" && (
            <div className="flex flex-col gap-4 text-sm text-fg-muted">
              <p>
                Welcome. This wallet ships with a bundled{" "}
                <span className="font-mono">{profile.binaryName}</span> node —
                there is nothing else to install for {profile.displayName}. If
                you already use {profile.displayName}-Qt or an older{" "}
                {profile.symbol} wallet, your existing wallet and chain data in
                the same data folder will carry over — unlock with your existing
                passphrase. You can also import a{" "}
                <span className="font-mono">wallet.dat</span> backup from another
                machine during setup.
              </p>
              {coin === "vericoin" && (
                <p>
                  New to Vericoin? Choose <strong>Create new wallet</strong> on
                  the next steps. We only reuse an older wallet when one is
                  already on this computer.
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FeatureTile
                  icon={<Cog className="h-4 w-4" />}
                  title="Auto-start node"
                  body={`The wallet starts and stops ${profile.binaryName} when you open and close it.`}
                />
                <FeatureTile
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Encrypted wallet"
                  body="Strong passphrase, stored only inside wallet.dat."
                />
                <FeatureTile
                  icon={<HardDriveUpload className="h-4 w-4" />}
                  title="Import backup"
                  body={`Restore wallet.dat from ${profile.displayName}-Qt or a saved backup.`}
                />
                <FeatureTile
                  icon={<HardDriveDownload className="h-4 w-4" />}
                  title="Optional bootstrap"
                  body="Skip the slow P2P sync with the official snapshot."
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setStep("daemon")}>Continue</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("advanced")}
                >
                  Advanced setup
                </Button>
              </div>
            </div>
          )}

          {step === "daemon" && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="rounded-md border border-border bg-bg-subtle p-3">
                <div className="flex items-center gap-2 font-medium text-fg">
                  {(isConnecting || !connected) && (
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  )}
                  {connected && (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  )}
                  {nodeStatusLabel(nodeStatus)}
                </div>
                <p className="mt-2 text-xs text-fg-muted">
                  The wallet starts your node automatically. This may take a
                  minute while the blockchain index loads.
                </p>
                <div className="mt-2 break-all text-[11px] text-fg-subtle">
                  {config.data?.datadir}
                </div>
              </div>

              {runtime.data?.datadir_locked && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  Another Verium instance is using this data directory. Quit
                  Verium-Qt or any other node using the same folder, then reopen
                  the wallet.
                </div>
              )}

              {!binary.data?.manageable && !binary.isLoading && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  Node software is not available in this install. Re-download
                  from the official release page.
                </div>
              )}

              {connected && (
                <Button onClick={() => setStep("wallet")}>Continue</Button>
              )}
            </div>
          )}

          {step === "wallet" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
                {walletFile.data?.path && (
                  <div className="break-all text-[11px]">
                    {walletFile.data.path}
                  </div>
                )}
                <p className="mt-1">
                  {walletSetupModeLabel(coin, walletSetupMode)}
                </p>
                {walletInfo.data && walletSetupMode === "needs_unlock" && (
                  <p className="mt-1 text-fg">
                    Balance: {walletInfo.data.balance.toFixed(8)} {profile.symbol}
                    {walletInfo.data.txcount > 0
                      ? ` · ${walletInfo.data.txcount} transactions`
                      : ""}
                  </p>
                )}
                {walletFile.data?.legacy_wallet_detected &&
                  walletFile.data.legacy_wallet_path && (
                    <p className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-xs text-fg-muted">
                      Existing wallet found at{" "}
                      <span className="break-all font-mono text-fg">
                        {walletFile.data.legacy_wallet_path}
                      </span>
                      . Import it, or in Advanced setup set your data directory
                      to that folder. Otherwise create a new wallet for a fresh
                      start.
                    </p>
                  )}
                {walletFile.data?.is_new_install && (
                  <p className="mt-2 text-xs text-fg-muted">
                    No existing {profile.displayName} wallet was detected on this
                    Mac — you are setting up a new {profile.symbol} wallet.
                  </p>
                )}
              </div>

              {walletSetupMode === "loading" && (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking wallet…
                </div>
              )}

              {walletSetupMode === "offline" && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg-muted">
                  Go back to <strong>Start node</strong> and connect to{" "}
                  {profile.binaryName} before setting up your wallet.
                </div>
              )}

              {(walletSetupMode === "needs_unlock" || walletUnlockAwaitingNode) &&
                walletAction === "unlock" && (
                  <>
                    <WalletUnlockForm
                      title="Unlock your existing wallet"
                      description={`Enter the passphrase from your previous ${profile.displayName} wallet. Your coins, addresses, and transaction history stay exactly as they are.`}
                      submitDisabled={walletUnlockAwaitingNode}
                      submitDisabledMessage="Wallet is still loading in the node. Wait for checking to finish, then unlock."
                      onUnlocked={() => setStep("bootstrap")}
                    />
                    <div className="border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setWalletAction("import")}
                      >
                        Import a different wallet.dat instead
                      </Button>
                    </div>
                  </>
                )}

              {walletSetupMode === "needs_encrypt" &&
                walletAction === "choose" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setWalletAction("create")}
                      className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle p-4 text-left transition-colors hover:border-accent"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <WalletIcon className="h-4 w-4 text-accent" />
                        Create new wallet
                      </span>
                      <span className="text-xs text-fg-muted">
                        First time on this machine — choose a passphrase and
                        encrypt a fresh wallet.dat.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWalletAction("import")}
                      className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle p-4 text-left transition-colors hover:border-accent"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <HardDriveUpload className="h-4 w-4 text-accent" />
                        Import wallet.dat
                      </span>
                      <span className="text-xs text-fg-muted">
                        Restore a backup from {profile.displayName}-Qt, this
                        app, or another computer.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWalletAction("restore_phrase")}
                      className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle p-4 text-left transition-colors hover:border-accent sm:col-span-2"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <ShieldCheck className="h-4 w-4 text-accent" />
                        Restore from recovery phrase
                      </span>
                      <span className="text-xs text-fg-muted">
                        Enter your 24-word BIP39 mnemonic to recover an HD
                        wallet.
                      </span>
                    </button>
                  </div>
                )}

              {walletAction === "create" &&
                walletSetupMode === "needs_encrypt" && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="self-start"
                      onClick={() => setWalletAction("choose")}
                    >
                      Back
                    </Button>
                    <WalletCreateForm
                      onCreated={(_result, passphrase) => {
                        setPendingPassphrase(passphrase);
                        setStep("recovery");
                      }}
                      onAlreadyEncrypted={() => {
                        void walletInfo.refetch();
                      }}
                    />
                  </>
                )}

              {walletAction === "restore_phrase" && (
                <RestoreFromPhraseForm
                  onRestored={() => {
                    setWalletAction("unlock");
                    void walletInfo.refetch();
                  }}
                />
              )}

              {walletAction === "import" && (
                <WalletImportForm
                  onRestored={() => {
                    setWalletAction("unlock");
                    void walletInfo.refetch();
                    void walletFile.refetch();
                  }}
                  onCancel={
                    walletSetupMode === "needs_unlock"
                      ? () => setWalletAction("unlock")
                      : walletSetupMode === "needs_encrypt"
                        ? () => setWalletAction("choose")
                        : undefined
                  }
                />
              )}
            </div>
          )}

          {step === "recovery" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-fg">
                <ShieldCheck className="h-4 w-4 text-accent" />
                Save your recovery phrase
              </div>
              <p className="text-sm text-fg-muted">
                This phrase is separate from your wallet passphrase: it is the
                HD master key for your addresses. Save it on paper so you can
                restore on a new device if you lose your passphrase, computer, or{" "}
                <span className="font-mono text-xs">wallet.dat</span>. Vericonomy
                cannot look it up for you.
              </p>
              <RecoveryPhraseWizard
                onComplete={async (phrase) => {
                  await applyRecovery.mutateAsync({
                    phrase,
                    unlock: pendingPassphrase ?? undefined,
                  });
                }}
              />
              {applyRecovery.isPending && (
                <p className="flex items-center gap-2 text-xs text-fg-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying recovery seed to your wallet…
                </p>
              )}
              {recoveryError && (
                <p className="text-xs text-danger">{recoveryError}</p>
              )}
              {applyRecovery.isSuccess && (
                <p className="text-xs text-success">{applyRecovery.data}</p>
              )}
            </div>
          )}

          {step === "twofa" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-fg">
                <Smartphone className="h-4 w-4 text-accent" />
                Two-factor authentication (app-wide)
              </div>
              <p className="text-sm text-fg-muted">
                Protect sends, passphrase changes, and sensitive actions with a
                code from an authenticator app. This applies to{" "}
                <strong className="font-medium text-fg">both Verium and Vericoin</strong>
                — your {profile.symbol} passphrase and recovery phrase remain
                separate per chain.
              </p>
              <TwoFactorEnrollmentPanel
                autoStartEnrollment
                onEnabled={() => setStep("bootstrap")}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("bootstrap")}
                >
                  Skip for now
                </Button>
                {twoFa.data?.enabled && (
                  <Button size="sm" onClick={() => setStep("bootstrap")}>
                    Continue
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === "bootstrap" && isTestNetwork && (
            <div className="flex flex-col gap-3 text-sm text-fg-muted">
              <div className="flex items-center gap-2 text-fg">
                <HardDriveDownload className="h-4 w-4" />
                Binarytest network
              </div>
              <p>
                You are on the isolated Binary Chain (DACE) test network. There
                is no canonical snapshot CDN — the chain starts at genesis and
                grows as you mine VRM / stake VRC locally.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setStep("done")}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {step === "bootstrap" && !isTestNetwork && (
            <div className="flex flex-col gap-3 text-sm text-fg-muted">
              <div className="flex items-center gap-2 text-fg">
                <HardDriveDownload className="h-4 w-4" />
                Chain bootstrap (optional)
              </div>
              <p>
                Fresh installs sync much faster from the official chain snapshot
                than over P2P. The daemon downloads, extracts, and restarts
                automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setBootstrapOpen(true)}>
                  Import bootstrap now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("done")}
                >
                  Skip
                </Button>
              </div>
              <BootstrapDialog
                coin={coin}
                open={bootstrapOpen}
                onClose={() => {
                  setBootstrapOpen(false);
                  setStep("done");
                }}
              />
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2 text-success">
                <WalletIcon className="h-4 w-4" /> All set.
              </div>
              <p className="text-fg-muted">
                You're ready to go. Settings, wallet backup, and advanced
                options are available from the sidebar.
              </p>
              <Button size="sm" onClick={finish}>
                Open dashboard
              </Button>
            </div>
          )}

          {step === "advanced" && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-fg-muted">
                Point the app at an existing data directory or remote node. Most
                users should use the simple flow.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-fg-muted text-xs">Data directory</label>
                <div className="flex gap-2">
                  <input
                    value={datadirDraft}
                    onChange={(e) => setDatadirDraft(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-border bg-bg-subtle px-3 text-xs outline-none focus:border-accent"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const picked = await openDialog({
                        directory: true,
                        multiple: false,
                      });
                      if (typeof picked === "string") {
                        setDatadirDraft(picked);
                      }
                    }}
                  >
                    Browse
                  </Button>
                </div>
              </div>

              <DaemonConnectionPanel coin={coin} config={config.data} mode="settings" />

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await saveConfig.mutateAsync({ datadir: datadirDraft });
                    setStep("daemon");
                  }}
                  disabled={!datadirDraft || saveConfig.isPending}
                >
                  Save and go to start node
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("welcome")}
                >
                  Back to welcome
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureTile({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-subtle p-3 text-xs">
      <div className="flex items-center gap-1.5 text-fg">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-fg-muted">{body}</p>
    </div>
  );
}
