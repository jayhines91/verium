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
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
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

  const save = useMutation({
    mutationFn: () => tauriWriteNodeConf(coin, draft),
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

  const restart = useMutation({
    mutationFn: () => tauriRestartDaemon(coin),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey(coin, "daemon-status"),
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
          {profile.displayName} configuration
        </CardTitle>
        <CardDescription>
          Edit <span className="font-mono">{profile.confFilename}</span> in the
          app or open it in your system text editor.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {conf.data && (
          <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
            <div className="text-fg-muted">Configuration file</div>
            <div className="mt-0.5 break-all font-mono text-[11px]">
              {conf.data.path}
            </div>
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
                  void twoFa.gate(
                    "edit_conf",
                    () => save.mutate(),
                    { title: "Confirm config change with 2FA" },
                  )
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
            className="min-h-[220px] w-full resize-y rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
            placeholder={`# ${profile.displayName} node configuration`}
          />
        )}

        {save.isSuccess && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            Configuration saved. Restart the daemon to reload settings.
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => restart.mutate()}
                disabled={restart.isPending}
              >
                {restart.isPending ? "Restarting…" : "Restart daemon"}
              </Button>
            </div>
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
