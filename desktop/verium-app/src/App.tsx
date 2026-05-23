import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AddressBook } from "@/pages/AddressBook";
import { Dashboard } from "@/pages/Dashboard";
import { Wallet } from "@/pages/Wallet";
import { Mining } from "@/pages/Mining";
import { Network } from "@/pages/Network";
import { Transactions } from "@/pages/Transactions";
import { Logs } from "@/pages/Logs";
import { RpcConsole } from "@/pages/RpcConsole";
import { Settings } from "@/pages/Settings";
import { Setup } from "@/pages/Setup";
import { SignVerify } from "@/pages/SignVerify";
import { Resources } from "@/pages/Resources";
import { useUserPreferences } from "@/lib/user-preferences";
import { useAutoMine } from "@/hooks/useAutoMine";
import { useBlockMinedSound } from "@/hooks/useBlockMinedSound";
import { useBlockMinedWatcher } from "@/hooks/useBlockMinedWatcher";
import { useIncomingVrmNotifications } from "@/hooks/useIncomingVrmNotifications";
import { useIncomingVrmWatcher } from "@/hooks/useIncomingVrmWatcher";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useTheme } from "@/hooks/useTheme";
import { ToastHost } from "@/components/ToastHost";

function SetupRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const { data: status, isLoading } = useDaemonStatus();

  useEffect(() => {
    if (!loaded || isLoading) return;
    if (prefs.setup_completed || status?.connected) return;
    if (location.pathname === "/setup") return;
    navigate("/setup", { replace: true });
  }, [loaded, isLoading, prefs.setup_completed, status?.connected, location.pathname, navigate]);

  return null;
}

export default function App() {
  const load = useUserPreferences((s) => s.load);
  const updatePrefs = useUserPreferences((s) => s.update);
  const { data: status } = useDaemonStatus();
  useAutoMine();
  useTheme();
  useBlockMinedWatcher();
  useBlockMinedSound();
  useIncomingVrmWatcher();
  useIncomingVrmNotifications();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status?.connected) {
      void updatePrefs({ setup_completed: true });
    }
  }, [status?.connected, updatePrefs]);

  return (
    <AppErrorBoundary>
      <SetupRedirect />
      <ToastHost />
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/mining" element={<Mining />} />
          <Route path="/network" element={<Network />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/addresses" element={<AddressBook />} />
          <Route path="/sign" element={<SignVerify />} />
          <Route path="/console" element={<RpcConsole />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppErrorBoundary>
  );
}
