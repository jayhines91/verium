import { Outlet } from "react-router-dom";
import { NodeRecoveryBanner } from "./NodeRecoveryBanner";
import { NetworkModeBanner } from "./NetworkModeBanner";
import { ShutdownProgressOverlay } from "./ShutdownProgressOverlay";
import { SyncStallBanner } from "./SyncStallBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-fg">
      <ShutdownProgressOverlay />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Network mode banner: persistent at the very top when on
            binarytest. See vericoin/doc/dace/binarytest-network.md. */}
        <NetworkModeBanner />
        <TopBar />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-4">
            <NodeRecoveryBanner />
            <SyncStallBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
