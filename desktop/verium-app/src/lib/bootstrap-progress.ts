import type { CoinId } from "@/lib/coin/profile";

export const BOOTSTRAP_CANCELLED_MESSAGE = "Bootstrap cancelled by user.";

export interface BootstrapProgress {
  coin: string;
  phase: string;
  percent: number;
  phasePercent?: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
  extractedFiles?: number;
  totalFiles?: number;
  sourceUrl?: string;
  etaSeconds?: number;
  cancellable?: boolean;
}

export const BOOTSTRAP_PHASE_LABELS: Record<string, string> = {
  stopping: "Stopping node",
  resolving: "Finding bootstrap",
  local: "Local archive",
  downloading: "Downloading",
  validating: "Validating",
  extracting: "Extracting",
  applying: "Installing",
  restarting: "Restarting",
  done: "Complete",
  cancelled: "Cancelled",
  error: "Failed",
};

export function bootstrapPhaseLabel(phase: string): string {
  return BOOTSTRAP_PHASE_LABELS[phase] ?? phase;
}

export function bootstrapCanCancel(
  progress: BootstrapProgress | null | undefined,
): boolean {
  if (progress?.cancellable != null) return progress.cancellable;
  return (
    progress?.phase === "stopping" ||
    progress?.phase === "resolving" ||
    progress?.phase === "downloading"
  );
}

export function isBootstrapCancelledError(error: unknown): boolean {
  return String(error).includes(BOOTSTRAP_CANCELLED_MESSAGE);
}

export function formatBootstrapBytes(bytes: number): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  if (bytes >= kb) return `${Math.round(bytes / kb)} KB`;
  return `${bytes} B`;
}

export function formatBootstrapEta(seconds: number | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 60) return `About ${seconds}s remaining`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return secs > 0
      ? `About ${mins}m ${secs}s remaining`
      : `About ${mins}m remaining`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0
    ? `About ${hours}h ${remMins}m remaining`
    : `About ${hours}h remaining`;
}

export function bootstrapProgressDetail(progress: BootstrapProgress): string | null {
  const parts: string[] = [];

  if (progress.phase === "downloading") {
    if (
      progress.downloadedBytes != null &&
      progress.totalBytes != null &&
      progress.totalBytes > 0
    ) {
      parts.push(
        `${formatBootstrapBytes(progress.downloadedBytes)} / ${formatBootstrapBytes(progress.totalBytes)}`,
      );
    } else if (progress.downloadedBytes != null) {
      parts.push(`${formatBootstrapBytes(progress.downloadedBytes)} downloaded`);
    }
  }

  if (progress.phase === "extracting") {
    if (
      progress.extractedFiles != null &&
      progress.totalFiles != null &&
      progress.totalFiles > 0
    ) {
      parts.push(
        `${progress.extractedFiles.toLocaleString()} / ${progress.totalFiles.toLocaleString()} files`,
      );
    } else if (progress.extractedFiles != null) {
      parts.push(`${progress.extractedFiles.toLocaleString()} files extracted`);
    }
  }

  const eta = formatBootstrapEta(progress.etaSeconds);
  if (eta) parts.push(eta);

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function isBootstrapProgressForCoin(
  progress: BootstrapProgress | null | undefined,
  coin: CoinId,
): progress is BootstrapProgress {
  return progress?.coin === coin;
}
