import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { CoinProvider } from "@/lib/coin/context";
import { useActiveCoin } from "@/lib/coin/context";
import { AddressBook } from "@/pages/AddressBook";
import { Dashboard } from "@/pages/Dashboard";
import { Wallet } from "@/pages/Wallet";
import { Mining } from "@/pages/Mining";
import { Staking } from "@/pages/Staking";
import { Network } from "@/pages/Network";
import { Transactions } from "@/pages/Transactions";
import { Logs } from "@/pages/Logs";
import { RpcConsole } from "@/pages/RpcConsole";
import { Settings } from "@/pages/Settings";
import { Security } from "@/pages/Security";
import { Setup } from "@/pages/Setup";
import { SignVerify } from "@/pages/SignVerify";
import { Resources } from "@/pages/Resources";
import { BinaryChain } from "@/pages/BinaryChain";
import { useUserPreferences } from "@/lib/user-preferences";
import { useWebAudioGestureUnlock } from "@/lib/web-audio";
import { PasskeyGate } from "@/components/PasskeyGate";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useAdaptiveMiningThreads } from "@/hooks/useAdaptiveMiningThreads";
import { useAutoMine } from "@/hooks/useAutoMine";
import { useAutoStake } from "@/hooks/useAutoStake";
import { useBlockMinedSound } from "@/hooks/useBlockMinedSound";
import { useBlockMinedWatcher } from "@/hooks/useBlockMinedWatcher";
import { useIncomingVrmNotifications } from "@/hooks/useIncomingVrmNotifications";
import { useIncomingVrmWatcher } from "@/hooks/useIncomingVrmWatcher";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { isNodeReady } from "@/lib/node/status";
import { useTheme } from "@/hooks/useTheme";
import { useDeepLinkHandler } from "@/hooks/useDeepLinkHandler";
import { ToastHost } from "@/components/ToastHost";

function SetupRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const coin = useActiveCoin();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status, isLoading } = useDaemonStatus(coin);

  useEffect(() => {
    if (!loaded || isLoading) return;
    if (prefs.setup_completed || isNodeReady(status)) return;
    if (location.pathname === "/setup") return;
    navigate("/setup", { replace: true });
  }, [loaded, isLoading, prefs.setup_completed, status?.connected, location.pathname, navigate]);

  return null;
}

function AppHooks() {
  const prefs = useUserPreferences((s) => s.prefs);
  useAutoMine();
  useAdaptiveMiningThreads();
  useAutoStake();
  useAutoLock();
  useTheme();
  useBlockMinedWatcher();
  useBlockMinedSound();
  useIncomingVrmWatcher();
  useIncomingVrmNotifications();
  useWebAudioGestureUnlock(
    prefs.play_sound_on_block_mined === true ||
      prefs.notify_on_vrm_received !== false ||
      prefs.notify_on_vrc_received !== false,
  );
  return null;
}

function AppRoutes() {
  const load = useUserPreferences((s) => s.load);
  const updatePrefs = useUserPreferences((s) => s.update);
  const coin = useActiveCoin();
  const { data: status } = useDaemonStatus(coin);
  useDeepLinkHandler();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status?.connected) {
      void updatePrefs({ setup_completed: true });
    }
  }, [status?.connected, updatePrefs]);

  return (
    <>
      <AppHooks />
      <SetupRedirect />
      <ToastHost />
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/mining" element={<Mining />} />
          <Route path="/staking" element={<Staking />} />
          <Route path="/network" element={<Network />} />
          <Route path="/binary-chain" element={<BinaryChain />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/addresses" element={<AddressBook />} />
          <Route path="/sign" element={<SignVerify />} />
          <Route path="/console" element={<RpcConsole />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/security" element={<Security />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <PasskeyGate>
        <CoinProvider>
          <AppRoutes />
        </CoinProvider>
      </PasskeyGate>
    </AppErrorBoundary>
  );
}
