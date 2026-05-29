import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Monitor,
  Moon,
  Shield,
  Sun,
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
import { ExternalLinkButton } from "@/components/ExternalLinkButton";
import { DaemonConnectionPanel } from "@/components/DaemonConnectionPanel";
import { WalletBackupCard } from "@/components/WalletBackupCard";
import { VeriumConfEditorCard } from "@/components/VeriumConfEditorCard";
import { NetworkModeCard } from "@/components/NetworkModeCard";
import { useTheme } from "@/hooks/useTheme";
import {
  ALL_COINS,
  coinQueryKey,
  getCoinProfile,
  type CoinId,
} from "@/lib/coin/profile";
import { useEnabledCoins } from "@/lib/coin/context";
import { clearStakingStoppedByUser } from "@/hooks/useAutoStake";
import { clearMiningStoppedByUser } from "@/lib/mining-session";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  rpcGetConfig,
  tauriCheckForUpdates,
  tauriDetectDaemon,
  tauriRestartDaemon,
  tauriStartDaemon,
  tauriStopDaemon,
} from "@/lib/rpc/client";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  fetchCpuTopology,
  maxMiningThreads,
  optimizedMiningThreads,
} from "@/lib/mining-opt";
import { MiningThreadControls } from "@/components/MiningThreadControls";
import {
  playBlockMinedSound,
  unlockBlockMinedAudio,
} from "@/lib/block-mined-sound";
import {
  playReceivedVrmSound,
  unlockReceivedVrmAudio,
} from "@/lib/received-vrm-sound";
import {
  DEFAULT_ADDRESS_EXPLORER_TEMPLATE,
  DEFAULT_BLOCK_EXPLORER_TEMPLATE,
  DEFAULT_TX_EXPLORER_TEMPLATE,
  DOCS_DOWNLOADS,
} from "@/lib/verium-links";

