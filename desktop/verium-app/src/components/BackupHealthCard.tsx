import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, HardDrive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { backupHealth } from "@/lib/security/client";
import { BACKUP_HEALTH_REFETCH_MS } from "@/hooks/useScheduledBackup";

export function BackupHealthCard() {
  const health = useQuery({
    queryKey: ["backup-health"],
    queryFn: backupHealth,
    refetchInterval: BACKUP_HEALTH_REFETCH_MS,
  });

  if (!health.data) return null;

  const stale =
    !health.data.last_backup_at ||
    Date.now() / 1000 - health.data.last_backup_at > 7 * 86_400;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="h-4 w-4 text-accent" />
          Backup health
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {stale ? (
            <Badge tone="warning">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Backup overdue
            </Badge>
          ) : (
            <Badge tone="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Backups current
            </Badge>
          )}
          <span className="text-fg-muted">
            {health.data.backup_count} backup(s) ·{" "}
            {health.data.last_backup_at
              ? `Last ${new Date(health.data.last_backup_at * 1000).toLocaleDateString()}`
              : "Never backed up"}
          </span>
        </div>
        <Link to="/settings" className="text-accent underline">
          Manage backups in Settings →
        </Link>
      </CardContent>
    </Card>
  );
}
