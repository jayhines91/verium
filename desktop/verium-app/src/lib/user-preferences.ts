import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { CoinId } from "@/lib/coin/profile";
import { DEFAULT_TX_EXPLORER_TEMPLATE } from "@/lib/verium-links";
import type { ThemeMode } from "@/lib/theme";
import { DEFAULT_WALLET_UNLOCK_SECONDS } from "@/lib/wallet-unlock";

export interface UserPreferences {
  /** @deprecated use setup_completed_by_coin; kept for legacy prefs migration */
  setup_completed: boolean;
  /** First-run wizard completed per chain (daemon + wallet + optional bootstrap). */
  setup_completed_by_coin?: Partial<Record<CoinId, boolean>>;
  bootstrap_dismissed_at?: number;
  explorer_tx_url_template: string;
  explorer_block_url_template?: string;
  explorer_address_url_template?: string;
  active_coin?: CoinId;
  verium_enabled?: boolean;
  vericoin_enabled?: boolean;
  auto_mine_on_open?: boolean;
  auto_stake_on_open?: boolean;
  play_sound_on_block_mined?: boolean;
  notify_on_vrm_received?: boolean;
  notify_on_vrc_received?: boolean;
  /** When true, thread count follows CPU topology; when false, uses auto_mine_threads. */
  auto_adjust_mine_threads?: boolean;
  /** "dynamic" (default) or "static" — how block rewards choose a payout address. */
  mining_reward_address_mode?: "dynamic" | "static";
  /** Wallet address for block rewards when mining_reward_address_mode is "static". */
  mining_reward_address?: string;
  auto_mine_threads?: number;
  mining_power_watts?: number;
  mining_cost_per_kwh?: number;
  /** Optional VRM/USD price for solo revenue estimates; blank uses live explorer price. */
  mining_vrm_price_usd?: number;
  theme_mode?: ThemeMode;
  /** @deprecated use wallet_unlock_duration_by_coin */
  wallet_unlock_duration_seconds?: number;
  wallet_unlock_duration_by_coin?: Partial<Record<CoinId, number>>;
  tx_fee_rate_vrm_per_kb?: number;
  bootstrap_imported_at_by_coin?: Partial<Record<CoinId, number>>;
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
  active_coin: "verium",
  verium_enabled: true,
  vericoin_enabled: true,
  auto_mine_on_open: false,
  auto_stake_on_open: false,
  play_sound_on_block_mined: false,
  notify_on_vrm_received: true,
  notify_on_vrc_received: true,
  auto_adjust_mine_threads: true,
  mining_reward_address_mode: "dynamic",
  mining_reward_address: "",
  auto_mine_threads: 2,
  theme_mode: "system",
  wallet_unlock_duration_seconds: DEFAULT_WALLET_UNLOCK_SECONDS,
  wallet_unlock_duration_by_coin: {
    verium: DEFAULT_WALLET_UNLOCK_SECONDS,
    vericoin: DEFAULT_WALLET_UNLOCK_SECONDS,
  },
};

export const useUserPreferences = create<PrefsState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  load: async () => {
    try {
      const next = await invoke<UserPreferences>("get_user_preferences");
      const merged = { ...DEFAULT_PREFS, ...next };
      if (
        merged.setup_completed &&
        !merged.setup_completed_by_coin?.verium &&
        !merged.setup_completed_by_coin?.vericoin
      ) {
        merged.setup_completed_by_coin = {
          ...merged.setup_completed_by_coin,
          verium: true,
        };
      }
      set({
        prefs: merged,
        loaded: true,
      });
    } catch {
      set({ prefs: DEFAULT_PREFS, loaded: true });
    }
  },
  update: async (partial) => {
    const current = get().prefs;
    const next: UserPreferences = {
      ...current,
      ...partial,
      wallet_unlock_duration_by_coin: partial.wallet_unlock_duration_by_coin
        ? {
            ...current.wallet_unlock_duration_by_coin,
            ...partial.wallet_unlock_duration_by_coin,
          }
        : current.wallet_unlock_duration_by_coin,
      bootstrap_imported_at_by_coin: partial.bootstrap_imported_at_by_coin
        ? {
            ...current.bootstrap_imported_at_by_coin,
            ...partial.bootstrap_imported_at_by_coin,
          }
        : current.bootstrap_imported_at_by_coin,
      setup_completed_by_coin: partial.setup_completed_by_coin
        ? {
            ...current.setup_completed_by_coin,
            ...partial.setup_completed_by_coin,
          }
        : current.setup_completed_by_coin,
    };
    set({ prefs: next });
    await invoke<UserPreferences>("set_user_preferences", { partial });
  },
}));
