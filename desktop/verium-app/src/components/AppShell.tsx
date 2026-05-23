import { Outlet } from "react-router-dom";
import { DaemonConnectionBanner } from "./DaemonConnectionBanner";
import { SyncStallBanner } from "./SyncStallBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-fg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-4">
            <DaemonConnectionBanner />
            <SyncStallBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
