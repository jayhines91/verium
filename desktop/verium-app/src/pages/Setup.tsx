import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Circle,
  Cog,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  ShieldCheck,
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
import { coinQueryKey } from "@/lib/coin/profile";
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
import { recoveryApplyHdSeed } from "@/lib/security/client";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { isNodeReady, nodeStatusLabel } from "@/lib/node/status";
import { useIsTestNetwork } from "@/lib/network-mode";

type Step =
  | "welcome"
  | "daemon"
  | "wallet"
  | "recovery"
  | "bootstrap"
  | "done"
  | "advanced";

const STEPS: { id: Exclude<Step, "advanced">; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "daemon", label: "Start node" },
  { id: "wallet", label: "Wallet" },
  { id: "recovery", label: "Recovery" },
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
  const navigate = useNavigate();
  const isTestNetwork = useIsTestNetwork();
  const [step, setStep] = useState<Step>("welcome");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [datadirDraft, setDatadirDraft] = useState<string>("");
  const [walletAction, setWalletAction] = useState<WalletAction>("choose");

  const updatePrefs = useUserPreferences((s) => s.update);
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
    connected,
    walletInfo.isLoading,
    walletInfo.data,
    walletFile.data?.exists,
  );

  useEffect(() => {
    if (config.data && !datadirDraft) {
      setDatadirDraft(config.data.datadir);
    }
  }, [config.data, datadirDraft]);

  useEffect(() => {
    if (step !== "wallet") return;
    if (walletSetupMode === "ready") {
      setStep("bootstrap");
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
  }, [step, walletSetupMode, walletAction]);

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
    await updatePrefs({ setup_completed: true });
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-8 text-fg">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="!normal-case !tracking-normal !text-base">
            Set up Verium
          </CardTitle>
          <CardDescription>
            Three minutes — start the bundled node, create or import your
            wallet, optionally seed the chain.
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
                <span className="font-mono">veriumd</span> node — there is
                nothing else to install. If you already use Verium-Qt, your
                existing wallet and chain data in the same data folder will
                carry over — just unlock with your existing passphrase. You can
                also import a <span className="font-mono">wallet.dat</span>{" "}
                backup from another machine during setup.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FeatureTile
                  icon={<Cog className="h-4 w-4" />}
                  title="Auto-start node"
                  body="The wallet starts and stops veriumd when you open and close it."
                />
                <FeatureTile
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Encrypted wallet"
                  body="Strong passphrase, stored only inside wallet.dat."
                />
                <FeatureTile
                  icon={<HardDriveUpload className="h-4 w-4" />}
                  title="Import backup"
                  body="Restore wallet.dat from Verium-Qt or a saved backup."
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
                <p className="mt-1">{walletSetupModeLabel(walletSetupMode)}</p>
                {walletInfo.data && walletSetupMode === "needs_unlock" && (
                  <p className="mt-1 text-fg">
                    Balance: {walletInfo.data.balance.toFixed(8)} VRM
                    {walletInfo.data.txcount > 0
                      ? ` · ${walletInfo.data.txcount} transactions`
                      : ""}
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
                  Go back to <strong>Start node</strong> and connect to veriumd
                  before setting up your wallet.
                </div>
              )}

              {walletSetupMode === "needs_unlock" &&
                walletAction === "unlock" && (
                  <>
                    <WalletUnlockForm
                      title="Unlock your existing wallet"
                      description="Enter the passphrase from your previous Verium wallet. Your coins, addresses, and transaction history stay exactly as they are."
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
                        Restore a backup from Verium-Qt, this app, or another
                        computer.
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
                      onCreated={() => setStep("recovery")}
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
                Write down this 24-word phrase before continuing. It is the only
                way to recover your wallet if you lose your passphrase or
                computer.
              </p>
              <RecoveryPhraseWizard
                onComplete={(phrase) => {
                  void recoveryApplyHdSeed(coin, phrase).then(() =>
                    setStep("bootstrap"),
                  );
                }}
                onSkip={() => setStep("bootstrap")}
              />
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
