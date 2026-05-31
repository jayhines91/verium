import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { CoinProvider } from "@/lib/coin/context";
import { useActiveCoin } from "@/lib/coin/context";
import { BINARYTEST_ENABLED } from "@/lib/features";
import { useUserPreferences } from "@/lib/user-preferences";
import { useWebAudioGestureUnlock } from "@/lib/web-audio";
import { PasskeyGate } from "@/components/PasskeyGate";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useScheduledBackup } from "@/hooks/useScheduledBackup";
import { useAdaptiveMiningThreads } from "@/hooks/useAdaptiveMiningThreads";
import { useAutoMine } from "@/hooks/useAutoMine";
import { useAutoStake } from "@/hooks/useAutoStake";
import { useBlockMinedSound } from "@/hooks/useBlockMinedSound";
import { useBlockMinedWatcher } from "@/hooks/useBlockMinedWatcher";
import { useBlockMinedDashboardSync } from "@/hooks/useBlockMinedDashboardSync";
import { useChainTipWatcher } from "@/hooks/useChainTipWatcher";
import { useIncomingVrmNotifications } from "@/hooks/useIncomingVrmNotifications";
import { useIncomingVrmWatcher } from "@/hooks/useIncomingVrmWatcher";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { isCoinSetupComplete } from "@/lib/setup";
import { useTheme } from "@/hooks/useTheme";
import { useDeepLinkHandler } from "@/hooks/useDeepLinkHandler";
import { ToastHost } from "@/components/ToastHost";

const Setup = lazy(() =>
  import("@/pages/Setup").then((m) => ({ default: m.Setup })),
);
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Mining = lazy(() =>
  import("@/pages/Mining").then((m) => ({ default: m.Mining })),
);
const Staking = lazy(() =>
  import("@/pages/Staking").then((m) => ({ default: m.Staking })),
);
const Network = lazy(() =>
  import("@/pages/Network").then((m) => ({ default: m.Network })),
);
const Transactions = lazy(() =>
  import("@/pages/Transactions").then((m) => ({ default: m.Transactions })),
);
const Logs = lazy(() =>
  import("@/pages/Logs").then((m) => ({ default: m.Logs })),
);
const RpcConsole = lazy(() =>
  import("@/pages/RpcConsole").then((m) => ({ default: m.RpcConsole })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const Security = lazy(() =>
  import("@/pages/Security").then((m) => ({ default: m.Security })),
);
const SignVerify = lazy(() =>
  import("@/pages/SignVerify").then((m) => ({ default: m.SignVerify })),
);
const Resources = lazy(() =>
  import("@/pages/Resources").then((m) => ({ default: m.Resources })),
);
const AddressBook = lazy(() =>
  import("@/pages/AddressBook").then((m) => ({ default: m.AddressBook })),
);
const BinaryChain = lazy(() =>
  import("@/pages/BinaryChain").then((m) => ({ default: m.BinaryChain })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-48 items-center justify-center text-sm text-fg-muted">
      Loading…
    </div>
  );
}

function SetupRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const coin = useActiveCoin();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { isLoading } = useDaemonStatus(coin);

  useEffect(() => {
    if (!loaded || isLoading) return;
    if (isCoinSetupComplete(coin, prefs)) return;
    if (location.pathname === "/setup") return;
    navigate("/setup", { replace: true });
  }, [loaded, isLoading, coin, prefs, location.pathname, navigate]);

  return null;
}

function AppHooks() {
  const prefs = useUserPreferences((s) => s.prefs);
  useAutoMine();
  useAdaptiveMiningThreads();
  useAutoStake();
  useAutoLock();
  useScheduledBackup();
  useTheme();
  useChainTipWatcher();
  useBlockMinedWatcher();
  useBlockMinedDashboardSync();
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
  useDeepLinkHandler();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <AppHooks />
      <SetupRedirect />
      <ToastHost />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<Navigate to="/dashboard" replace />} />
            <Route path="/mining" element={<Mining />} />
            <Route path="/staking" element={<Staking />} />
            <Route path="/network" element={<Network />} />
            {BINARYTEST_ENABLED && (
              <Route path="/binary-chain" element={<BinaryChain />} />
            )}
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
      </Suspense>
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
