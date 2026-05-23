import { create } from "zustand";

export type ToastTone = "success" | "info";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION_MS = 6_000;

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    const next: ToastItem = {
      id,
      tone: "info",
      durationMs: DEFAULT_DURATION_MS,
      ...toast,
    };
    set((state) => ({
      toasts: [...state.toasts, next].slice(-MAX_VISIBLE),
    }));
    return id;
  },
  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export function pushToast(toast: Omit<ToastItem, "id">): string {
  return useToastStore.getState().push(toast);
}

export function dismissToast(id: string): void {
  useToastStore.getState().dismiss(id);
}