export function Settings() {
  const enabledCoins = useEnabledCoins();
  const [daemonCoin, setDaemonCoin] = useState<CoinId>("verium");
  const config = useQuery({
    queryKey: coinQueryKey(daemonCoin, "daemon-config"),
    queryFn: () => rpcGetConfig(daemonCoin),
  });
  const start = useMutation({ mutationFn: () => tauriStartDaemon(daemonCoin) });
  const stop = useMutation({ mutationFn: () => tauriStopDaemon(daemonCoin) });
  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(daemonCoin),
  });
  const updates = useMutation({ mutationFn: tauriCheckForUpdates });

  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const binary = useQuery({
    queryKey: coinQueryKey(daemonCoin, "detect-daemon"),
    queryFn: () => tauriDetectDaemon(daemonCoin),
    enabled: advancedOpen,
  });

  const topology = useQuery({
    queryKey: ["cpu-topology"],
    queryFn: fetchCpuTopology,
    staleTime: 60_000,
  });
  const autoAdjustThreads = prefs.auto_adjust_mine_threads !== false;
  const suggestedThreads = optimizedMiningThreads(topology.data);
  const maxThreads = maxMiningThreads(topology.data);
  const logicalCpus = topology.data?.logicalCpus;

  const handleAutoAdjustChange = (checked: boolean) => {
    const updates: Partial<typeof prefs> = {
      auto_adjust_mine_threads: checked,
    };
    if (!checked && topology.data) {
      updates.auto_mine_threads = optimizedMiningThreads(topology.data);
    }
    void updatePrefs(updates);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            Security center
          </CardTitle>
          <CardDescription>
            Two-factor authentication, recovery phrase, hardware wallets,
            backups, spending controls, and audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/security"
            className="inline-flex h-8 items-center justify-center rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent/90"
          >
            Open security settings
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how the desktop UI renders. <strong>System</strong> follows
            your OS appearance setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSegmented value={themeMode} onChange={setThemeMode} />
        </CardContent>
      </Card>

      <WalletBackupCard />

      <NetworkModeCard />

      <Card>
        <CardHeader>
          <CardTitle>Chains</CardTitle>
          <CardDescription>
            Enable or disable Verium and Vericoin in the wallet UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.verium_enabled !== false}
              onChange={(e) =>
                void updatePrefs({ verium_enabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Verium (VRM) — mining</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.vericoin_enabled !== false}
              onChange={(e) =>
                void updatePrefs({ vericoin_enabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Vericoin (VRC) — staking</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Alerts while the wallet app is open. Bursts of many incoming
            transactions are grouped into one summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.notify_on_vrm_received !== false}
              onChange={(e) => {
                const checked = e.target.checked;
                void unlockReceivedVrmAudio();
                void updatePrefs({ notify_on_vrm_received: checked });
                if (checked) void playReceivedVrmSound();
              }}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Notify when VRM is received (toast + sound)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.notify_on_vrc_received !== false}
              onChange={(e) =>
                void updatePrefs({ notify_on_vrc_received: e.target.checked })
              }
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Notify when VRC is received</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staking</CardTitle>
          <CardDescription>
            Automatically start Vericoin staking when the app opens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.auto_stake_on_open === true}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) clearStakingStoppedByUser();
                void updatePrefs({ auto_stake_on_open: checked });
              }}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Auto-stake on open</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mining</CardTitle>
          <CardDescription>
            Automatically start the built-in CPU miner when the app opens.
            Requires a synced node and an unlocked wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.auto_mine_on_open === true}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) clearMiningStoppedByUser();
                void updatePrefs({ auto_mine_on_open: checked });
              }}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Auto-mine on open</span>
          </label>
          <MiningThreadControls
            autoAdjust={autoAdjustThreads}
            manualThreads={prefs.auto_mine_threads ?? 2}
            suggestedThreads={suggestedThreads}
            maxThreads={maxThreads}
            logicalCpus={logicalCpus}
            onAutoAdjustChange={handleAutoAdjustChange}
            onManualThreadsChange={(threads) =>
              void updatePrefs({ auto_mine_threads: threads })
            }
          />
          {prefs.auto_mine_on_open && (
            <p className="text-xs text-fg-subtle">
              Auto-mine retries every 10 seconds until the node is synced and
              the wallet is unlocked on the Wallet or Mining page.
            </p>
          )}
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={prefs.play_sound_on_block_mined === true}
              onChange={(e) => {
                const checked = e.target.checked;
                void unlockBlockMinedAudio();
                void updatePrefs({ play_sound_on_block_mined: checked });
                if (checked) void playBlockMinedSound();
              }}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>Play chime when this wallet finds a block</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>
            Compares the bundled releases manifest with the CDN VERSION_VRM.json
            feed and picks the newer one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => updates.mutate()}
              disabled={updates.isPending}
            >
              {updates.isPending ? "Checking…" : "Check for updates"}
            </Button>
            {updates.data && (
              <span className="text-xs text-fg-muted">
                {updates.data.update_available
                  ? `Update available: ${updates.data.latest}`
                  : `Up to date (${updates.data.current})`}
              </span>
            )}
            {updates.error && (
              <span className="text-xs text-danger">
                {String(updates.error)}
              </span>
            )}
          </div>
          {updates.data && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
              <div className="flex flex-wrap gap-4">
                <span>
                  <span className="text-fg-subtle">CDN: </span>
                  {updates.data.cdn_version ?? "unavailable"}
                </span>
                <span>
                  <span className="text-fg-subtle">Manifest: </span>
                  {updates.data.manifest_version ?? "unavailable"}
                </span>
                <span>
                  <span className="text-fg-subtle">Source: </span>
                  {updates.data.source}
                </span>
              </div>
              {(updates.data.download_url ||
                updates.data.release_notes_url) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {updates.data.download_url && (
                    <ExternalLinkButton
                      href={updates.data.download_url}
                      size="sm"
                    >
                      Download update
                    </ExternalLinkButton>
                  )}
                  {updates.data.release_notes_url && (
                    <ExternalLinkButton
                      href={updates.data.release_notes_url}
                      size="sm"
                      variant="ghost"
                    >
                      Release notes
                    </ExternalLinkButton>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <VeriumConfEditorCard coin={daemonCoin} />

      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <CardTitle className="flex items-center gap-2">
            {advancedOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Advanced
          </CardTitle>
          <CardDescription>
            Daemon lifecycle, RPC endpoint, data directory, explorer URLs. Most
            users should never need these.
          </CardDescription>
        </CardHeader>
        {advancedOpen && (
          <CardContent className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Daemon lifecycle</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => start.mutate()}
                  disabled={start.isPending}
                >
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => restart.mutate()}
                  disabled={restart.isPending}
                >
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => stop.mutate()}
                  disabled={stop.isPending}
                >
                  Stop
                </Button>
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Daemon connection</h3>
              <div className="flex flex-wrap gap-2">
                {ALL_COINS.filter((c) => enabledCoins.includes(c)).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={daemonCoin === c ? "primary" : "secondary"}
                    onClick={() => setDaemonCoin(c)}
                  >
                    {getCoinProfile(c).symbol}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-fg-muted">
                Configure RPC and data directory for{" "}
                {getCoinProfile(daemonCoin).displayName}.
              </p>
              <DaemonConnectionPanel
                coin={daemonCoin}
                config={config.data}
                mode="settings"
              />
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">
                {getCoinProfile(daemonCoin).displayName} core binary
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-fg-muted">Status:</span>
                {binary.data?.manageable ? (
                  <Badge tone="success">
                    {binary.data.source === "sidecar"
                      ? "Bundled sidecar"
                      : `Found (${binary.data.source})`}
                  </Badge>
                ) : (
                  <Badge tone="warning">Not detected</Badge>
                )}
              </div>
              {binary.data?.path && (
                <div className="truncate rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
                  {binary.data.path}
                </div>
              )}
              {!binary.data?.manageable && (
                <ExternalLinkButton href={DOCS_DOWNLOADS}>
                  Download Verium core
                </ExternalLinkButton>
              )}
              <p className="text-xs text-fg-subtle">
                Override with the{" "}
                <span className="font-mono">VERIUMD_PATH</span> environment
                variable, place the binary next to this app, or install via the
                official downloads page.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Explorer integration</h3>
              <p className="text-xs text-fg-muted">
                URL templates used when opening transactions, blocks, and
                addresses on the official explorer. Defaults follow the active
                chain (VRM → explorer-vrm, VRC → explorer-vrc). Use{" "}
                <span className="font-mono">%s</span> as the placeholder.
              </p>
              <Field
                label="Transaction URL"
                value={prefs.explorer_tx_url_template}
                onChange={(v) =>
                  void updatePrefs({ explorer_tx_url_template: v })
                }
                placeholder={DEFAULT_TX_EXPLORER_TEMPLATE}
                mono
              />
              <Field
                label="Block URL"
                value={
                  prefs.explorer_block_url_template ??
                  DEFAULT_BLOCK_EXPLORER_TEMPLATE
                }
                onChange={(v) =>
                  void updatePrefs({ explorer_block_url_template: v })
                }
                placeholder={DEFAULT_BLOCK_EXPLORER_TEMPLATE}
                mono
              />
              <Field
                label="Address URL"
                value={
                  prefs.explorer_address_url_template ??
                  DEFAULT_ADDRESS_EXPLORER_TEMPLATE
                }
                onChange={(v) =>
                  void updatePrefs({ explorer_address_url_template: v })
                }
                placeholder={DEFAULT_ADDRESS_EXPLORER_TEMPLATE}
                mono
              />
            </section>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

interface ThemeOption {
  value: ThemeMode;
  label: string;
  Icon: typeof Monitor;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

function ThemeSegmented({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => Promise<void> | void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-md border border-border bg-bg-subtle p-1"
    >
      {THEME_OPTIONS.map(({ value: optionValue, label, Icon }) => {
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => void onChange(optionValue)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:bg-bg-panel hover:text-fg",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  readOnly,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="text-fg-muted">{label}</label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "h-9 rounded-md border border-border bg-bg-subtle px-3 outline-none focus:border-accent " +
          (mono ? "text-xs " : "text-sm ") +
          (readOnly ? "opacity-70" : "")
        }
      />
    </div>
  );
}
