import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  ALL_COINS,
  getCoinProfile,
  type CoinId,
  type CoinProfile,
} from "@/lib/coin/profile";
import { useUserPreferences } from "@/lib/user-preferences";

interface CoinContextValue {
  activeCoin: CoinId;
  profile: CoinProfile;
  setActiveCoin: (coin: CoinId) => void;
  enabledCoins: CoinId[];
  isCoinEnabled: (coin: CoinId) => boolean;
}

const CoinContext = createContext<CoinContextValue | null>(null);

export function CoinProvider({ children }: { children: ReactNode }) {
  const prefs = useUserPreferences((s) => s.prefs);
  const update = useUserPreferences((s) => s.update);

  const activeCoin: CoinId =
    prefs.active_coin === "vericoin" ? "vericoin" : "verium";

  const enabledCoins = useMemo(
    () =>
      ALL_COINS.filter((coin) => {
        if (coin === "verium") return prefs.verium_enabled !== false;
        return prefs.vericoin_enabled !== false;
      }),
    [prefs.verium_enabled, prefs.vericoin_enabled],
  );

  const setActiveCoin = useCallback(
    (coin: CoinId) => {
      void update({ active_coin: coin });
    },
    [update],
  );

  const value = useMemo(
    () => ({
      activeCoin,
      profile: getCoinProfile(activeCoin),
      setActiveCoin,
      enabledCoins,
      isCoinEnabled: (coin: CoinId) => enabledCoins.includes(coin),
    }),
    [activeCoin, enabledCoins, setActiveCoin],
  );

  return <CoinContext.Provider value={value}>{children}</CoinContext.Provider>;
}

export function useActiveCoin(): CoinId {
  return useCoinContext().activeCoin;
}

export function useCoinProfile(): CoinProfile {
  return useCoinContext().profile;
}

export function useSetActiveCoin(): (coin: CoinId) => void {
  return useCoinContext().setActiveCoin;
}

export function useEnabledCoins(): CoinId[] {
  return useCoinContext().enabledCoins;
}

export function useCoinContext(): CoinContextValue {
  const ctx = useContext(CoinContext);
  if (!ctx) {
    throw new Error("useCoinContext must be used within CoinProvider");
  }
  return ctx;
}

export function useCoinProfileFor(coin: CoinId): CoinProfile {
  return getCoinProfile(coin);
}
