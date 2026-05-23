import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_TX_EXPLORER_TEMPLATE } from "@/lib/verium-links";
import type { ThemeMode } from "@/lib/theme";

export interface UserPreferences {
  setup_completed: boolean;
  bootstrap_dismissed_at?: number;
  explorer_tx_url_template: string;
  explorer_block_url_template?: string;
  explorer_address_url_template?: string;
  auto_mine_on_open?: boolean;
  play_sound_on_block_mined?: boolean;
  notify_on_vrm_received?: boolean;
  auto_mine_threads?: number;
  mining_power_watts?: number;
  mining_cost_per_kwh?: number;
  theme_mode?: ThemeMode;
  wallet_unlock_duration_seconds?: number;
  tx_fee_rate_vrm_per_kb?: number;
}

interface PrefsState {
  prefs: UserPreferences;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<UserPreferences>) => Promise<void>;
}

const DEFAULT_PREFS: UserPreferences = {
  setup_completed: false,
  explorer_tx_url_template: DEFAULT_TX_EXPLORER_TEMPLATE,
  auto_mine_on_open: false,
  play_sound_on_block_mined: false,
  notify_on_vrm_received: true,
  auto_mine_threads: 2,
  theme_mode: "system",
  wallet_unlock_duration_seconds: 4 * 60 * 60,
};

export const useUserPreferences = create<PrefsState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  load: async () => {
    try {
      const next = await invoke<UserPreferences>("get_user_preferences");
      set({
        prefs: { ...DEFAULT_PREFS, ...next },
        loaded: true,
      });
    } catch {
      set({ prefs: DEFAULT_PREFS, loaded: true });
    }
  },
  update: async (partial) => {
    const next = { ...get().prefs, ...partial };
    set({ prefs: next });
    await invoke<UserPreferences>("set_user_preferences", { partial });
  },
}));
