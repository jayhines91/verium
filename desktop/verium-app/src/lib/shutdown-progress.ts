export interface ShutdownProgress {
  step: string;
  message: string;
  percent: number;
}

export const SHUTDOWN_PROGRESS_EVENT = "shutdown-progress";

export const SHUTDOWN_FALLBACK_MESSAGE = "Preparing to quit…";
