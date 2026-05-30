import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, RotateCcw, Save } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { coinQueryKey, getCoinProfile, getNodeConfSection, type CoinId } from "@/lib/coin/profile";
import { useNetworkMode } from "@/lib/network-mode";
import {
  tauriOpenNodeConf,
  tauriReadNodeConf,
  tauriRestartDaemon,
  tauriWriteNodeConf,
} from "@/lib/rpc/client";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";

export function VeriumConfEditorCard({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const networkMode = useNetworkMode();
  const confSection = getNodeConfSection(
    coin,
    networkMode.data?.mode ?? "mainnet",
  );
  const queryClient = useQueryClient();
  const twoFa = useTwoFactorGate(coin);
  const conf = useQuery({
    queryKey: coinQueryKey(coin, "node-conf"),
    queryFn: () => tauriReadNodeConf(coin),
  });

  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (conf.data) setDraft(conf.data.content);
  }, [conf.data]);

  const dirty = conf.data !== undefined && draft !== conf.data.content;

  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  const save = useMutation({
    mutationFn: () => tauriWriteNodeConf(coin, draft),
    onMutate: () => {
      restart.reset();
    },
    onSuccess: (result) => {
      setDraft(result.content);
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "node-conf"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-config"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
      });
    },
  });

  const openExternal = useMutation({
    mutationFn: () => tauriOpenNodeConf(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "node-conf"),
      });
    },
  });

  const reload = () => {
    if (conf.data) setDraft(conf.data.content);
    void conf.refetch();
  };

  return (
    <>
      <TwoFactorPrompt
        open={twoFa.open}
        title={twoFa.title}
        onVerified={twoFa.verified}
        onCancel={twoFa.cancel}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            {profile.displayName} node configuration
          </CardTitle>
          <CardDescription>
            Shared <span className="font-mono">{profile.confFilename}</span> with{" "}
            <span className="font-mono">[verium]</span> and{" "}
            <span className="font-mono">[vericoin]</span> sections (plus binarytest
            sections when enabled). Edits below apply to the full file; wallet-managed
            settings for {profile.displayName} are written under{" "}
            <span className="font-mono">[{confSection}]</span>. Open in your system
            editor or edit here in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {conf.data && (
            <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
              <div className="text-fg-muted">Configuration file</div>
              <div className="mt-0.5 break-all text-[11px]">
                {conf.data.path}
              </div>
              <div className="mt-2 text-fg-muted">
                Active section for {profile.displayName}
              </div>
              <div className="mt-0.5 font-mono text-[11px]">[{confSection}]</div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openExternal.mutate()}
              disabled={openExternal.isPending}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {openExternal.isPending ? "Opening…" : "Open in system editor"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide editor" : "Edit in app"}
            </Button>
            {expanded && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    void twoFa.gate("edit_conf", () => save.mutate(), {
                      title: "Confirm config change with 2FA",
                    })
                  }
                  disabled={!dirty || save.isPending}
                >
                  <Save className="h-3.5 w-3.5" />
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={reload}
                  disabled={!dirty || conf.isFetching}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </>
            )}
          </div>

          {expanded && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-[220px] w-full resize-y rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs leading-relaxed outline-none focus:border-accent"
              placeholder={`# ${profile.confFilename} — [${confSection}] and other sections`}
            />
          )}

          {save.isSuccess && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {restart.isSuccess
                ? "Configuration saved successfully."
                : "Configuration saved. Restart the wallet to reload settings."}
              {!restart.isSuccess && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => restart.mutate()}
                    disabled={restart.isPending}
                  >
                    {restart.isPending ? "Restarting…" : "Restart Wallet"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {restart.error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {String(restart.error)}
            </div>
          )}

          {(save.error || openExternal.error || conf.error) && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {String(save.error ?? openExternal.error ?? conf.error)}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
