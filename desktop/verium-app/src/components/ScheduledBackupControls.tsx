import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BACKUP_HEALTH_REFETCH_MS } from "@/hooks/useScheduledBackup";
import { useActiveCoin } from "@/lib/coin/context";
import {
  backupHealth,
  backupRunNow,
  backupSchedulerGetConfig,
  backupSchedulerSaveConfig,
  backupSchedulerSetInterval,
  type BackupSchedulerConfig,
} from "@/lib/security/client";
import { openWalletBackupFolder } from "@/lib/rpc/client";

const BACKUP_INTERVAL_OPTIONS = [
  { hours: 1, label: "Hourly" },
  { hours: 24, label: "Daily" },
  { hours: 168, label: "Weekly" },
] as const;

function formatBackupInterval(hours: number): string {
  const match = BACKUP_INTERVAL_OPTIONS.find((o) => o.hours === hours);
  if (match) return match.label.toLowerCase();
  return `every ${hours}h`;
}

export function ScheduledBackupControls() {
  const coin = useActiveCoin();
  const queryClient = useQueryClient();
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const backupH = useQuery({
    queryKey: ["backup-health"],
    queryFn: backupHealth,
    refetchInterval: BACKUP_HEALTH_REFETCH_MS,
  });
  const backupCfg = useQuery({
    queryKey: ["backup-scheduler"],
    queryFn: backupSchedulerGetConfig,
    staleTime: 0,
  });

  const runBackup = useMutation({
    mutationFn: () => backupRunNow(coin),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["backup-health"] });
    },
  });

  const openFolder = useMutation({
    mutationFn: () => openWalletBackupFolder(coin),
  });

  const saveBackupSchedule = async (patch: Partial<BackupSchedulerConfig>) => {
    const current = backupCfg.data ?? {
      enabled: true,
      daily_retention: 14,
      monthly_retention: 12,
      interval_hours: 24,
    };
    setScheduleError(null);
    setSavingSchedule(true);
    try {
      if (patch.interval_hours !== undefined) {
        queryClient.setQueryData(["backup-scheduler"], {
          ...current,
          interval_hours: patch.interval_hours,
        });
        const saved = await backupSchedulerSetInterval(patch.interval_hours);
        queryClient.setQueryData(["backup-scheduler"], saved);
      } else {
        const next = { ...current, ...patch };
        queryClient.setQueryData(["backup-scheduler"], next);
        const saved = await backupSchedulerSaveConfig(next);
        queryClient.setQueryData(["backup-scheduler"], saved);
      }
      await queryClient.invalidateQueries({ queryKey: ["backup-health"] });
    } catch (err) {
      queryClient.setQueryData(["backup-scheduler"], current);
      setScheduleError(String(err));
    } finally {
      setSavingSchedule(false);
    }
  };

  const selectedIntervalHours = backupCfg.data?.interval_hours ?? 24;

  return (
    <div className="space-y-4 border-y border-border py-4">
      <div>
        <div className="text-sm font-medium text-fg">Automatic backups</div>
        <p className="mt-1 text-xs text-fg-muted">
          Local wallet.dat copies. Scheduled backups run only while the app is
          open.
        </p>
      </div>

      {backupH.data && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
          <div>Backups: {backupH.data.backup_count}</div>
          <div>
            Last:{" "}
            {backupH.data.last_backup_at
              ? new Date(backupH.data.last_backup_at * 1000).toLocaleString()
              : "never"}
          </div>
          <div className="col-span-2">
            Scheduler:{" "}
            {backupH.data.scheduler_enabled
              ? `on (${formatBackupInterval(selectedIntervalHours)})`
              : "off"}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => runBackup.mutate()}
          disabled={runBackup.isPending}
        >
          {runBackup.isPending ? "Backing up…" : "Run backup now"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openFolder.mutate()}
          disabled={openFolder.isPending}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {openFolder.isPending ? "Opening…" : "Open backup folder"}
        </Button>
      </div>

      {runBackup.data && (
        <p className="text-xs text-success">
          Saved to <span className="font-mono">{runBackup.data}</span>
        </p>
      )}
      {runBackup.error && (
        <p className="text-xs text-danger">{String(runBackup.error)}</p>
      )}
      {openFolder.error && (
        <p className="text-xs text-danger">{String(openFolder.error)}</p>
      )}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={backupCfg.data?.enabled ?? true}
            onChange={(e) => void saveBackupSchedule({ enabled: e.target.checked })}
            className="accent-accent"
          />
          Scheduled backups
        </label>
        {(backupCfg.data?.enabled ?? true) && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {BACKUP_INTERVAL_OPTIONS.map(({ hours, label }) => (
                <Button
                  key={hours}
                  size="sm"
                  variant={selectedIntervalHours === hours ? "primary" : "secondary"}
                  disabled={savingSchedule}
                  onClick={() => void saveBackupSchedule({ interval_hours: hours })}
                >
                  {label}
                </Button>
              ))}
            </div>
            {scheduleError && (
              <p className="text-xs text-danger">{scheduleError}</p>
            )}
          </div>
        )}
        <p className="text-xs text-fg-muted">
          The wallet must stay open for scheduled backups to run.
        </p>
      </div>
    </div>
  );
}
