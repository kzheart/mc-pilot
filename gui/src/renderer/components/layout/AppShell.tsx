import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Drag region for the content area top */}
          <div className="drag-region h-10 shrink-0" />
          <main className="flex-1 overflow-y-auto px-6 pb-6" style={{ minHeight: 0 }}>
            <Outlet />
          </main>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
