import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Circle,
  Cog,
  HardDriveDownload,
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
import {
  rpcGetConfig,
  rpcSetConfig,
  tauriDetectVeriumd,
  tauriEnsureDaemonConnected,
  tauriEnsureFirstRun,
  tauriStartDaemon,
  tauriWalletFileStatus,
} from "@/lib/rpc/client";
import { useUserPreferences } from "@/lib/user-preferences";
import { DaemonConnectionPanel } from "@/components/DaemonConnectionPanel";
import { BootstrapDialog } from "@/components/BootstrapDialog";
import { WalletCreateForm } from "@/components/WalletCreateForm";
import { WalletUnlockForm } from "@/components/WalletUnlockForm";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";

type Step =
  | "welcome"
  | "daemon"
  | "wallet"
  | "bootstrap"
  | "done"
  | "advanced";

const STEPS: { id: Exclude<Step, "advanced">; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "daemon", label: "Start node" },
  { id: "wallet", label: "Wallet" },
  { id: "bootstrap", label: "Sync" },
  { id: "done", label: "Finish" },
];

export function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [datadirDraft, setDatadirDraft] = useState<string>("");

  const updatePrefs = useUserPreferences((s) => s.update);
  const config = useQuery({ queryKey: ["daemon-config"], queryFn: rpcGetConfig });
  const binary = useQuery({
    queryKey: ["detect-veriumd"],
    queryFn: tauriDetectVeriumd,
  });
  const walletFile = useQuery({
    queryKey: ["wallet-file-status"],
    queryFn: tauriWalletFileStatus,
    refetchInterval: 4_000,
    enabled: step === "wallet" || step === "daemon",
  });

  useEffect(() => {
    if (config.data && !datadirDraft) {
      setDatadirDraft(config.data.datadir);
    }
  }, [config.data, datadirDraft]);

  const saveConfig = useMutation({
    mutationFn: rpcSetConfig,
  });

  const ensureFirstRun = useMutation({
    mutationFn: tauriEnsureFirstRun,
  });

  const startDaemon = useMutation({
    mutationFn: async () => {
      await ensureFirstRun.mutateAsync();
      await tauriStartDaemon();
      const result = await tauriEnsureDaemonConnected();
      return result;
    },
    onSuccess: (result) => {
      if (result.connected) setStep("wallet");
    },
  });

  const { data: nodeStatus } = useDaemonStatus();

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
            Three minutes — start the bundled node, create an encrypted wallet,
            optionally seed the chain.
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
                nothing else to install. Your data lives in a standard folder
                under your user profile, and your passphrase never leaves this
                machine.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FeatureTile
                  icon={<Cog className="h-4 w-4" />}
                  title="Auto-start node"
                  body="The wallet starts and stops the daemon for you."
                />
                <FeatureTile
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Encrypted wallet"
                  body="Strong passphrase, stored only inside wallet.dat."
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
              <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
                <div className="font-medium text-fg">Data directory</div>
                <div className="mt-0.5 break-all font-mono text-[11px]">
                  {config.data?.datadir ?? "—"}
                </div>
              </div>

              {binary.isLoading ? (
                <div className="flex items-center gap-2 text-fg-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for
                  veriumd…
                </div>
              ) : binary.data?.source === "sidecar" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-4 w-4" /> Bundled veriumd ready.
                  </div>
                  <div className="break-all rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[11px] text-fg-muted">
                    {binary.data.path}
                  </div>
                </div>
              ) : binary.data?.manageable ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg-muted">
                  Using an existing local veriumd — this build was not packaged
                  with the bundled sidecar. Found via{" "}
                  <span className="font-mono">{binary.data.source}</span>.
                </div>
              ) : (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  No veriumd available. This installer is incomplete — please
                  re-download from the releases page.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => startDaemon.mutate()}
                  disabled={startDaemon.isPending || !binary.data?.manageable}
                >
                  {startDaemon.isPending
                    ? "Starting…"
                    : "Start node and continue"}
                </Button>
                {nodeStatus?.connected && (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setStep("wallet")}
                  >
                    Node already running — continue
                  </Button>
                )}
              </div>

              {startDaemon.isPending && (
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Starting daemon and waiting for RPC…
                </div>
              )}
              {startDaemon.data && !startDaemon.data.connected && (
                <div className="text-xs text-danger">
                  {startDaemon.data.message}
                </div>
              )}
              {startDaemon.error && (
                <div className="text-xs text-danger">
                  {String(startDaemon.error)}
                </div>
              )}
            </div>
          )}

          {step === "wallet" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
                {walletFile.data?.exists ? (
                  <>
                    Found an existing wallet at{" "}
                    <span className="font-mono">{walletFile.data.path}</span>.
                  </>
                ) : (
                  <>
                    No wallet yet. We'll create one in{" "}
                    <span className="font-mono">
                      {walletFile.data?.path ?? "your data directory"}
                    </span>
                    .
                  </>
                )}
              </div>

              {walletFile.data?.exists ? (
                <WalletUnlockForm
                  title="Unlock existing wallet"
                  description="A wallet already exists in this data directory. Enter your passphrase to continue."
                  onUnlocked={() => setStep("bootstrap")}
                />
              ) : (
                <WalletCreateForm onCreated={() => setStep("bootstrap")} />
              )}
            </div>
          )}

          {step === "bootstrap" && (
            <div className="flex flex-col gap-3 text-sm text-fg-muted">
              <div className="flex items-center gap-2 text-fg">
                <HardDriveDownload className="h-4 w-4" />
                Chain bootstrap (optional)
              </div>
              <p>
                Fresh installs sync much faster from the official chain
                snapshot than over P2P. The daemon downloads, extracts, and
                restarts automatically.
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
                Point the app at an existing data directory or remote node.
                Most users should use the simple flow.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-fg-muted text-xs">
                  Data directory
                </label>
                <div className="flex gap-2">
                  <input
                    value={datadirDraft}
                    onChange={(e) => setDatadirDraft(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-border bg-bg-subtle px-3 font-mono text-xs outline-none focus:border-accent"
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

              <DaemonConnectionPanel
                config={config.data}
                mode="wizard"
                onConnected={() => setStep("wallet")}
              />

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
