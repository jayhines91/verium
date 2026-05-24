import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  rpcSetConfig,
  tauriDetectDaemon,
  tauriDetectWslDatadirs,
  tauriEnsureDaemonConnected,
  tauriGetWslRestartHint,
  tauriRestartDaemon,
  tauriRestartWslVeriumd,
  tauriSetupRpcCredentials,
  tauriStartDaemon,
  tauriTestRpcConnection,
  type DaemonConfig,
  type DaemonConfigPartial,
  type RpcTestResult,
  type WslDatadirCandidate,
} from "@/lib/rpc/client";
import { coinQueryKey, type CoinId } from "@/lib/coin/profile";

interface DaemonConnectionPanelProps {
  coin: CoinId;
  config: DaemonConfig | undefined;
  mode?: "settings" | "wizard";
  onConnected?: () => void;
}

export function DaemonConnectionPanel({
  coin,
  config,
  mode = "settings",
  onConnected,
}: DaemonConnectionPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DaemonConfigPartial>({});
  const [rpcPassword, setRpcPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [testResult, setTestResult] = useState<RpcTestResult | null>(null);
  const [generatedCreds, setGeneratedCreds] = useState<{
    user: string;
    password: string;
  } | null>(null);
  const [wslCandidates, setWslCandidates] = useState<WslDatadirCandidate[]>(
    [],
  );
  const [wslRestartCmd, setWslRestartCmd] = useState<string | null>(null);

  const binary = useQuery({
    queryKey: coinQueryKey(coin, "detect-daemon"),
    queryFn: () => tauriDetectDaemon(coin),
  });

  useEffect(() => {
    if (config) {
      setDraft({
        datadir: config.datadir,
        rpc_host: config.rpc_host,
        rpc_port: config.rpc_port,
        chain: config.chain,
        rpc_user: config.rpc_user ?? "",
      });
      setRpcPassword("");
      setPasswordTouched(false);
    }
  }, [config]);

  useEffect(() => {
    setPasswordTouched(false);
    setRpcPassword("");
  }, [draft.datadir]);

  const partialWithPassword = (): DaemonConfigPartial => ({
    ...draft,
    rpc_password:
      passwordTouched && rpcPassword.trim() ? rpcPassword.trim() : undefined,
  });

  const test = useMutation({
    mutationFn: () => tauriTestRpcConnection(coin, partialWithPassword()),
    onSuccess: (result) => {
      setTestResult(result);
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: coinQueryKey(coin, "daemon-status"),
        });
        onConnected?.();
      }
    },
  });

  const save = useMutation({
    mutationFn: () => rpcSetConfig(coin, partialWithPassword()),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-config"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  const setupCreds = useMutation({
    mutationFn: () => tauriSetupRpcCredentials(coin, partialWithPassword()),
    onSuccess: (result) => {
      setGeneratedCreds({
        user: result.rpc_user,
        password: result.rpc_password,
      });
      setDraft((d) => ({
        ...d,
        datadir: result.config.datadir,
        rpc_user: result.rpc_user,
      }));
      setRpcPassword(result.rpc_password);
      setPasswordTouched(false);
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-config"),
      });
      setTimeout(() => test.mutate(), 5500);
    },
  });

  const start = useMutation({ mutationFn: () => tauriStartDaemon(coin) });
  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      setTimeout(() => test.mutate(), 2500);
    },
  });
  const restartWsl = useMutation({
    mutationFn: () => {
      const datadir = draft.datadir ?? config?.datadir;
      if (!datadir) throw new Error("Set a data directory first");
      return tauriRestartWslVeriumd(datadir);
    },
    onSuccess: () => {
      setTimeout(() => test.mutate(), 2500);
    },
  });

  const findWsl = useMutation({
    mutationFn: tauriDetectWslDatadirs,
    onSuccess: (candidates) => setWslCandidates(candidates),
  });

  async function useWslDatadir(uncPath: string) {
    setDraft((d) => ({ ...d, datadir: uncPath }));
    setWslRestartCmd(await tauriGetWslRestartHint(uncPath));
  }

  async function applyWslAndSetup(uncPath: string) {
    await useWslDatadir(uncPath);
    const partial = { ...partialWithPassword(), datadir: uncPath };
    await rpcSetConfig(coin, partial);
    const creds = await tauriSetupRpcCredentials(coin, partial);
    setGeneratedCreds({ user: creds.rpc_user, password: creds.rpc_password });
    setRpcPassword(creds.rpc_password);
    setDraft((d) => ({ ...d, datadir: uncPath, rpc_user: creds.rpc_user }));
    void queryClient.invalidateQueries({ queryKey: ["daemon-config"] });
    setTimeout(() => test.mutate(), 5500);
  }

  const isUnauthorized =
    testResult?.message.includes("unauthorized") ||
    testResult?.message.includes("invalid RPC credentials");

  const veriumdFound = binary.data?.manageable === true;
  const wslRuntime = binary.data?.runtime === "wsl";
  const usingWslDatadir = (draft.datadir ?? "").toLowerCase().includes("wsl.localhost");
  const credsInConf = testResult?.creds_in_conf ?? config?.rpc_password_set;

  useEffect(() => {
    if (mode !== "wizard" || !config?.datadir) return;
    void (async () => {
      try {
        await tauriEnsureDaemonConnected(coin);
        test.mutate();
      } catch {
        test.mutate();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when wizard opens with config
  }, [mode, config?.datadir]);

  return (
    <div className="flex flex-col gap-4">
      {mode === "wizard" && (
        <p className="text-sm text-fg-muted">
          Connect the app to your local <span className="font-mono">veriumd</span>.
          If the daemon runs in WSL, set the data directory to its folder on Windows
          (for example{" "}
          <span className="font-mono text-xs">
            \\wsl.localhost\Ubuntu\root\verium-main-dev
          </span>
          ).
        </p>
      )}

      {!veriumdFound && (
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">No veriumd found.</span> Install
          Verium core on Windows or build it in WSL under{" "}
          <span className="font-mono">~/verium/src/veriumd</span>, then use{" "}
          <strong>Test connection</strong>.
        </div>
      )}

      {wslRuntime && usingWslDatadir && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          WSL node detected at{" "}
          <span className="font-mono">{binary.data?.wsl_path}</span>. The app
          can start and restart it for you — no manual commands needed.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Data directory"
          value={draft.datadir ?? ""}
          onChange={(v) => setDraft({ ...draft, datadir: v })}
          mono
          action={
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={async () => {
                const picked = await openDialog({
                  directory: true,
                  multiple: false,
                });
                if (typeof picked === "string") {
                  setDraft({ ...draft, datadir: picked });
                }
              }}
            >
              Browse
            </Button>
          }
        />
        <Field
          label="Chain"
          value={draft.chain ?? "main"}
          onChange={(v) => setDraft({ ...draft, chain: v })}
        />
        <Field
          label="RPC host"
          value={draft.rpc_host ?? "127.0.0.1"}
          onChange={(v) => setDraft({ ...draft, rpc_host: v })}
        />
        <Field
          label="RPC port"
          value={String(draft.rpc_port ?? "33987")}
          onChange={(v) =>
            setDraft({ ...draft, rpc_port: Number(v) || undefined })
          }
        />
        <Field
          label="RPC user"
          value={draft.rpc_user ?? ""}
          onChange={(v) => setDraft({ ...draft, rpc_user: v })}
          placeholder="verium"
        />
        <Field
          label="RPC password"
          value={rpcPassword}
          onChange={(v) => {
            setRpcPassword(v);
            setPasswordTouched(true);
          }}
          type="password"
          placeholder={
            config?.rpc_password_set || config?.cookie_path
              ? "Leave blank to use verium.conf / .cookie"
              : ""
          }
        />
        {testResult?.ok && (
          <div className="md:col-span-2 text-xs text-success">
            Connection saved — these settings load automatically next time you open
            the wallet.
          </div>
        )}
        {config?.cookie_path && (
          <div className="md:col-span-2 text-xs text-fg-subtle">
            Cookie file:{" "}
            <span className="font-mono">{config.cookie_path}</span>
          </div>
        )}
        {testResult?.conf_path && (
          <div className="md:col-span-2 text-xs text-fg-subtle">
            Config: <span className="font-mono">{testResult.conf_path}</span>
            {testResult.creds_in_conf ? " · rpcuser/rpcpassword present" : ""}
          </div>
        )}
      </div>

      {generatedCreds && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          Wrote RPC login to <span className="font-mono">verium.conf</span> (user{" "}
          <span className="font-mono">{generatedCreds.user}</span>).{" "}
          {veriumdFound
            ? "Click Restart daemon so veriumd reloads the config."
            : "Use Restart WSL veriumd below (does not need RPC — force-kills the old process)."}
        </div>
      )}

      {testResult?.likely_datadir_mismatch && !usingWslDatadir && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-xs text-warning">
          <div className="mb-2 font-medium">WSL node detected on port 33987</div>
          <p className="mb-2">
            The running <span className="font-mono">veriumd</span> is probably using
            a WSL data directory, not{" "}
            <span className="font-mono">AppData\Roaming\Verium</span>. Click{" "}
            <strong>Find WSL datadir</strong> below.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => findWsl.mutate()}
              disabled={findWsl.isPending}
            >
              {findWsl.isPending ? "Searching…" : "Find WSL datadir"}
            </Button>
          </div>
          {wslCandidates.length > 0 && (
            <ul className="mt-3 space-y-2">
              {wslCandidates.map((c) => (
                <li
                  key={c.unc_path}
                  className="rounded border border-warning/20 bg-bg/40 px-2 py-2"
                >
                  <div className="font-mono text-[11px]">{c.unc_path}</div>
                  <div className="mt-1 text-fg-subtle">
                    {c.distro}
                    {c.has_blocks_dir ? " · blocks/" : ""}
                    {c.has_verium_conf ? " · verium.conf" : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void applyWslAndSetup(c.unc_path)}
                    >
                      Use + create RPC login
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void useWslDatadir(c.unc_path)}
                    >
                      Use path only
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {findWsl.isSuccess && wslCandidates.length === 0 && (
            <p className="mt-2">
              No WSL Verium folders found. Set the path manually (often{" "}
              <span className="font-mono">
                \\wsl.localhost\Ubuntu\root\verium-main-dev
              </span>
              ).
            </p>
          )}
        </div>
      )}

      {wslRestartCmd && !wslRuntime && (
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
          <div className="mb-1 font-medium text-fg">
            Restart veriumd in WSL (from repo root)
          </div>
          <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-fg-muted">
            {wslRestartCmd}
          </code>
          <p className="mt-2 text-fg-subtle">
            Run in PowerShell or WSL, then click <strong>Test connection</strong>.
          </p>
        </div>
      )}

      {testResult?.rpc_credentials_stale && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-xs text-warning">
          <div className="mb-1 font-medium">
            verium.conf is newer than the running WSL veriumd
          </div>
          <p>
            The daemon only reads <span className="font-mono">rpcuser</span>/
            <span className="font-mono">rpcpassword</span> at startup. Restart
            it to apply the credentials in your config file.
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => restartWsl.mutate()}
            disabled={restartWsl.isPending || !draft.datadir}
          >
            {restartWsl.isPending ? "Restarting…" : "Restart veriumd in WSL"}
          </Button>
        </div>
      )}

      {usingWslDatadir && isUnauthorized && !testResult?.rpc_credentials_stale && (
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-3 text-xs text-fg-muted">
          <div className="mb-1 font-medium text-fg">WSL datadir set — next steps</div>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Clear the RPC password field (leave blank) and click{" "}
              <strong>Test connection</strong> — the app will use{" "}
              <span className="font-mono">.cookie</span> from the running daemon.
            </li>
            <li>
              Or restart WSL <span className="font-mono">veriumd</span> (command
              above) so it loads <span className="font-mono">rpcuser</span>/
              <span className="font-mono">rpcpassword</span>.
            </li>
          </ol>
        </div>
      )}

      {testResult?.likely_datadir_mismatch && usingWslDatadir && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Still unauthorized with the WSL path. Clear the password field and test
          again (cookie auth), or restart veriumd using the command above.
        </div>
      )}

      {testResult && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            testResult.warming_up
              ? "border-warning/30 bg-warning/10 text-warning"
              : testResult.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning"
          }`}
        >
          {testResult.ok && !testResult.warming_up ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="flex flex-col gap-1">
            <span>
              {testResult.warming_up
                ? testResult.message.replace(/^rpc error -?\d+:\s*/i, "")
                : testResult.message}
            </span>
            <span className="text-fg-subtle">
              Auth: {testResult.auth_method}
              {testResult.cookie_present ? " · cookie present" : ""}
              {testResult.blocks != null ? ` · block #${testResult.blocks}` : ""}
            </span>
            {testResult.hint && !testResult.likely_datadir_mismatch && (
              <span className="text-fg-subtle">{testResult.hint}</span>
            )}
          </div>
        </div>
      )}

      {isUnauthorized && !testResult?.likely_datadir_mismatch && (
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-3 text-sm text-fg-muted">
          <div className="mb-2 font-medium text-fg">Quick fix</div>
          <ol className="list-decimal space-y-1 pl-4 text-xs">
            <li>
              Confirm the data directory matches the running{" "}
              <span className="font-mono">veriumd</span>.
            </li>
            <li>
              Click <strong>Create RPC login</strong> (writes to that folder&apos;s{" "}
              <span className="font-mono">verium.conf</span>).
            </li>
            <li>
              Restart <span className="font-mono">veriumd</span> so it reloads the
              config.
            </li>
            <li>Click <strong>Test connection</strong> again.</li>
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => test.mutate()}
          disabled={test.isPending}
        >
          {test.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…
            </>
          ) : (
            "Test connection"
          )}
        </Button>
        <Button
          size="sm"
          onClick={() => setupCreds.mutate()}
          disabled={setupCreds.isPending || !draft.datadir}
        >
            {setupCreds.isPending ? "Creating…" : credsInConf ? "Apply & restart WSL" : "Create RPC login"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
        {usingWslDatadir && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => restartWsl.mutate()}
            disabled={restartWsl.isPending || !draft.datadir}
          >
            {restartWsl.isPending ? "Restarting WSL…" : "Restart WSL veriumd"}
          </Button>
        )}
        {veriumdFound && !wslRuntime ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Start daemon
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => restart.mutate()}
              disabled={restart.isPending}
            >
              Restart daemon
            </Button>
          </>
        ) : null}
        {testResult?.ok && <Badge tone="success">Connected</Badge>}
      </div>

      {(save.error || setupCreds.error || start.error || restart.error || restartWsl.error) && (
        <div className="text-xs text-danger">
          {String(save.error ?? setupCreds.error ?? start.error ?? restart.error ?? restartWsl.error)}
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  type?: string;
  placeholder?: string;
  action?: ReactNode;
}

function Field({
  label,
  value,
  onChange,
  mono,
  type = "text",
  placeholder,
  action,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="text-fg-muted">{label}</label>
      <div className="flex gap-2">
        <input
          type={type}
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 flex-1 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent ${
            mono ? "font-mono text-xs" : ""
          }`}
        />
        {action}
      </div>
    </div>
  );
}
